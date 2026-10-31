import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrate } from "../src/db/schema.js";
import { importBridgeArtifact } from "../src/cards/effects/bridge-artifact.js";
import { storedBridgeEngine } from "../src/cards/effects/bridge-graph-store.js";
import { bridgeGate, buildBridgeJudgeEvidence, judgeBridgePair, ShownBridgeReviewSchema, shownBridge, type BridgeJudgeClient } from "../src/cards/effects/bridge-judge.js";
import { deterministicBridgeAlternatives } from "../src/cards/effects/bridge-step-text.js";

it("judges alternative paths together and derives captions without changing cached verdicts", async () => {
  const db = new Database(":memory:"); migrate(db); importBridgeArtifact(db);
  try {
    const row = storedBridgeEngine(db).deepBetween("Azamina", "White Forest")!;
    const evidence = buildBridgeJudgeEvidence(db, row)!;
    let calls = 0;
    const client: BridgeJudgeClient = { messages: { create: async request => {
      calls++;
      expect(request.model).toBe("claude-haiku-5-5");
      const sent = JSON.parse(request.messages[0]!.content as string);
      expect(sent.proposed_lines.length).toBeGreaterThanOrEqual(2);
      expect(sent).not.toHaveProperty("alternative_paths");
      return { id: `msg_alt_${calls}`, model: request.model, stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 },
        content: [{ type: "text", text: JSON.stringify({ verdict: "valid", grade: "good", pros: [], cons: [], lock_note: "",
          line: evidence.reasons[0]!.cards.map(id => evidence.cards.find(card => card.id === id)!.name), format_ok: true }) }] };
    } } };
    await judgeBridgePair(db, row, { client, env: {} });
    expect(calls).toBe(2);
    expect(bridgeGate(db, row).state).toBe("shown");
    const before = db.prepare("SELECT judgement_json FROM bridge_judgement ORDER BY judge").all();
    const shown = shownBridge(db, row)!;
    expect(shown.review.alternative_paths!.length).toBeGreaterThanOrEqual(1);
    expect(shown.review.alternative_paths!.length).toBeLessThanOrEqual(3);
    for (const path of shown.review.alternative_paths!) {
      expect(path.steps.map(step => step.card)).toEqual(path.line);
      expect(path.steps.some(step => step.text.length)).toBe(true);
      expect(path.line.every(name => evidence.cards.some(card => card.name === name))).toBe(true);
    }
    const broken = structuredClone(shown.review); broken.alternative_paths![0]!.steps[0]!.card = "Invented card";
    expect(ShownBridgeReviewSchema.safeParse(broken).success).toBe(false);
    expect(buildBridgeJudgeEvidence(db, row)!.input_hash).toBe(evidence.input_hash);
    await judgeBridgePair(db, row, { client, env: {} });
    expect(calls).toBe(2);
    expect(db.prepare("SELECT judgement_json FROM bridge_judgement ORDER BY judge").all()).toEqual(before);
  } finally { db.close(); }
});

it("orders rule-enabler alternatives from the actual Set edge", () => {
  const db = new Database(":memory:"); migrate(db); importBridgeArtifact(db);
  try {
    const engine = storedBridgeEngine(db), row = engine.deepBetween("Labrynth", "Ashtra")!;
    const reason = engine.reasons("Labrynth", "Ashtra", "advanced", true).find(reason => reason.key === "rule_enabler")!;
    const evidence = buildBridgeJudgeEvidence(db, { ...row, reasons: [reason], cards: reason.cards })!;
    const clock = deterministicBridgeAlternatives(evidence, [], engine.data.capabilities)[0]!;
    expect(clock.line).toEqual(["Labrynth Cooclock", "Yoa the Plague Deity Ashtra", "Ashtra Divine Domain"]);
  } finally { db.close(); }
});

it("keeps multiple legal recipients of one material outlet as alternatives", () => {
  const db = new Database(":memory:"); migrate(db); importBridgeArtifact(db);
  try {
    const engine = storedBridgeEngine(db), row = engine.deepBetween("Odion", "Blue-Eyes")!;
    const paths = row.reasons.filter(reason => reason.steps?.[0]?.from === 42097666);
    expect(new Set(paths.map(reason => reason.steps![0]!.to)).size).toBeGreaterThan(1);
    expect(paths.every(reason => engine.validateAccessPath(reason, "Odion", "Blue-Eyes", "advanced"))).toBe(true);
    expect(buildBridgeJudgeEvidence(db, row)!.proposed_lines.filter(line => line.reason === "extra_deck").length).toBeGreaterThan(1);
  } finally { db.close(); }
});
