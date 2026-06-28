# Smart Transaction Stack

A real-time Solana transaction infrastructure system built for the Superteam Nigeria Advanced Infrastructure Challenge. It observes live network state, prices Jito bundle tips using an LLM-backed reasoning agent, submits bundles on mainnet, and tracks every submission across the full commitment lifecycle.

**Architecture document:** https://beaded-plume-585.notion.site/Smart-Transaction-Stack-Architecture-Document-1e1d32ea43984f8da9af5f57a2799515?source=copy_link

---

## What this does

- Streams live slot data from Solana via Yellowstone gRPC
- Tracks the upcoming leader schedule and cross-references it against the live Jito validator set to find Jito-enabled leader windows
- Uses an AI agent (Claude) to decide Jito tip amounts based on live tip percentiles, network urgency, and recent submission outcomes, with no hardcoded tip values
- Constructs and submits real Jito bundles on Solana mainnet
- Tracks each bundle's lifecycle (`submitted → processed → confirmed → finalized`) with timestamps, slot numbers, and latency deltas
- Classifies failures (expired blockhash, fee too low, compute exceeded, bundle failure) rather than treating every non-success the same way
- Writes structured JSON logs for every submission, success or failure, to `/logs/`

## Why both devnet and mainnet

Jito's bundle infrastructure and tip economics are mainnet-only in any meaningful sense, since there's no real MEV incentive on devnet, which this project confirmed empirically rather than assumed (zero Jito-enabled leaders found in repeated devnet leader-schedule sampling). So:

- **Devnet** is used for slot streaming and leader-schedule mechanics (free, safe, identical mechanics to mainnet for observation purposes).
- **Mainnet** is used for actual Jito bundle submission, since that's the only place the bundle auction and tip economics are real. A small, dedicated wallet is used for this, funded with a minimal amount of real SOL.

## Setup

### Prerequisites

- Node.js 18+
- A Solana keypair (devnet) and a separate, small, dedicated Solana keypair funded with real SOL (mainnet); see [Wallets](#wallets) below
- An Anthropic API key ([console.anthropic.com](https://console.anthropic.com))

### Install

```bash
git clone https://github.com/Mykelsown/Smart_Transaction_Checker-solana.git
cd Smart_Transaction_Checker-solana
npm install
```

### Configure environment

Create a `.env` file in the project root:

```
RPC_URL=https://api.devnet.solana.com
YELLOWSTONE_ENDPOINT=https://solana-yellowstone-grpc.publicnode.com:443
YELLOWSTONE_TOKEN=
KEYPAIR_PATH=/path/to/your/devnet-keypair.json

MAINNET_RPC_URL=https://api.mainnet-beta.solana.com
MAINNET_KEYPAIR_PATH=/path/to/your/mainnet-keypair.json
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf/api/v1/bundles

ANTHROPIC_API_KEY=your_key_here
```

`.env` is gitignored and must never be committed. It is not included in this repository.

### Wallets

This project uses two separate keypairs:

| Keypair | Network | Purpose |
|---|---|---|
| `devnet-keypair.json` | Devnet | Free testing, slot streaming, leader tracking |
| `mainnet-keypair.json` | Mainnet | Real Jito bundle submission, fund with a small amount only (0.05 to 0.1 SOL is sufficient for ~10+ submissions) |

Generate a devnet keypair and fund it for free:

```bash
solana-keygen new --outfile ~/.config/solana/devnet.json
solana airdrop 2 <pubkey> --url devnet
```

The mainnet keypair should be funded with real SOL from an exchange or wallet, and should be treated as disposable. Never reuse a wallet holding significant funds for testing.

## Running each phase

**Slot streaming (devnet):**
```bash
npx ts-node src/stream/slotStream.ts
```

**Leader tracking (devnet, cross-referenced against live Jito validators):**
```bash
npx ts-node src/stream/leaderTracker.ts
```

**Real bundle submission (mainnet, spends real SOL):**
```bash
npx ts-node src/bundle/submitRealBundle.ts
```

**Lifecycle tracking loop (writes structured logs to `/logs/`):**
```bash
npx ts-node src/tracker/runTracker.ts
```

**AI agent demo (Tip Intelligence, against representative scenarios):**
```bash
npx ts-node src/agent/runAgentDemo.ts
```

## Project structure

```
src/
├── stream/
│   ├── slotStream.ts        # Yellowstone gRPC live slot subscription
│   └── leaderTracker.ts     # Leader schedule + Jito validator cross-reference
├── bundle/
│   └── submitRealBundle.ts  # Real mainnet bundle construction & submission
├── tracker/
│   ├── types.ts             # Shared BundleRecord / FailureReason types
│   ├── logger.ts            # JSON log read/write
│   ├── mockSource.ts        # Simulated bundle data (used during development)
│   ├── realSource.ts        # Real bundle submission wired into the tracker
│   └── runTracker.ts        # Orchestrates submission + logging loop
└── agent/
    ├── tipAgent.ts          # Claude-backed tip decision logic
    └── runAgentDemo.ts      # Standalone agent demo across test scenarios
logs/                        # Structured JSON lifecycle records (generated)
```

## README questions

**What does the delta between `processed_at` and `confirmed_at` tell you about network health at the time of submission?**

This delta measures how long it took for a supermajority of stake-weighted validators to vote on the block containing the transaction. A short delta indicates validators are voting promptly, a healthy network. A delta that grows under load signals congestion or validator-side delays in vote propagation, even if slot production itself remains on schedule.

**Why should you never use `finalized` commitment when fetching a blockhash for a time-sensitive transaction?**

A blockhash is valid for roughly 150 slots from when it was produced. `finalized` commitment reflects state from roughly 30+ slots in the past, since Solana finalizes conservatively to guarantee irreversibility. Fetching a blockhash at `finalized` commitment starts the transaction's validity countdown already a fifth of the way through its window, before the transaction is even built, which is a real risk under any submission delay or retry. `confirmed` commitment gives a blockhash that is both recent and safely backed by supermajority vote.

**What happens to your bundle if the Jito leader skips their slot?**

The bundle is not retried automatically. It is simply never seen by whichever block actually gets produced. Jito routes bundles to the specific leader scheduled for that slot; if that leader misses its slot, the next validator who produces a block may not run Jito at all, and has no visibility into the bundle queue. This is indistinguishable, from the submitter's side, from a bundle that lost the tip auction, since both look like "accepted, never landed." This project's submission logic gates on leader-window proximity before submitting specifically to minimize this failure mode.

## License

MIT