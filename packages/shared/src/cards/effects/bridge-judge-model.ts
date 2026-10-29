export const BRIDGE_JUDGE_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5"] as const;
export type BridgeJudgeModel = typeof BRIDGE_JUDGE_MODELS[number];
const configured = process.env.BRIDGE_JUDGE_MODEL?.trim() || BRIDGE_JUDGE_MODELS[0];
if (!BRIDGE_JUDGE_MODELS.includes(configured as BridgeJudgeModel)) throw new Error("Unsupported BRIDGE_JUDGE_MODEL");
export const BRIDGE_JUDGE_MODEL = configured as BridgeJudgeModel;

// USD per million tokens equals microdollars per token. Source:
// https://platform.claude.com/docs/en/about-claude/pricing
export function bridgeJudgeRates(model: string = BRIDGE_JUDGE_MODEL, inputTokens = 0) {
  if (model.startsWith("claude-sonnet-5-5")) return { input: 2, output: 10, fiveWrite: 2.5, hourWrite: 4, read: 0.1 };
  if (!model.startsWith("claude-haiku-5-5")) throw new Error("Unsupported bridge judge billing model");
  const tier = inputTokens > 100_000 ? 5 : 1;
  return { input: 0.1 * tier, output: 0.5 * tier, fiveWrite: 0.125 * tier, hourWrite: 0.2 * tier, read: 0.01 * tier };
}
