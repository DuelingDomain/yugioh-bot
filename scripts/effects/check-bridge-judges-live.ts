// Opt-in paid diagnostic, deliberately outside the test runner and CI.
// Load ANTHROPIC_API_KEY into the environment before invoking with --live.
import Anthropic from "@anthropic-ai/sdk";
import Database from "better-sqlite3";
import { parseArgs } from "node:util";
import { migrate } from "@yugidraft/shared/db";
import { createBridgeService } from "@yugidraft/shared/services";
import {
  BRIDGE_JUDGE_FRAMINGS, BRIDGE_JUDGE_MODEL, bridgeJudgeBilledMicros, bridgeJudgeReservationMicros,
  buildBridgeJudgeEvidence, importBridgeArtifact, importCardEffectArtifact, judgeBridgePair, shownBridge,
  type BridgeJudgeClient, type BridgeJudgeReply, type BridgeJudgeRequest, type BridgeJudgeFraming,
} from "@yugidraft/shared/cards/effects";

async function main() {
  const { values } = parseArgs({ options: { live: { type: "boolean", default: false }, source: { type: "string" }, target: { type: "string" } } });
  if (!values.live) throw new Error("Opt in to paid calls with --live; this script is never run in CI.");
  if (!!values.source !== !!values.target) throw new Error("Pass both --source and --target to check one pair.");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required.");
  const sdk = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 60_000 });
  const db = new Database(":memory:");
  try {
    migrate(db); importCardEffectArtifact(db); importBridgeArtifact(db);
    const service = createBridgeService(db);
    const pairs = [["Odion", "Ashtra"], ["Odion", "Argostars"], ["Snake-Eye", "Fire King"], ["Snake-Eye", "Diabell"],
      ["Branded", "Despia"], ["Branded", "Bystial"], ["Kashtira", "Tearlaments"], ["Swordsoul", "Tenyi"],
      ["Danger!", "Dark World"], ["Blue-Eyes", "Black Luster Soldier"]] as const;
    const selected: readonly (readonly [string, string])[] = values.source && values.target ? [[values.source, values.target]] : pairs;
    for (const [source, target] of selected) {
      const bridge = service.bridgeBetween(source, target, "advanced");
      const evidence = bridge && buildBridgeJudgeEvidence(db, bridge);
      if (!bridge || !evidence) throw new Error(`Missing checked pair: ${source} -> ${target}`);
      const replies: { request: BridgeJudgeRequest; reply?: BridgeJudgeReply; phase: "judge" | "fact_check"; framing: BridgeJudgeFraming }[] = [];
      let judgeIndex = 0;
      const client: BridgeJudgeClient = { messages: { async create(request, options) {
        const phase = "sentences" in JSON.parse(request.messages[0]!.content as string) ? "fact_check" : "judge";
        const framing = BRIDGE_JUDGE_FRAMINGS[phase === "judge" ? judgeIndex++ : judgeIndex - 1]!;
        const attempt: typeof replies[number] = { request, phase, framing }; replies.push(attempt);
        attempt.reply = await sdk.messages.create(request, options);
        return attempt.reply;
      } } };
      const errors: unknown[] = [];
      const gate = await judgeBridgePair(db, bridge, { client, log: () => {}, onError: entry => errors.push(entry) });
      const calls = replies.map(({ request, reply, phase, framing }) => {
        let raw: unknown = null;
        try { raw = JSON.parse(reply?.content.filter(part => part.type === "text").map(part => part.text ?? "").join("") ?? ""); } catch { /* No usable JSON. */ }
        return { phase, framing, stopReason: reply?.stop_reason ?? null, raw, usage: reply?.usage ?? null,
          costUsd: reply ? bridgeJudgeBilledMicros(reply.usage, false, reply.model) / 1_000_000 : 0,
          reservationUsd: bridgeJudgeReservationMicros(request) / 1_000_000 };
      });
      const dropCounts: Record<string, number> = {};
      for (const row of gate.judgements) for (const sentence of row.result.text_audit ?? []) {
        if (sentence.status === "dropped") dropCounts[sentence.reason] = (dropCounts[sentence.reason] ?? 0) + 1;
      }
      console.log(JSON.stringify({ model: BRIDGE_JUDGE_MODEL, pair: `${source} -> ${target}`, state: gate.state,
        grade: gate.grade ?? null, shown: shownBridge(db, bridge)?.review ?? null, warnings: bridge.warnings,
        reviews: gate.judgements.map(row => ({ framing: row.framing, result: row.result })), calls, dropCounts,
        costUsd: Math.round(calls.reduce((sum, call) => sum + call.costUsd, 0) * 1_000_000) / 1_000_000, evidence, errors }));
      // Invalid/review are legitimate measured outcomes; only missing reviews fail the diagnostic.
      if (gate.state === "pending" || errors.length) process.exitCode = 1;
    }
  } finally { db.close(); }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : "Live bridge check failed";
  const key = process.env.ANTHROPIC_API_KEY;
  console.error((key ? message.replaceAll(key, "[redacted]") : message).replace(/sk-ant-[\w-]+/g, "[redacted]"));
  process.exitCode = 1;
});
