// Opt-in paid diagnostic, deliberately outside the test runner and CI.
// ANTHROPIC_API_KEY=... npx tsx scripts/effects/check-bridge-judges-live.ts --live
import Anthropic from "@anthropic-ai/sdk";
import Database from "better-sqlite3";
import { parseArgs } from "node:util";
import { migrate } from "@yugidraft/shared/db";
import { createBridgeService } from "@yugidraft/shared/services";
import {
  BRIDGE_JUDGE_FRAMINGS, BRIDGE_JUDGE_MODEL, bridgeJudgeBilledMicros, bridgeJudgeReservationMicros,
  buildBridgeJudgeEvidence, importBridgeArtifact, importCardEffectArtifact, judgeBridgePair,
  type BridgeJudgeClient, type BridgeJudgeReply, type BridgeJudgeRequest,
} from "@yugidraft/shared/cards/effects";

async function main() {
  const { values } = parseArgs({ options: { live: { type: "boolean", default: false } } });
  if (!values.live) throw new Error("Opt in to paid calls with --live; this script is never run in CI.");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required.");
  const sdk = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 60_000 });
  const db = new Database(":memory:");
  try {
    migrate(db); importCardEffectArtifact(db); importBridgeArtifact(db);
    const service = createBridgeService(db);
    for (const [source, target] of [["Odion", "Ashtra"], ["Snake-Eye", "Fire King"], ["Branded", "Despia"]] as const) {
      const bridge = service.bridgeBetween(source, target, "advanced");
      if (!bridge || !buildBridgeJudgeEvidence(db, bridge)) throw new Error(`Missing checked pair: ${source} -> ${target}`);
      const replies: { request: BridgeJudgeRequest; reply?: BridgeJudgeReply }[] = [];
      const client: BridgeJudgeClient = { messages: { async create(request, options) {
        const attempt: typeof replies[number] = { request }; replies.push(attempt);
        attempt.reply = await sdk.messages.create(request, options);
        return attempt.reply;
      } } };
      const errors: unknown[] = [];
      const gate = await judgeBridgePair(db, bridge, { client, log: () => {}, onError: entry => errors.push(entry) });
      const reviews = BRIDGE_JUDGE_FRAMINGS.map((framing, index) => {
        const attempt = replies[index], received = attempt?.reply, result = gate.judgements.find(row => row.framing === framing)?.result ?? null;
        let raw: unknown = null;
        try { raw = JSON.parse(received?.content.filter(part => part.type === "text").map(part => part.text ?? "").join("") ?? ""); } catch { /* No usable JSON. */ }
        return { framing, result, raw, usage: received?.usage ?? null,
          costUsd: received ? bridgeJudgeBilledMicros(received.usage, false, received.model) / 1_000_000 : 0,
          reservationUsd: attempt ? bridgeJudgeReservationMicros(attempt.request) / 1_000_000 : null };
      });
      console.log(JSON.stringify({ model: BRIDGE_JUDGE_MODEL, pair: `${source} -> ${target}`, state: gate.state,
        reviews, costUsd: reviews.reduce((sum, review) => sum + review.costUsd, 0), errors }));
      if (gate.state !== "shown") process.exitCode = 1;
    }
  } finally { db.close(); }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : "Live bridge check failed";
  const key = process.env.ANTHROPIC_API_KEY;
  console.error(key ? message.replaceAll(key, "[redacted]") : message);
  process.exitCode = 1;
});
