import Anthropic from "@anthropic-ai/sdk";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface TipDecisionInput {
  tipPercentiles: { p25: number; p50: number; p75: number; p95: number };
  currentSlot: number;
  slotsUntilJitoLeader: number;
  recentOutcomes: ("landed" | "failed")[]; // last 5 bundle outcomes
  networkCondition: "low" | "moderate" | "high";
}

export interface TipDecisionOutput {
  tipLamports: number;
  reasoning: string;
}

export async function decideTip(input: TipDecisionInput): Promise<TipDecisionOutput> {
  const prompt = `You are managing Solana transaction tips for maximum landing probability on Jito.

Current tip percentiles (lamports):
- p25: ${input.tipPercentiles.p25}
- p50: ${input.tipPercentiles.p50}
- p75: ${input.tipPercentiles.p75}
- p95: ${input.tipPercentiles.p95}

Current slot: ${input.currentSlot}
Slots until next Jito leader: ${input.slotsUntilJitoLeader}
Last 5 bundle outcomes: [${input.recentOutcomes.join(", ")}]
Network condition: ${input.networkCondition}

Reason step-by-step about the optimal tip amount. Consider:
1. Cost — lower tip means less spent per bundle
2. Landing probability — higher tip increases odds of inclusion
3. Recent failure rate — if recent bundles failed, consider raising the tip
4. Urgency — fewer slots until the Jito leader window means less room to retry if this tip is too low

End your response with exactly this format on its own line:
TIP: <integer_lamports>`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  const fullText = textBlock && "text" in textBlock ? textBlock.text : "";

  const tipMatch = fullText.match(/TIP:\s*(\d+)/);
  const tipLamports = tipMatch ? parseInt(tipMatch[1], 10) : input.tipPercentiles.p50;

  return {
    tipLamports,
    reasoning: fullText.trim(),
  };
}