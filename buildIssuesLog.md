# Build Issues Log: Smart Transaction Stack

## Phase 1: Environment & Connectivity

| Issue | Cause | Fix |
|---|---|---|
| Helius site and Solana install script inaccessible | ISP-level network blocking | Used free public RPC (`api.devnet.solana.com`) + installed Solana CLI via GitHub Releases instead of official script |
| `solana-keygen: command not found` | CLI not added to PATH after manual install | Added install path to `~/.bashrc`, sourced it |
| Devnet airdrop rate limited | Solana's default faucet has strict per-IP limits | Used web faucet (faucet.solana.com) as fallback |
| TypeScript import error on Yellowstone package | `strict: true` enabled `noImplicitAny`, package lacked full type declarations | Set `strict: false` and `noImplicitAny: false` in `tsconfig.json` |
| gRPC client `Client not connected` error | Installed package version (5.x) had breaking API changes from the code's target version | Downgraded to `@triton-one/yellowstone-grpc@2.0.0` |
| `Failed to parse DNS address dns::` | Endpoint in `.env` missing URL scheme | Added `https://` prefix to `YELLOWSTONE_ENDPOINT` |
| Duplicate/stacking reconnect attempts | Both `error` and `end` stream events triggered reconnect independently | Added `reconnectScheduled` boolean guard flag |
| `PERMISSION_DENIED: requires a personal token` | PublicNode's free Yellowstone tier requires registration | Registered free account, added token to `.env` |
| `.env` values reverted unexpectedly | Likely tooling/editor auto-revert (dotenvx involved) | Re-verified live env values with `cat .env` before further debugging |
| Duplicate console log lines for same slot | PublicNode occasionally emits redundant updates | Added `Set`-based deduplication keyed by `slot-status` |

**Outcome:** Stream confirmed working , continuous slot updates across PROCESSED/CONFIRMED/FINALIZED with accurate timestamps, reconnection logic battle-tested against real failures.

---

## Phase 2: Leader Tracking

| Issue | Cause | Fix |
|---|---|---|
| TypeScript error assigning Jito API response to typed array | `res.json()` returns `any`, unsafe direct cast to custom interface | Explicitly typed response as `any`, used `Array.isArray()` check, manually mapped fields into `JitoValidator[]` |
| `Endpoint URL must start with http: or https:` (RPC_URL undefined) | Script run from `src/stream/` subfolder; `dotenv.config()` defaults to current working directory, not project root | Pointed `dotenv.config()` explicitly to root `.env` using `path.resolve(__dirname, "../../.env")` |
| No Jito-enabled leader found in schedule | Expected devnet behavior , Jito validators are economically driven by mainnet MEV, very few run on devnet | Not a bug; documented in architecture doc that Jito-matching logic was validated against live mainnet validator set while submission testing runs on devnet |

**Outcome:** Leader schedule successfully fetched from devnet RPC, cross-referenced against 690 live Jito-enabled mainnet validators, correctly identified no Jito leader in devnet's near-term schedule (expected), confirmed leader rotation behavior (same identity holding 4 consecutive slots) matches Solana's known leader scheduling pattern.

---

## Phase 3: Bundle Construction & Submission

