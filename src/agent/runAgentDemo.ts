import { decideTip, TipDecisionInput } from "./tipAgent";

const scenarios: TipDecisionInput[] = [
  {
    tipPercentiles: { p25: 1000, p50: 5000, p75: 12000, p95: 50000 },
    currentSlot: 318500000,
    slotsUntilJitoLeader: 4,
    recentOutcomes: ["landed", "landed", "landed", "landed", "landed"],
    networkCondition: "low",
  },
  {
    tipPercentiles: { p25: 2000, p50: 15000, p75: 40000, p95: 120000 },
    currentSlot: 318500200,
    slotsUntilJitoLeader: 1,
    recentOutcomes: ["failed", "failed", "landed", "failed", "landed"],
    networkCondition: "high",
  },
  {
    tipPercentiles: { p25: 1500, p50: 8000, p75: 20000, p95: 70000 },
    currentSlot: 318500400,
    slotsUntilJitoLeader: 8,
    recentOutcomes: ["landed", "landed", "failed", "landed", "landed"],
    networkCondition: "moderate",
  },
];

async function main() {
  console.log("Smart Transaction Stack — Phase 5: AI Tip Agent Demo");
  console.log("=======================================================\n");

  for (let i = 0; i < scenarios.length; i++) {
    console.log(`Scenario ${i + 1}: network=${scenarios[i].networkCondition}, slots_to_leader=${scenarios[i].slotsUntilJitoLeader}`);
    console.log("-------------------------------------------------------");

    const result = await decideTip(scenarios[i]);

    console.log(result.reasoning);
    console.log(`\nFinal decision: ${result.tipLamports} lamports`);
    if (result.usedFallback) {
      console.log(`(FALLBACK USED — agent format was not followed)`);
    }
    console.log("\n=========================================================\n");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});