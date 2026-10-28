import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate } from "../src/db/schema.js";
import { bridgeHash, printedText } from "../src/cards/effects/bridge-text.js";
import type { ArchetypeBridge, CardCapability } from "../src/cards/effects/bridge-types.js";
import {
  BRIDGE_JUDGE_FRAMINGS, bridgeGate, bridgeJudgeIdentity, bridgeJudgeRequest,
  buildBridgeJudgeEvidence, judgeBridgePair, makeBridgeJudgementRecord, saveBridgeJudgement,
  type BridgeJudgement, type BridgeJudgeClient,
} from "../src/cards/effects/bridge-judge.js";
import { bridgeJudgeBilledMicros, bridgeJudgeSpendSummary } from "../src/cards/effects/bridge-judge-ledger.js";
import { exportBridgeJudgements, importBridgeJudgements } from "../src/cards/effects/bridge-judge-artifact.js";
import { createBridgeService } from "../src/services/archetype-bridges.js";

function fixture() {
  const db = new Database(":memory:"); migrate(db);
  const cards: CardCapability[] = [
    { id: 29762407, card: { id: 29762407, name: "Temple of the Kings", kind: "spell", typeLine: "Continuous Spell", subtypes: ["continuous"], text: "You can activate Trap Cards the turn they were Set.", formats: ["TCG"], genesysPoints: 0, views: 0, url: "" }, provides: [], needs: [], locks: [], text_hash: "", evidence_hash: "" },
    { id: 10000001, card: { id: 10000001, name: "Argostars - Glorious Adra", kind: "trap", typeLine: "Continuous Trap", subtypes: ["continuous"], text: "Special Summon this card as an Effect Monster (Warrior/LIGHT/Level 4/ATK 1800/DEF 1800).", formats: ["TCG"], genesysPoints: 0, views: 0, url: "" }, provides: [], needs: [], locks: [], text_hash: "", evidence_hash: "" },
  ];
  for (const row of cards) {
    row.text_hash = bridgeHash(printedText(row.card)); row.evidence_hash = bridgeHash(row.card);
    db.prepare("INSERT INTO card_capability VALUES(?,?,?,?,?)").run(row.id, JSON.stringify(row), row.text_hash, row.evidence_hash, "fixture");
  }
  db.prepare("INSERT INTO bridge_graph VALUES(1,?,?)").run(JSON.stringify({ groups: { Odion: [cards[0]!.id], Argostars: [cards[1]!.id] }, target_means: { advanced: {}, genesys: {} } }), "fixture");
  db.prepare("INSERT INTO card_tag_profiles(archetype,plan,hooks_json,source,schema_version,cards) VALUES(?,?,?,'fixture',1,1)").run("Odion", "Activates Trap Cards early.", "[]");
  db.prepare("INSERT INTO card_tag_profiles(archetype,plan,hooks_json,source,schema_version,cards) VALUES(?,?,?,'fixture',1,1)").run("Argostars", "Turns Trap Cards into monsters.", "[]");
  const bridge: ArchetypeBridge = { source: "Odion", target: "Argostars", format: "advanced", score: 15, raw_score: 15, target_mean: 0, two_way: false, grade: "Good", cards: cards.map(row => row.id), reasons: [{ key: "rule_enabler", weight: 10, cards: cards.map(row => row.id), evidence: cards.map(row => printedText(row.card)), description: "Temple enables the Trap Monster on the turn it is Set." }], warnings: [], genesys_points: null, validation: "deterministic", judge: "pending", engine_status: "unverified", evidence_hash: bridgeHash("fixture") };
  db.prepare("INSERT INTO archetype_bridge VALUES(?,?,?,?,?,?,?,?)").run(bridge.source, bridge.target, bridge.format, bridge.score, bridge.grade, JSON.stringify(bridge), bridge.evidence_hash, "fixture");
  return { db, bridge };
}
const result = (change: Partial<BridgeJudgement> = {}): BridgeJudgement => ({ verdict: "valid", grade: "good", pros: ["Temple enables early activation.", "Adra becomes a monster."], cons: ["Needs both cards.", "Requires setting the Trap first."], lock_note: "No relevant Summon lock in the supplied cards.", line: ["Temple of the Kings", "Argostars - Glorious Adra"], format_ok: true, ...change });
function approved(db: Database.Database, bridge: ArchetypeBridge, second = result()) {
  const evidence = buildBridgeJudgeEvidence(db, bridge)!;
  BRIDGE_JUDGE_FRAMINGS.forEach((framing, index) => saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing, index ? second : result())));
}

