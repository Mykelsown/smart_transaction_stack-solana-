# Build Issues Log — Smart Transaction Stack

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

**Outcome:** Stream confirmed working — continuous slot updates across PROCESSED/CONFIRMED/FINALIZED with accurate timestamps, reconnection logic battle-tested against real failures.

---

## Phase 2: Leader Tracking

| Issue | Cause | Fix |
|---|---|---|
| TypeScript error assigning Jito API response to typed array | `res.json()` returns `any`, unsafe direct cast to custom interface | Explicitly typed response as `any`, used `Array.isArray()` check, manually mapped fields into `JitoValidator[]` |
| `Endpoint URL must start with http: or https:` (RPC_URL undefined) | Script run from `src/stream/` subfolder; `dotenv.config()` defaults to current working directory, not project root | Pointed `dotenv.config()` explicitly to root `.env` using `path.resolve(__dirname, "../../.env")` |
| No Jito-enabled leader found in schedule | Expected devnet behavior — Jito validators are economically driven by mainnet MEV, very few run on devnet | Not a bug; documented in architecture doc that Jito-matching logic was validated against live mainnet validator set while submission testing runs on devnet |

**Outcome:** Leader schedule successfully fetched from devnet RPC, cross-referenced against 690 live Jito-enabled mainnet validators, correctly identified no Jito leader in devnet's near-term schedule (expected), confirmed leader rotation behavior (same identity holding 4 consecutive slots) matches Solana's known leader scheduling pattern.

---