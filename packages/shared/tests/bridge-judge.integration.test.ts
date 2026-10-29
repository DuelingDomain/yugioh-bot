import { APIError, APIConnectionError, APIConnectionTimeoutError, APIUserAbortError, InternalServerError, RateLimitError } from "@anthropic-ai/sdk";
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
  buildBridgeJudgeEvidence, judgeBridgePair, makeBridgeJudgementRecord, parseBridgeJudgement, saveBridgeJudgement,
  shownBridge, type BridgeJudgement, type BridgeJudgeClient,
} from "../src/cards/effects/bridge-judge.js";
import { bridgeJudgeBilledMicros, bridgeJudgeReservationMicros, bridgeJudgeSpendSummary, reserveBridgeJudgeSpend, startBridgeJudgeSpend } from "../src/cards/effects/bridge-judge-ledger.js";
import { exportBridgeJudgements, importBridgeJudgements } from "../src/cards/effects/bridge-judge-artifact.js";
import { importBridgeArtifact } from "../src/cards/effects/bridge-artifact.js";
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
const result = (change: Partial<BridgeJudgement> = {}): BridgeJudgement => ({ verdict: "valid", grade: "good", pros: ["Temple of the Kings allows Argostars - Glorious Adra to be activated the turn it was Set, subject to its printed activation conditions."], cons: ["Needs both cards.", "Requires setting the Trap first."], lock_note: "No relevant Summon lock in the supplied cards.", line: ["Temple of the Kings", "Argostars - Glorious Adra"], format_ok: true, ...change });
function approved(db: Database.Database, bridge: ArchetypeBridge, second = result()) {
  const evidence = buildBridgeJudgeEvidence(db, bridge)!;
  BRIDGE_JUDGE_FRAMINGS.forEach((framing, index) => saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing, index ? second : result())));
}

