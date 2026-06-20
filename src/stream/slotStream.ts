import Client, {
  CommitmentLevel,
  SubscribeRequest,
} from "@triton-one/yellowstone-grpc";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// --- Config 
let reconnectScheduled = false;
const ENDPOINT = process.env.YELLOWSTONE_ENDPOINT!;
const TOKEN    = process.env.YELLOWSTONE_TOKEN || "";
const seenUpdates = new Set<string>();

// --- Reconnection state 
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_DELAY_MS = 1000;

// --- Subscription request 
const subscribeRequest: SubscribeRequest = {
  slots: {
    slotSubscribe: {},
  },
  commitment: CommitmentLevel.PROCESSED,
  accounts: {},
  transactions: {},
  transactionsStatus: {},
  entry: {},
  blocks: {},
  blocksMeta: {},
  accountsDataSlice: [],
  ping: undefined,
};

// --- Main connect function
async function connectAndStream() {
  console.log(`\n🔌 Connecting to Yellowstone gRPC...`);
  console.log(`   Endpoint: ${ENDPOINT}\n`);

  try {
    const client = new Client(ENDPOINT, TOKEN, {});
    const stream = await client.subscribe();

    // --- Events 
    stream.on("data", (data: any) => {
      if (data.slot) {
        const slot      = data.slot.slot;
        const status    = data.slot.status;
        const timestamp = new Date().toISOString();

        const dedupeKey = `${slot}-${status}`;
        if (seenUpdates.has(dedupeKey)) return; // skip duplicate
        seenUpdates.add(dedupeKey);

        // Keep the set from growing forever
        if (seenUpdates.size > 1000) {
          seenUpdates.clear();
        }

        if (status === 0) {
          console.log(`📦 Slot: ${slot}  |  PROCESSED  |  ${timestamp}`);
        } else if (status === 1) {
          console.log(`✅ Slot: ${slot}  |  CONFIRMED`);
        } else if (status === 2) {
          console.log(`🔒 Slot: ${slot}  |  FINALIZED`);
        }
      }
    });

    stream.on("error", (err: any) => {
      console.error(`\n❌ Stream error: ${err.message}`);
      stream.destroy();
      scheduleReconnect();
    });

    stream.on("end", () => {
      console.warn(`\n⚠️  Stream ended.`);
      scheduleReconnect();
    });

    // ── Send subscription
    await new Promise<void>((resolve, reject) => {
      stream.write(subscribeRequest, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });

    reconnectAttempts = 0;
    console.log(`✅ Subscribed! Watching for slots...\n`);

  } catch (err: any) {
    console.error(`\n❌ Connection failed: ${err.message}`);
    scheduleReconnect();
  }
}

// --- Exponential backoff 
function scheduleReconnect() {
  if (reconnectScheduled) return; // prevent double-scheduling
  reconnectScheduled = true;

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error("Max reconnection attempts reached. Stopping.");
    process.exit(1);
  }
  reconnectAttempts++;
  const delay = BASE_DELAY_MS * Math.pow(2, Math.min(reconnectAttempts - 1, 5));
  console.log(`🔄 Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay / 1000}s...`);
  setTimeout(() => {
    reconnectScheduled = false; // reset for next failure
    connectAndStream().catch(console.error);
  }, delay);
}

// --- Graceful shutdown 
process.on("SIGINT", () => {
  console.log("\n\n🛑 Stopped by user.");
  process.exit(0);
});

// --- Start 
console.log("🚀 Smart Transaction Stack");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━");
connectAndStream();