describe("bridge judgement pipeline", () => {
  it("requires both current judges before publishing and hides two distinct unresolved reports", () => {
    const { db, bridge } = fixture();
    try {
      const service = createBridgeService(db);
      expect(service.bridgesFrom("Odion")).toHaveLength(1);
      expect(service.shownFrom("Odion")).toEqual([]);
      expect(bridgeGate(db, bridge).state).toBe("pending");
      approved(db, bridge);
      expect(bridgeGate(db, bridge).state).toBe("shown");
      expect(service.shownFrom("Odion")[0]?.review.pros).toHaveLength(2);
      db.prepare("INSERT INTO bridge_feedback(evidence_hash,actor_hash,reason) VALUES(?,?,'')").run(bridge.evidence_hash, "one");
      expect(service.shownBetween("Odion", "Argostars")).not.toBeNull();
      db.prepare("INSERT INTO bridge_feedback(evidence_hash,actor_hash,reason) VALUES(?,?,'')").run(bridge.evidence_hash, "two");
      expect(bridgeGate(db, bridge).state).toBe("review");
      expect(service.shownFrom("Odion")).toEqual([]);
      db.prepare("UPDATE bridge_feedback SET resolved_at=current_timestamp WHERE actor_hash='two'").run();
      expect(service.shownFrom("Odion")).toHaveLength(1);
    } finally { db.close(); }
  });

  it("sends disagreement, uncertainty and grade gaps to review and rejects invented line cards", () => {
    const { db, bridge } = fixture();
    try {
      for (const second of [result({ verdict: "invalid" }), result({ verdict: "unsure" }), result({ grade: "risky" })]) {
        approved(db, bridge, second);
        expect(bridgeGate(db, bridge).state).toBe("review");
      }
      approved(db, bridge, result({ line: ["Temple of the Kings", "Invented Dragon"] }));
      expect(bridgeGate(db, bridge).state).toBe("review");
      const row = db.prepare("SELECT judgement_json FROM bridge_judgement WHERE judge=?").get(bridgeJudgeIdentity(buildBridgeJudgeEvidence(db, bridge)!, "skeptic")) as { judgement_json: string };
      expect(JSON.parse(row.judgement_json).result.verdict).toBe("invalid");
      approved(db, bridge, result({ format_ok: false }));
      expect(bridgeGate(db, bridge).state).toBe("review");
    } finally { db.close(); }
  });

  it("runs independent framed requests through a mocked SDK, bills cached tokens and reuses durable judgements", async () => {
    const { db, bridge } = fixture(); const requests: unknown[] = [];
    const client: BridgeJudgeClient = { messages: { async create(request) {
      requests.push(request);
      return { id: `msg_fixture_${requests.length}`, model: "claude-haiku-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(result()) }], usage: { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 1000 } };
    } } };
    try {
      expect((await judgeBridgePair(db, bridge, { client, log: () => {} })).state).toBe("shown");
      expect(requests).toHaveLength(2);
      expect(JSON.stringify(requests[0])).not.toBe(JSON.stringify(requests[1]));
      const request = bridgeJudgeRequest(buildBridgeJudgeEvidence(db, bridge)!, "mechanic");
      expect(request.model).toBe("claude-haiku-5-5");
      expect(request.thinking).toBeUndefined();
      expect(request.output_config?.format?.type).toBe("json_schema");
      expect(JSON.stringify(request.system)).toContain('"cache_control":{"type":"ephemeral"}');
      expect(bridgeJudgeSpendSummary(db).actualMicros).toBe(570);
      expect((await judgeBridgePair(db, bridge, { client, log: () => {} })).state).toBe("shown");
      expect(requests).toHaveLength(2);
      db.prepare("UPDATE card_tag_profiles SET plan='Different checked summary.' WHERE archetype='Odion'").run();
      expect(bridgeGate(db, bridge).state).toBe("pending");
      expect((await judgeBridgePair(db, bridge, { client, log: () => {} })).state).toBe("shown");
      expect(requests).toHaveLength(4);
    } finally { db.close(); }
  });

  it("fails closed on changed text, uncertain submissions, absent keys and configured spend caps", async () => {
    const { db, bridge } = fixture(); let calls = 0;
    const client: BridgeJudgeClient = { messages: { async create() { calls++; throw new Error("Uncertain submission"); } } };
    try {
      expect((await judgeBridgePair(db, bridge, { env: {}, log: () => {} })).state).toBe("pending");
      expect((await judgeBridgePair(db, bridge, { client, env: { BRIDGE_JUDGE_MONTHLY_USD: "0" }, log: () => {} })).state).toBe("pending");
      expect(calls).toBe(0);
      for (const actor of ["one", "two"]) db.prepare("INSERT INTO bridge_feedback(evidence_hash,actor_hash,reason) VALUES(?,?,'')").run(bridge.evidence_hash, actor);
      expect((await judgeBridgePair(db, bridge, { client, env: {}, log: () => {} })).state).toBe("review");
      expect(calls).toBe(0);
      db.prepare("DELETE FROM bridge_feedback").run();
      await judgeBridgePair(db, bridge, { client, env: {}, log: () => {} });
      await judgeBridgePair(db, bridge, { client, env: {}, log: () => {} });
      expect(calls).toBe(2);
      expect(bridgeJudgeSpendSummary(db).reservedMicros).toBeGreaterThan(0);
      approved(db, bridge);
      db.prepare("UPDATE card_capability SET text_hash=? WHERE passcode=?").run(bridgeHash("different"), bridge.cards[0]);
      expect(buildBridgeJudgeEvidence(db, bridge)).toBeNull();
      expect(bridgeGate(db, bridge).state).toBe("invalid");
    } finally { db.close(); }
  });

  it("keeps truncated or malformed paid replies in review and retains separate contexts sharing an evidence hash", async () => {
    const { db, bridge } = fixture(); let calls = 0;
    const client: BridgeJudgeClient = { messages: { async create() {
      calls++;
      return { id: `msg_invalid_${calls}`, model: "claude-haiku-5-5", stop_reason: calls === 1 ? "max_tokens" : "end_turn", content: [{ type: "text", text: "not JSON" }], usage: { input_tokens: 100, output_tokens: 10 } };
    } } };
    try {
      expect((await judgeBridgePair(db, bridge, { client, log: () => {} })).state).toBe("review");
      expect(bridgeJudgeSpendSummary(db).reservedMicros).toBe(0);
      expect(bridgeJudgeSpendSummary(db).actualMicros).toBe(30);
      approved(db, bridge);
      const other = { ...bridge, source: "Other source" };
      expect(bridgeGate(db, other).state).toBe("pending");
      approved(db, other);
      expect(bridgeGate(db, bridge).state).toBe("shown");
      expect(bridgeGate(db, other).state).toBe("shown");
      expect(db.prepare("SELECT count(*) AS n FROM bridge_judgement").get()).toEqual({ n: 4 });
      approved(db, bridge, result({ grade: "niche" }));
      expect(createBridgeService(db).shownBetween("Odion", "Argostars")?.grade).toBe("Niche");
    } finally { db.close(); }
  });

  it("round trips validated compressed records and ignores stale prompt identities", () => {
    const { db, bridge } = fixture(); const directory = mkdtempSync(join(tmpdir(), "bridge-judge-"));
    try {
      approved(db, bridge);
      expect(exportBridgeJudgements(db, directory).records).toBe(2);
      db.prepare("DELETE FROM bridge_judgement").run();
      expect(importBridgeJudgements(db, directory).imported).toBe(2);
      expect(bridgeGate(db, bridge).state).toBe("shown");
      db.prepare("UPDATE bridge_judgement SET judge='old-judge' WHERE judge=?").run(bridgeJudgeIdentity(buildBridgeJudgeEvidence(db, bridge)!, "skeptic"));
      expect(bridgeGate(db, bridge).state).toBe("pending");
      expect(bridgeJudgeBilledMicros({ input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 1000 }, true)).toBe(143);
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});