describe("bridge judgement pipeline", () => {
  it("reserves and bills enough output for grounded reviews with long thinking", async () => {
    const { db, bridge } = fixture();
    const client: BridgeJudgeClient = { messages: { async create(request) {
      expect(request.max_tokens).toBeGreaterThanOrEqual(5000);
      return { id: "msg_long_thinking", model: "claude-haiku-5-5", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 5000 },
        content: [{ type: "text", text: JSON.stringify(result()) }] };
    } } };
    try {
      expect((await judgeBridgePair(db, bridge, { client, env: {}, log: () => {} })).state).toBe("shown");
      expect(bridgeJudgeSpendSummary(db)).toMatchObject({ actualMicros: 5020, reservedMicros: 0 });
    } finally { db.close(); }
  });

  it("never trusts provider-supplied kept audit entries", async () => {
    const { db, bridge } = fixture();
    const client: BridgeJudgeClient = { messages: { async create() {
      return { id: "msg_injected_audit", model: "claude-haiku-5-5", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 10 },
        content: [{ type: "text", text: JSON.stringify({ ...result(), text_audit: [{ field: "cons", sentence: "Traps activate from the hand.",
          citations: [{ card: "Temple of the Kings", quote: "You can activate Trap Cards the turn they were Set." }], status: "kept", reason: "fact_check_yes" }] }) }] };
    } } };
    try {
      expect((await judgeBridgePair(db, bridge, { client, env: {}, log: () => {} })).state).toBe("pending");
      expect(db.prepare("SELECT count(*) AS n FROM bridge_judgement").get()).toEqual({ n: 0 });
      expect(bridgeJudgeSpendSummary(db)).toMatchObject({ actualMicros: 30, reservedMicros: 0 });
    } finally { db.close(); }
  });
  it("only shows deterministic pros confirmed by a provider reply", async () => {
    const { db, bridge } = fixture();
    const client: BridgeJudgeClient = { messages: { async create(request) {
      const choices = JSON.parse(request.messages[0]!.content as string).deterministic_pros;
      const schema = request.output_config!.format!.schema as any;
      expect(schema.properties.pros.items.enum).toEqual(choices);
      return { id: "msg_no_confirmed_pros", model: "claude-haiku-5-5", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 10 },
        content: [{ type: "text", text: JSON.stringify(result({ pros: ["Invented benefit."] })) }] };
    } } };
    try {
      expect((await judgeBridgePair(db, bridge, { client, env: {}, log: () => {} })).state).toBe("shown");
      expect(shownBridge(db, bridge)?.review.pros).toEqual([]);
    } finally { db.close(); }
  });
  it("filters each grounded sentence, bills the fact-check, and leaves verdicts independent", async () => {
    const { db, bridge } = fixture(); let calls = 0;
    const supported = "Temple of the Kings allows Trap Cards to be activated the turn they were Set.";
    const falseClaim = "Temple of the Kings allows Trap Cards to be activated from the hand.";
    const quote = "You can activate Trap Cards the turn they were Set.";
    const client: BridgeJudgeClient = { messages: { async create(request) {
      calls++;
      const input = JSON.parse(request.messages[0]!.content as string);
      const content = input.sentences ? { checks: input.sentences.map((s: { id: number; sentence: string }) => ({ id: s.id, supported: s.sentence === supported ? "yes" : "no" })) }
        : { ...result({ cons: [supported, falseClaim, "Needs an invented card."], lock_note: "Unsupported lock." }), grounding: [
          { field: "cons", sentence: supported, citations: [{ card: "Temple of the Kings", quote: quote.toUpperCase().replaceAll(" ", "  ") }] },
          { field: "cons", sentence: falseClaim, citations: [{ card: "Temple of the Kings", quote }] },
          { field: "lock_note", sentence: "Unsupported lock.", citations: [{ card: "Missing card", quote }] },
        ] };
      return { id: `msg_grounded_${calls}`, model: "claude-haiku-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(content) }], usage: { input_tokens: 100, output_tokens: 10 } };
    } } };
    try {
      expect((await judgeBridgePair(db, bridge, { client, env: {}, log: () => {} })).state).toBe("shown");
      expect(calls).toBe(4);
      expect(bridgeJudgeSpendSummary(db)).toMatchObject({ requests: 4, actualMicros: 60, reservedMicros: 0 });
      expect(shownBridge(db, bridge)?.review.cons).toEqual([supported]);
      expect(shownBridge(db, bridge)?.review.lock_note).toBe("");
      expect(JSON.stringify(shownBridge(db, bridge))).not.toContain("text_audit");
      const audits = bridgeGate(db, bridge).judgements.flatMap(row => (row.result as any).text_audit);
      expect(audits.filter((s: any) => s.status === "dropped")).toHaveLength(6);
      expect(audits.map((s: any) => s.reason)).toEqual(expect.arrayContaining(["fact_check_no", "missing_quote", "invalid_quote"]));
      await judgeBridgePair(db, bridge, { client, env: {}, log: () => {} });
      expect(calls).toBe(4);
    } finally { db.close(); }
  });
  it("shows checked actions instead of model-written pros", () => {
    const db = new Database(":memory:"); migrate(db);
    try {
      importBridgeArtifact(db);
      for (const [source, target, expected] of [
        ["Snake-Eye", "Fire King", "Snake-Eye Ash adds Legendary Fire King Ponix (Level 1 FIRE) from the Deck to the hand, subject to its printed activation conditions."],
        ["Drytron", "Ursarctic", "Drytron Eclipse adds Ultimate Bright Knight Ursatron Alpha (Level 7 WATER) from the GY to the hand, subject to its printed activation conditions."],
        ["Odion", "Ashtra", "Temple of the Kings allows Ashtra Divine Domain to be activated the turn it was Set, subject to its printed activation conditions."],
      ]) {
        const bridge = createBridgeService(db).bridgeBetween(source!, target!)!;
        const evidence = buildBridgeJudgeEvidence(db, bridge)!;
        for (const framing of BRIDGE_JUDGE_FRAMINGS) saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing,
          result({ pros: ["Invented free-form benefit."], line: evidence.cards.slice(0, 2).map(card => card.name) })));
        expect(shownBridge(db, bridge)?.review.pros[0]).toBe(expected);
        expect(JSON.stringify(shownBridge(db, bridge)?.review)).not.toContain("Invented free-form benefit");
      }
    } finally { db.close(); }
  });
  it("uses printed lock data when no model lock sentence survives", () => {
    const db = new Database(":memory:"); migrate(db);
    try {
      importBridgeArtifact(db);
      const bridge = createBridgeService(db).bridgeBetween("Branded", "Despia")!;
      const evidence = buildBridgeJudgeEvidence(db, bridge)!;
      for (const framing of BRIDGE_JUDGE_FRAMINGS) saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing,
        result({ line: ["Branded Opening", "Despian Tragedy"], lock_note: "Invented lock." })));
      const printedLocks = evidence.cards.flatMap(card => card.locks.map(lock => `${card.name}: ${lock.evidence}`)).join(" ");
      expect(printedLocks).toContain("except Fusion Monsters");
      expect(shownBridge(db, bridge)?.review).toMatchObject({ cons: [], lock_note: printedLocks });
      expect(JSON.stringify(shownBridge(db, bridge))).not.toContain("text_audit");
    } finally { db.close(); }
  });
  it.each(["malformed", "duplicate", "missing", "wrong-model", "truncated", "network"])("drops text when the fact-check is %s while keeping and billing the verdicts", async failure => {
    const { db, bridge } = fixture(); let calls = 0;
    const sentence = "Temple of the Kings permits Trap activation on the turn Set.";
    const client: BridgeJudgeClient = { messages: { async create(request) {
      calls++;
      const check = "sentences" in JSON.parse(request.messages[0]!.content as string);
      if (check && failure === "network") throw new APIConnectionError({ message: "Unavailable" });
      const body = check ? { checks: failure === "duplicate" ? [{ id: 0, supported: "yes" }, { id: 0, supported: "yes" }] : [] }
        : { ...result({ cons: [sentence], lock_note: "" }), grounding: [{ field: "cons", sentence, citations: [{ card: "Temple of the Kings", quote: "You can activate Trap Cards the turn they were Set." }] }] };
      return { id: `msg_check_failure_${calls}`, model: check && failure === "wrong-model" ? "claude-sonnet-5-5" : "claude-haiku-5-5",
        stop_reason: check && failure === "truncated" ? "max_tokens" : "end_turn",
        content: [{ type: "text", text: check && failure === "malformed" ? "invalid JSON" : JSON.stringify(body) }], usage: { input_tokens: 100, output_tokens: 10 } };
    } } };
    try {
      expect((await judgeBridgePair(db, bridge, { client, env: {}, log: () => {} })).state).toBe("shown");
      expect(shownBridge(db, bridge)?.review.cons).toEqual([]);
      expect(calls).toBe(4);
      expect(bridgeJudgeSpendSummary(db)).toMatchObject({ actualMicros: failure === "network" ? 30 : failure === "wrong-model" ? 630 : 60, reservedMicros: 0 });
    } finally { db.close(); }
  });
  it("sends full card facts and explicit actions for the three live-check pairs", () => {
    const db = new Database(":memory:"); migrate(db);
    try {
      importBridgeArtifact(db);
      for (const [source, target] of [["Odion", "Ashtra"], ["Snake-Eye", "Fire King"], ["Branded", "Despia"]]) {
        const bridge = createBridgeService(db).bridgeBetween(source!, target!)!;
        const evidence = buildBridgeJudgeEvidence(db, bridge)!;
        const request = bridgeJudgeRequest(evidence, "mechanic");
        const sent = JSON.parse(request.messages[0]!.content as string) as typeof evidence;
        expect(sent.cards.every(card => "archetype" in card && Array.isArray(card.archetypes) && card.type_line && card.text)).toBe(true);
        for (const card of sent.cards) {
          const stored = JSON.parse((db.prepare("SELECT capabilities_json FROM card_capability WHERE passcode=?").get(card.id) as { capabilities_json: string }).capabilities_json) as CardCapability;
          expect(card.text).toBe(printedText(stored.card));
          expect(card.archetype).toBe(stored.card.archetype ?? null);
          expect(card.attribute).toBe(stored.card.attribute); expect(card.level).toBe(stored.card.level);
        }
        const actions = sent.proposed_lines.flatMap(line => line.steps.map(step => step.action));
        expect(actions).toContain(source === "Odion" ? "set" : "search");
        if (source === "Odion") expect(sent.cards.find(card => card.name === "Temple of the Kings")!.bridge_groups).toContain("Odion");
        if (source === "Snake-Eye") {
          expect(sent.cards.find(card => card.name === "Fire King Island")!.archetype).toBe("Fire King");
          expect(sent.proposed_lines[0]!.steps[0]!.detail).toContain("does not Summon");
        }
        if (source === "Branded") {
          for (const framing of BRIDGE_JUDGE_FRAMINGS) saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing,
            result({ pros: ['Branded Opening searches a "Despia" monster: Despian Tragedy.'], line: ["Branded Opening", "Despian Tragedy"] }), undefined, db));
          expect(bridgeGate(db, bridge).state).toBe("shown");
        }
      }
    } finally { db.close(); }
  });
  it("reports provider status and message without exposing the credential", async () => {
    const { db, bridge } = fixture(), errors: { status: number | null; message: string }[] = [];
    const credential = "integration-provider-credential";
    const client: BridgeJudgeClient = { messages: { async create() {
      throw new APIError(400, { error: { message: `Unsupported schema ${credential}` } }, "Unsupported schema", new Headers());
    } } };
    try {
      expect((await judgeBridgePair(db, bridge, { client, apiKey: credential, env: {}, log: () => {}, onError: entry => errors.push(entry) })).state).toBe("pending");
      expect(errors).toHaveLength(2);
      expect(errors[0]).toMatchObject({ status: 400 });
      expect(errors[0]!.message).toContain("Unsupported schema");
      expect(JSON.stringify(errors)).not.toContain(credential);
    } finally { db.close(); }
  });
  it("normalizes paid replies without sending unsupported schema bounds or storing fallback text", async () => {
    const { db, bridge } = fixture(); let calls = 0;
    const client: BridgeJudgeClient = { messages: { async create(request) {
      const schema = JSON.stringify(request.output_config?.format);
      expect(schema).not.toMatch(/minItems|maxItems|minLength|maxLength/);
      calls++;
      const reply = calls <= 2 ? result({ pros: [" ", "No lock metadata is present and the format is legal.", "Temple of the Kings enables early activation.", "x".repeat(600), "Extra pro", "Overflow"],
        cons: ["Needs both cards.", "Requires setting first.", "Needs a free zone.", "Overflow"], line: [] , verdict: "invalid" }) : result();
      return { id: `msg_normalize_${calls}`, model: "claude-haiku-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(reply) }], usage: { input_tokens: 100, output_tokens: 10 } };
    } } };
    try {
      const gate = await judgeBridgePair(db, bridge, { client, env: {}, log: () => {} });
      expect(gate.state).toBe("invalid");
      expect(gate.judgements).toHaveLength(2);
      for (const row of gate.judgements) {
        expect(row.result.pros).toEqual([]);
        expect(row.result.cons).toEqual([]); expect(row.result.line).toEqual([]);
      }
      expect(db.prepare("SELECT DISTINCT verdict FROM bridge_judgement").all()).toEqual([{ verdict: "rejected" }]);
    } finally { db.close(); }
  });
  it("allows independent reviews to grade substantive lines without a Link-1 ceiling", () => {
    const db = new Database(":memory:"); migrate(db);
    try {
      importBridgeArtifact(db);
      const bridge = createBridgeService(db).bridgeBetween("Endymion", "Magistus")!;
      expect(bridge.reasons.some(reason => reason.key === "extra_deck" && reason.cards.includes(34755994))).toBe(false);
      const evidence = buildBridgeJudgeEvidence(db, bridge)!;
      for (const grade of ["good", "strong"] as const) {
        for (const framing of BRIDGE_JUDGE_FRAMINGS) saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing,
          result({ grade, pros: ["The supplied cards interact.", "The evidence reaches the target."], line: evidence.cards.map(card => card.name) })));
        expect(bridgeGate(db, bridge)).toMatchObject({ state: "shown", grade });
        expect(shownBridge(db, bridge)?.grade.toLowerCase()).toBe(grade);
      }
    } finally { db.close(); }
  });

  it("keeps a single hybrid outlet below Strong after independent reviews", () => {
    const db = new Database(":memory:"); migrate(db);
    try {
      importBridgeArtifact(db);
      const bridge = createBridgeService(db).bridgeBetween("Blue-Eyes", "Millennium")!;
      const evidence = buildBridgeJudgeEvidence(db, bridge)!;
      for (const framing of BRIDGE_JUDGE_FRAMINGS) saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing,
        result({ grade: "strong", pros: ["The supplied cards interact.", "The evidence reaches the target."], line: evidence.cards.map(card => card.name) })));
      expect(bridgeGate(db, bridge)).toMatchObject({ state: "shown", grade: "good" });
      expect(shownBridge(db, bridge)?.grade).toBe("Good");
    } finally { db.close(); }
  });

  it("requires both current judges before publishing and hides two distinct unresolved reports", () => {
    const { db, bridge } = fixture();
    try {
      const service = createBridgeService(db);
      expect(service.bridgesFrom("Odion")).toHaveLength(1);
      expect(service.shownFrom("Odion")).toEqual([]);
      expect(bridgeGate(db, bridge).state).toBe("pending");
      approved(db, bridge);
      expect(bridgeGate(db, bridge).state).toBe("shown");
      expect(service.shownFrom("Odion")[0]?.review.pros).toHaveLength(1);
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

  it("drops ungrounded outside-card prose without changing independent verdicts", () => {
    const { db, bridge } = fixture();
    try {
      const outside = { ...JSON.parse((db.prepare("SELECT capabilities_json FROM card_capability LIMIT 1").get() as { capabilities_json: string }).capabilities_json), id: 89631139 };
      outside.card = { ...outside.card, id: outside.id, name: "Blue-Eyes White Dragon" };
      db.prepare("INSERT INTO card_capability VALUES(?,?,?,?,?)").run(outside.id, JSON.stringify(outside), outside.text_hash, outside.evidence_hash, "fixture");
      for (const change of [
        { pros: ["Search Blue-Eyes White Dragon.", "Enables early activation."] },
        { cons: ["Needs Blue-Eyes White Dragon.", "Requires setting first."] },
        { lock_note: "Blue-Eyes White Dragon avoids this restriction." },
        { pros: ['Search "Imaginary Temple Dragon".', "Enables early activation."] },
        { cons: ['Requires “Imaginary Temple Dragon”.', "Needs both cards."] },
        { lock_note: "Summon 'Imaginary Temple Dragon' to avoid the restriction." },
        { lock_note: "Summon ‘Imaginary Temple Dragon’ to avoid the restriction." },
        { lock_note: "Use ['Imaginary Temple Dragon']." },
        { lock_note: "Use 'Imaginary Dragon's Temple'." },
        { lock_note: "Summon:‘Imaginary Temple Dragon’." },
      ]) {
        approved(db, bridge, result(change));
        expect(bridgeGate(db, bridge).state).toBe("shown");
        expect(shownBridge(db, bridge)?.review.cons).toEqual([]);
        expect(shownBridge(db, bridge)?.review.lock_note).toBe("");
      }
      approved(db, bridge, result({ lock_note: "Temple of the Kings permits early Trap activation." }));
      expect(bridgeGate(db, bridge).state).toBe("shown");
      for (const lock_note of ['Use "Temple of the Kings".', "Use 'Temple of the Kings'.", 'Use “Temple of the Kings”.', 'Use ‘Temple of the Kings’.']) {
        approved(db, bridge, result({ lock_note }));
        expect(bridgeGate(db, bridge).state).toBe("shown");
      }
      approved(db, bridge, result({ lock_note: "Argostars - Glorious Adra's effect uses Temple of the Kings' permission." }));
      expect(bridgeGate(db, bridge).state).toBe("shown");
      const evidence = buildBridgeJudgeEvidence(db, bridge)!;
      const quotedCard = { ...evidence.cards[0]!, name: '"A" Cell Recombination Device' };
      expect(parseBridgeJudgement(result({ line: [quotedCard.name], lock_note: `Use ${quotedCard.name}.` }), { ...evidence, cards: [quotedCard] })?.verdict).toBe("valid");
    } finally { db.close(); }
  });

  it("preserves two invalid verdicts as rejected even when their explanations mention outside cards", () => {
    const { db, bridge } = fixture();
    try {
      const evidence = buildBridgeJudgeEvidence(db, bridge)!;
      for (const framing of BRIDGE_JUDGE_FRAMINGS) saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing,
        result({ verdict: "invalid", line: [], cons: ['Requires "Imaginary Temple Dragon".', "Needs both cards."] }), undefined, db));
      expect(bridgeGate(db, bridge).state).toBe("invalid");
      expect(db.prepare("SELECT DISTINCT verdict FROM bridge_judgement").all()).toEqual([{ verdict: "rejected" }]);
    } finally { db.close(); }
  });

  it("distinguishes ambiguous card titles from ordinary rule explanations", () => {
    const { db, bridge } = fixture();
    try {
      const base = JSON.parse((db.prepare("SELECT capabilities_json FROM card_capability LIMIT 1").get() as { capabilities_json: string }).capabilities_json);
      for (const [index, name] of ["7", "Return", "NEXT", "Fine", "Jinzo", "Raigeki"].entries()) {
        const outside = { ...base, id: 20000000 + index, card: { ...base.card, id: 20000000 + index, name } };
        db.prepare("INSERT INTO card_capability VALUES(?,?,?,?,?)").run(outside.id, JSON.stringify(outside), outside.text_hash, outside.evidence_hash, "fixture");
      }
      for (const lock_note of ["Activate Return.", "Search NEXT.", "Search Fine.", 'Use "7".', "The Return card is outside the supplied line.", "Jinzo negates Trap effects.", "Raigeki destroys opposing monsters."]) {
        approved(db, bridge, result({ lock_note }));
        expect(bridgeGate(db, bridge).state, lock_note).toBe("shown");
        expect(shownBridge(db, bridge)?.review.lock_note).toBe("");
      }
      for (const lock_note of [
        "The supplied monster is Level 7.",
        "Return the supplied material to the hand.",
        "Use the next effect after setting the Trap.",
        "The order is fine once the Trap is Set.",
        "Requires 7 cards.",
      ]) {
        approved(db, bridge, result({ lock_note }));
        expect(bridgeGate(db, bridge).state, lock_note).toBe("shown");
      }
    } finally { db.close(); }
  });

  it.each([
    new APIConnectionError({ message: "Network unavailable" }),
    new APIConnectionTimeoutError(),
    new APIUserAbortError(),
    ...[400, 401, 403, 404, 413].map(status => new APIError(status, {}, "Request rejected", new Headers())),
    new RateLimitError(429, {}, "Rate limited", new Headers()),
    new InternalServerError(500, {}, "Internal error", new Headers()),
    new InternalServerError(529, {}, "Overloaded", new Headers()),
  ])("releases real SDK failures for a later search (%s)", async (error) => {
    const { db, bridge } = fixture(); let calls = 0;
    const client: BridgeJudgeClient = { messages: { async create() {
      calls++;
      if (calls <= 2) throw error;
      return { id: `msg_dated_${calls}`, model: "claude-haiku-5-5-20261001", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(result()) }], usage: { input_tokens: 1000, output_tokens: 100 } };
    } } };
    try {
      expect((await judgeBridgePair(db, bridge, { client, env: {}, log: () => {} })).state).toBe("pending");
      expect(bridgeJudgeSpendSummary(db).reservedMicros).toBe(0);
      expect((await judgeBridgePair(db, bridge, { client, env: {}, log: () => {} })).state).toBe("shown");
      expect(calls).toBe(4);
      expect(bridgeJudgeSpendSummary(db).actualMicros).toBe(300);
    } finally { db.close(); }
  });

  it("retains reservations when an unknown response model cannot be billed", async () => {
    const { db, bridge } = fixture();
    const client: BridgeJudgeClient = { messages: { async create() {
      return { id: "invalid", model: "unexpected-model", stop_reason: "end_turn", content: [], usage: { input_tokens: 100, output_tokens: 10 } };
    } } };
    try {
      expect((await judgeBridgePair(db, bridge, { client, env: {}, log: () => {} })).state).toBe("pending");
      expect(bridgeJudgeSpendSummary(db)).toMatchObject({ requests: 2, actualMicros: 0 });
      expect(bridgeJudgeSpendSummary(db).reservedMicros).toBeGreaterThan(0);
    } finally { db.close(); }
  });

  it("does not charge old unsettled reservations against a later month's cap", () => {
    const { db, bridge } = fixture();
    try {
      const january = new Date("2026-01-31T23:59:00Z"), february = new Date("2026-02-01T00:01:00Z");
      const request = bridgeJudgeRequest(buildBridgeJudgeEvidence(db, bridge)!, "mechanic");
      const monthlyUsd = bridgeJudgeReservationMicros(request) * 1.5 / 1_000_000;
      expect(monthlyUsd).toBeLessThan(0.02);
      const first = reserveBridgeJudgeSpend(db, { request, count: 1, now: january, monthlyUsd })!;
      startBridgeJudgeSpend(db, first);
      expect(reserveBridgeJudgeSpend(db, { request, count: 1, now: january, monthlyUsd })).toBeNull();
      expect(reserveBridgeJudgeSpend(db, { request, count: 1, now: february, monthlyUsd })).not.toBeNull();
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

  it("releases an aborted live request and retries only on a later invocation", async () => {
    const { db, bridge } = fixture(); const controller = new AbortController(); let calls = 0;
    const client: BridgeJudgeClient = { messages: { async create(_request, options) {
      calls++;
      if (calls === 1) await new Promise<void>((_resolve, reject) => options!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
      return { id: `msg_abort_${calls}`, model: "claude-haiku-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(result()) }], usage: { input_tokens: 100, output_tokens: 10 } };
    } } };
    try {
      const pending = judgeBridgePair(db, bridge, { client, signal: controller.signal, log: () => {} });
      controller.abort();
      expect((await pending).state).toBe("pending");
      expect(calls).toBe(1);
      expect(bridgeJudgeSpendSummary(db).reservedMicros).toBe(0);
      expect((await judgeBridgePair(db, bridge, { client, log: () => {} })).state).toBe("shown");
      expect(calls).toBe(3);
      expect(bridgeJudgeSpendSummary(db).actualMicros).toBe(30);
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

  it("keeps truncated or malformed paid replies pending and retryable without canned text", async () => {
    const { db, bridge } = fixture(); let calls = 0;
    const client: BridgeJudgeClient = { messages: { async create() {
      calls++;
      return { id: `msg_invalid_${calls}`, model: "claude-haiku-5-5", stop_reason: calls === 1 ? "max_tokens" : "end_turn", content: [{ type: "text", text: "not JSON" }], usage: { input_tokens: 100, output_tokens: 10 } };
    } } };
    try {
      expect((await judgeBridgePair(db, bridge, { client, log: () => {} })).state).toBe("pending");
      expect(db.prepare("SELECT count(*) AS n FROM bridge_judgement").get()).toEqual({ n: 0 });
      expect(bridgeJudgeSpendSummary(db).reservedMicros).toBe(0);
      expect(bridgeJudgeSpendSummary(db).actualMicros).toBe(30);
      await judgeBridgePair(db, bridge, { client, log: () => {} });
      expect(calls).toBe(4);
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
