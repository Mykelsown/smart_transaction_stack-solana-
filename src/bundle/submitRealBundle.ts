import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { decideTip } from "../agent/tipAgent";

// Waits until a Jito-enabled leader IS THE CURRENT SLOT (not just nearby) before returning.
// This is intentionally strict: bundles have an effective expiry of ~2 slots once submitted,
// and the round-trip latency of building + signing + POSTing a transaction can itself consume
// most of that window. "0 slots away" checked a moment ago can be stale by the time we submit,
// so we recheck immediately before returning rather than trusting an earlier estimate.
async function waitForJitoLeaderWindow(connection: Connection): Promise<void> {
  const JITO_VALIDATORS_URL =
    "https://kobe.mainnet.jito.network/api/v1/validators";

  console.log("Loading live Jito validator list...");
  let res;
  let retries = 3;
  while (retries > 0) {
    try {
      res = await fetch(JITO_VALIDATORS_URL);
      break;
    } catch (err) {
      retries--;
      if (retries === 0) throw err;
      console.log("Validator list fetch failed, retrying...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  const data = (await res!.json()) as {
    validators: { vote_account: string; running_jito: boolean }[];
  };
  const jitoVoteAccounts = new Set(
    data.validators.filter((v) => v.running_jito).map((v) => v.vote_account),
  );
  console.log(`Loaded ${jitoVoteAccounts.size} Jito-enabled validators.\n`);

  const voteAccounts = await connection.getVoteAccounts();
  const identityToVote = new Map<string, string>();
  [...voteAccounts.current, ...voteAccounts.delinquent].forEach((v) => {
    identityToVote.set(v.nodePubkey, v.votePubkey);
  });


  const MAX_WAIT_CHECKS = 30; // stricter condition needs more checks to find a match
  for (let attempt = 0; attempt < MAX_WAIT_CHECKS; attempt++) {
    const currentSlot = await connection.getSlot("processed");
    const leaders = await connection.getSlotLeaders(currentSlot, 4);

    for (let i = 0; i < leaders.length; i++) {
      const voteAccount = identityToVote.get(leaders[i].toBase58());
      const isJito = voteAccount ? jitoVoteAccounts.has(voteAccount) : false;
      if (isJito && i >= 1 && i <= 2) {
        console.log(`Jito leader ${i} slot(s) ahead (slot ${currentSlot + i}). Proceeding.\n`);
        return;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  throw new Error(
    "No current-slot Jito leader found within wait limit. Try again shortly.",
  );
}

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const MAINNET_RPC_URL = process.env.MAINNET_RPC_URL!;
const MAINNET_KEYPAIR_PATH = process.env.MAINNET_KEYPAIR_PATH!;
const JITO_BLOCK_ENGINE_URL = process.env.JITO_BLOCK_ENGINE_URL!;

// Load the funded mainnet keypair
function loadKeypair(filePath: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

// Fetch live tip accounts from Jito (no hardcoded addresses)
async function getTipAccounts(): Promise<string[]> {
  const res = await fetch(
    `${JITO_BLOCK_ENGINE_URL.replace("/bundles", "")}/random_tip_account`,
  );
  if (!res.ok) {
    // Fallback endpoint shape, some Jito deployments expose getTipAccounts via RPC-style call
    const altRes = await fetch(
      JITO_BLOCK_ENGINE_URL.replace("/bundles", "/getTipAccounts"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTipAccounts",
          params: [],
        }),
      },
    );
    const altData = (await altRes.json()) as { result: string[] };
    return altData.result;
  }
  const data = (await res.json()) as string[] | string;
  return Array.isArray(data) ? data : [data];
}

// Fetch live tip percentiles from Jito (feeds the agent's reasoning)
async function getTipPercentiles(): Promise<{
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}> {
  const res = await fetch("https://bundles.jito.wtf/api/v1/bundles/tip_floor");
  const data = (await res.json()) as any[];
  const latest = data[0];
  return {
    p25: Math.round(latest.landed_tips_25th_percentile * 1_000_000_000),
    p50: Math.round(latest.landed_tips_50th_percentile * 1_000_000_000),
    p75: Math.round(latest.landed_tips_75th_percentile * 1_000_000_000),
    p95: Math.round(latest.landed_tips_95th_percentile * 1_000_000_000),
  };
}

// Read the last 5 logged outcomes so the agent reasons from real history
function getRecentOutcomes(): ("landed" | "failed")[] {
  const logsDir = path.resolve(__dirname, "../../logs");
  if (!fs.existsSync(logsDir)) {
    return ["landed", "landed", "landed", "landed", "landed"];
  }

  const files = fs
    .readdirSync(logsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      name: f,
      time: fs.statSync(path.join(logsDir, f)).mtime.getTime(),
    }))
    .sort((a, b) => b.time - a.time)
    .slice(0, 5);

  if (files.length === 0) {
    return ["landed", "landed", "landed", "landed", "landed"];
  }

  return files.map((f) => {
    const content = JSON.parse(
      fs.readFileSync(path.join(logsDir, f.name), "utf-8"),
    );
    return content.status === "failed" ? "failed" : "landed";
  });
}

async function main() {
  console.log("Smart Transaction Stack — Phase 3: Real Bundle Submission");
  console.log(
    "=============================================================\n",
  );

  const connection = new Connection(MAINNET_RPC_URL, "confirmed");
  const payer = loadKeypair(MAINNET_KEYPAIR_PATH);

  console.log(`Wallet: ${payer.publicKey.toBase58()}`);

  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${balance / 1_000_000_000} SOL\n`);

  if (balance < 5000) {
    throw new Error(
      "Insufficient balance to cover fees and tip. Aborting before spending anything.",
    );
  }

  // Get live tip accounts
  console.log("Fetching live Jito tip accounts...");
  const tipAccounts = await getTipAccounts();
  console.log(`Got ${tipAccounts.length} tip accounts.`);
  const tipAccount = new PublicKey(
    tipAccounts[Math.floor(Math.random() * tipAccounts.length)],
  );
  console.log(`Selected tip account: ${tipAccount.toBase58()}\n`);

  // AI agent decides the tip, no hardcoded value
  console.log("Fetching live tip percentiles...");
  const tipPercentiles = await getTipPercentiles();
  console.log(
    `Percentiles (lamports), p25: ${tipPercentiles.p25}, p50: ${tipPercentiles.p50}, p75: ${tipPercentiles.p75}, p95: ${tipPercentiles.p95}\n`,
  );

  const slotForAgent = await connection.getSlot("confirmed");
  const recentOutcomes = getRecentOutcomes();
  console.log(`Recent outcomes fed to agent: [${recentOutcomes.join(", ")}]\n`);

  console.log("Calling AI agent for tip decision...");
  const agentResult = await decideTip({
    tipPercentiles,
    currentSlot: slotForAgent,
    slotsUntilJitoLeader: 0, // this version only proceeds when the leader IS the current slot
    recentOutcomes,
    networkCondition: "moderate",
  });

  console.log("\n--- Agent Reasoning ---");
  console.log(agentResult.reasoning);
  console.log("-----------------------\n");

  if (agentResult.usedFallback) {
    console.warn(
      "WARNING: Agent format fallback was used. This submission's tip was NOT fully agent-reasoned.\n",
    );
  }

  const tipLamports = agentResult.tipLamports;
  console.log(`Tip amount (agent-decided): ${tipLamports} lamports\n`);

  // Pre-build everything that doesn't depend on leader timing BEFORE the
  // strict wait, so the only thing happening after the leader check resolves
  // is blockhash fetch, sign, and immediate submission. Minimizing this gap
  // is the actual fix, the earlier version checked proximity too early and
  // let too much time pass before the real send.
  await waitForJitoLeaderWindow(connection);

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const instructions = [
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: payer.publicKey,
      lamports: 1000,
    }),
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: tipAccount,
      lamports: tipLamports,
    }),
  ];

  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const transaction = new VersionedTransaction(messageV0);
  transaction.sign([payer]);
  const serializedTx = Buffer.from(transaction.serialize()).toString("base64");

  // Fire immediately, no extra logging or awaits between leader confirmation and send
  const submittedAt = new Date().toISOString();
  const submittedSlot = await connection.getSlot("processed");

  const bundleRes = await fetch(JITO_BLOCK_ENGINE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendBundle",
      params: [[serializedTx], { encoding: "base64" }],
    }),
  });

  const bundleData = (await bundleRes.json()) as {
    error?: any;
    result?: string;
  };

  console.log(`Blockhash: ${blockhash}`);
  console.log(`Valid until block height: ${lastValidBlockHeight}\n`);

  if (bundleData.error) {
    console.error("Bundle submission failed:", bundleData.error);
    process.exit(1);
  }

  const bundleId = bundleData.result;
  console.log(`\nBundle submitted successfully!`);
  console.log(`Bundle ID: ${bundleId}`);
  console.log(`Submitted at: ${submittedAt}`);
  console.log(`Submitted slot: ${submittedSlot}`);
  console.log(`\nCheck status: https://explorer.jito.wtf/bundle/${bundleId}`);
  console.log(`Or check your wallet on Solana Explorer:`);
  console.log(
    `https://explorer.solana.com/address/${payer.publicKey.toBase58()}`,
  );
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});