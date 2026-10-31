import Database from "better-sqlite3";
import { beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/schema.js";
import { importBridgeArtifact } from "../src/cards/effects/bridge-artifact.js";
import { BridgeEngine, bridgeLegal, indexBridgeCapabilities } from "../src/cards/effects/bridge-engine.js";
import { bridgeMaterials } from "../src/cards/effects/bridge-materials.js";
import { storedBridgeEngine } from "../src/cards/effects/bridge-graph-store.js";
import { buildBridgeJudgeEvidence } from "../src/cards/effects/bridge-judge.js";
import { canReceiveSummon, matchesBridgeFilter, printedText } from "../src/cards/effects/bridge-text.js";
import type { BridgeGraphData, BridgeReason, CardCapability } from "../src/cards/effects/bridge-types.js";

let data: BridgeGraphData;
beforeAll(() => {
  const db = new Database(":memory:");
  try {
    migrate(db); importBridgeArtifact(db);
    const graph = JSON.parse((db.prepare("SELECT graph_json FROM bridge_graph WHERE id=1").get() as { graph_json: string }).graph_json);
    const capabilities = (db.prepare("SELECT capabilities_json FROM card_capability ORDER BY passcode").all() as { capabilities_json: string }[])
      .map(row => JSON.parse(row.capabilities_json));
    data = { ...graph, capabilities };
  } finally { db.close(); }
});

const named = (rows: readonly CardCapability[], name: string) => rows.find(row => row.card.name === name)!;

describe("grounded engine membership and directed access on the pinned catalog", () => {
  it("retains lookup-only catalog changes and invalidates the grounded graph on engine data changes", () => {
    const db = new Database(":memory:");
    try {
      migrate(db); importBridgeArtifact(db);
      const first = storedBridgeEngine(db);
      expect(storedBridgeEngine(db)).toBe(first);
      db.prepare("UPDATE card_catalog_revision SET revision=revision+1 WHERE id=1").run();
      expect(storedBridgeEngine(db)).toBe(first);
      db.prepare("UPDATE bridge_engine_revision SET revision=revision+1 WHERE id=1").run();
      const refreshed = storedBridgeEngine(db);
      expect(refreshed).not.toBe(first);
      expect(refreshed.rows.get(73956664)!.text_hash).toBe(first.rows.get(73956664)!.text_hash);
      expect(refreshed.rows.get(73956664)!.evidence_hash).toBe(first.rows.get(73956664)!.evidence_hash);
    } finally { db.close(); }
  });

  it("includes checked Blue-Eyes support without treating every mention as membership", () => {
    const engine = new BridgeEngine(data);
    for (const name of ["Maiden of White", "Roar of the Blue-Eyed Dragons", "Neo Kaiser Sea Horse", "Kaibaman the Legend"]) {
      expect(engine.groups.get("Blue-Eyes")!.has(named(data.capabilities, name).id), name).toBe(true);
    }
    expect(engine.groups.get("Blue-Eyes")!.has(named(data.capabilities, "Buster Blader").id)).toBe(false);
    const capabilities = data.capabilities.map(row => row.card.name === "Maiden of White"
      ? { ...row, card: { ...row.card, text: 'This card mentions "True Light" and "Blue-Eyes White Dragon".' }, provides: [] } : row);
    expect(new BridgeEngine({ ...data, capabilities }).groups.get("Blue-Eyes")!.has(named(capabilities, "Maiden of White").id)).toBe(false);
  });

  it("indexes Mikumari's non-Wyrm and Gateway's distinct-name non-Field targets", () => {
    const engine = new BridgeEngine(data);
    const rows = structuredClone(engine.data.capabilities.filter(row => engine.groups.get("Ashtra")!.has(row.id)));
    indexBridgeCapabilities(rows);
    const mikumari = named(rows, "Mikumari the Sealing Deity Ashtra");
    const search = mikumari.provides.find(capability => capability.key === "search")!;
    expect(search.targets).toContain(named(rows, "Yoa the Plague Deity Ashtra").id);
    expect(search.targets).toContain(named(rows, "Akasuna the Battle Ashtra").id);
    expect(search.targets).not.toContain(mikumari.id);
    expect(search.targets).not.toContain(named(rows, "Ashtraya Mikumari-no-Mikoto").id);
    const gateway = named(rows, "Ashtrashen - Gateway to the Worlds Beyond");
    const qualified = gateway.provides.find(capability => capability.key === "search")!;
    expect(qualified.targets).toContain(named(rows, "Ashtra Divine Domain").id);
    expect(qualified.targets).toContain(named(rows, "Yoa the Plague Deity Ashtra").id);
    expect(qualified.targets).not.toContain(gateway.id);
    expect(qualified.evidence).toContain("still face-down");
    expect(matchesBridgeFilter({ ...qualified.filter!, other: "unknown qualification" }, mikumari.card)).toBe(false);
  });

  it("keeps Adra's up-to-two distinct-name placement restricted to Continuous Traps", () => {
    const engine = new BridgeEngine(data);
    const rows = structuredClone(engine.data.capabilities.filter(row => engine.groups.get("Argostars")!.has(row.id)));
    indexBridgeCapabilities(rows);
    const adra = named(rows, "Argostars - Glorious Adra");
    const placement = adra.provides.find(capability => capability.key === "place_on_field")!;
    expect(placement.targets?.slice().sort((a, b) => a - b)).toEqual([
      "Argostars - Slayer Eteo", "Argostars - Lightning Tydeu", "Argostars - Swift Capane",
    ].map(name => named(rows, name).id).sort((a, b) => a - b));
    expect(placement.filter!.other).toContain("up to 2");
    expect(placement.evidence).toContain("banish this card you control");
  });

  it("restores Reinoheart's legal Deck sends without including itself or forbidden Fusion materials", () => {
    const engine = new BridgeEngine(data);
    const rows = structuredClone(engine.data.capabilities.filter(row => engine.groups.get("Tearlaments")!.has(row.id)));
    indexBridgeCapabilities(rows);
    const reinoheart = named(rows, "Tearlaments Reinoheart");
    const send = reinoheart.provides.find(capability => capability.key === "send_to_gy" && capability.from?.includes("deck"))!;
    for (const name of ["Tearlaments Scheiren", "Tearlaments Havnis", "Tearlaments Merrli", "Tearlaments Kashtira"]) {
      expect(send.targets, name).toContain(named(rows, name).id);
    }
    expect(send.targets).not.toContain(reinoheart.id);
    const kitkallos = named(rows, "Tearlaments Kitkallos");
    expect(bridgeLegal(kitkallos.card, "advanced")).toBe(false);
    const legalMain = rows.filter(row => bridgeLegal(row.card, "advanced") && !row.card.subtypes.includes("fusion")).map(row => row.card);
    expect(bridgeMaterials(named(rows, "Tearlaments Rulkallos").card, legalMain)).toBeNull();
  });

  it("models only the printed Azamina alternative Fusion procedure as Extra Deck access", () => {
    const engine = new BridgeEngine(data);
    const rows = engine.data.capabilities;
    const recipient = named(rows, "Azamina Mu Rcielago");
    for (const name of ["The Hallowed Azamina", "Azamina Debtors", "Azamina Determination"]) {
      const source = named(rows, name);
      const procedure = source.provides.find(capability => capability.key === "special_summon" && capability.from?.includes("extra_deck"));
      expect(procedure, name).toBeDefined();
      expect(procedure!.targets, name).toContain(recipient.id);
      expect(procedure!.evidence, name).toContain("treated as a Fusion Summon");
      const reason: BridgeReason = { key: "reach", weight: 1, cards: [source.id, recipient.id], evidence: [printedText(source.card), printedText(recipient.card)], description: "Checked printed Fusion procedure.",
        steps: [{ from: source.id, to: recipient.id, capability: "special_summon" }] };
      expect(engine.validateReason(reason, "advanced"), name).toBe(true);
    }
    expect(canReceiveSummon(recipient.card, 'Special Summon 1 "Azamina" monster from your GY.')).toBe(false);
    expect(canReceiveSummon(named(rows, "Blue-Eyes Ultimate Dragon").card, named(rows, "The Hallowed Azamina").card.text)).toBe(false);
  });

  it("uses repaired Extra Deck origins when building deterministic evidence from stored capabilities", () => {
    const db = new Database(":memory:");
    try {
      migrate(db); importBridgeArtifact(db);
      const source = named(data.capabilities, "Azamina Debtors"), target = named(data.capabilities, "Azamina Mu Rcielago");
      const reason: BridgeReason = { key: "reach", weight: 1, cards: [source.id, target.id], evidence: [printedText(source.card), printedText(target.card)], description: "Checked printed alternative procedure.",
        steps: [{ from: source.id, to: target.id, capability: "special_summon" }] };
      const evidence = buildBridgeJudgeEvidence(db, { source: "Azamina", target: "Sinful Spoils", format: "advanced", score: 4, raw_score: 4, target_mean: 0,
        two_way: false, grade: "Niche", reasons: [reason], cards: reason.cards, warnings: [], genesys_points: null,
        validation: "deterministic", judge: "pending", engine_status: "unverified", evidence_hash: "a".repeat(64) });
      expect(evidence?.proposed_lines[0]!.steps[0]!.from_zones).toEqual(["extra_deck"]);
    } finally { db.close(); }
  });
});