| Issue | Cause | Fix |
|---|---|---|
| Jito bundles require mainnet, not devnet | Jito's block engine, tip accounts, and ~95% validator adoption are mainnet-specific; devnet has no real MEV incentive | Decided to test bundle submission on mainnet, with broader stream/RPC stack staying on devnet |
| Real bundle submissions require real SOL | Tip transfers and transaction fees are unavoidable costs of landing a verifiable, explorer-checkable bundle | Funded a small, dedicated, disposable mainnet wallet (0.081 SOL) via exchange withdrawal |
| `transaction #0 could not be decoded` on first real submission attempt | Jito's `sendBundle` endpoint defaulted to expecting base58, not base64, with no explicit encoding declared | Added explicit `{ encoding: "base64" }` to the `sendBundle` params array |
| Bundle accepted (bundle ID returned), but never landed on-chain; balance unchanged, `getBundleStatuses` empty | Initial hypothesis: no leader-proximity check before submission, given bundles' ~800ms effective expiry window | Added `waitForJitoLeaderWindow()`, requiring a Jito leader within 2 slots before submitting |
| Same empty-result outcome persisted after the leader-window fix | Leader-window check itself was stale by submission time; round-trip latency (build, sign, POST) consumed the narrow window between check and send | Restructured wait condition to require the leader to be the exact current slot, then logging/extra awaits removed from the critical path |
| Same outcome persisted again after stricter current-slot-only check | "0 slots away" detected a moment ago is often already past by actual submission; targeting the present moment leaves no margin for latency | Changed target to 1-2 slots ahead instead of slot 0, deliberately banking on latency to land submission as that slot becomes current |
| Same outcome persisted a fourth time; one run's agent reasoning was cut off before its `TIP:` line | Parser fallback silently used p50 (1,024 lamports) against a same-moment p95 of 27,653 lamports, a plausible auction-loss cause independent of timing | Added a tip floor (`max(agent tip, 1.5x p75)`) to remove fallback-driven underpricing as a variable |
| Same outcome with the tip floor in place | Ruled out tip-size-as-sole-cause; pointed toward network-level explanation instead | Attempted RPC endpoint swap (Solana public RPC to Ankr) to test network-distance theory |
| RPC swap caused a harder failure (`fetch failed` on balance check, before reaching submission) | New endpoint was less reliable than the original, not more | Reverted immediately to `api.mainnet-beta.solana.com` |

**Outcome:** Real bundle submissions were successfully constructed and accepted by Jito's block engine (multiple valid bundle IDs returned across attempts), with the AI tip agent making genuine, visible, context-sensitive tip decisions each time, including correctly self-flagging via the `usedFallback` warning when its own reasoning was truncated. However, no submission was confirmed landing on-chain across this investigation, verified via `getBundleStatuses` returning an empty result and wallet balance remaining unchanged after each attempt. Eight independently varied hypotheses were tested (balance, encoding, single-variable tip size, three leader-timing strategies, tip-floor enforcement, and RPC endpoint quality), with consistent results across all of them pointing toward infrastructure-level constraints (likely network round-trip latency to the block engine, and/or live auction competition) rather than a single fixable code defect. This is documented in full, including the evidence ruled in and out at each step, in Section 5.3 of the architecture document and in the README's "Known limitation" section.

---

## Phase 4: Lifecycle Tracking (Mock Mode)

| Issue | Cause | Fix |
|---|---|---|
| `Cannot find name 'console'` / `'process'` | `tsconfig.json` missing explicit `"types": ["node"]`, so Node's global types weren't loaded | Added `"types": ["node"]` to `compilerOptions`; also confirmed `@types/node` was installed |

**Outcome:** 10 mock bundle submissions logged successfully , 8 finalized with realistic slot/timestamp progression and varying tip amounts, 2 classified failures (ExpiredBlockhash, FeeTooLow), satisfying the bounty's minimum lifecycle log requirement. Built on a swappable mock data source so Phase 3 (real mainnet submission) can be plugged in later without rewriting tracker/logger code.

---

## Phase 5: AI Agent (Tip Intelligence)

| Issue | Cause | Fix |
|---|---|---|
| Parsed tip silently mismatched the model's actual reasoning in 2 of 3 demo runs | Model didn't always end response with the exact `TIP: <number>` format; regex match failed silently and fell back to p50 without any indication | Added explicit `usedFallback` flag with a loud console warning when fallback fires; strengthened prompt with an exact-format example and explicit "no commentary after this line" instruction |

**Outcome:** Ran demo against 3 realistic mock scenarios (low/high/moderate network conditions) to validate the reasoning pipeline before connecting to real Phase 3 data , avoids spending API calls on unverified logic. After the parser fix, all 3 scenarios produced a final tip that correctly matched the model's own stated reasoning (6,000 / 120,000 / 28,000 lamports respectively), with no silent fallback triggered. Tip values scaled sensibly with network congestion, recent failure rate, and urgency , confirming genuine reasoning-driven decisions rather than hardcoded or default values.

---