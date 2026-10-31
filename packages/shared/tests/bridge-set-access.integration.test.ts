import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/schema.js";
import { importBridgeArtifact } from "../src/cards/effects/bridge-artifact.js";
import { storedBridgeEngine } from "../src/cards/effects/bridge-graph-store.js";
import { buildBridgeJudgeEvidence, bridgeJudgeRequest } from "../src/cards/effects/bridge-judge.js";
import { extractCardCapabilities } from "../src/cards/effects/bridge-capabilities.js";
import { rankEngineCandidates } from "../src/cards/effects/bridge-engine-ranking.js";
import { createBridgeService } from "../src/services/archetype-bridges.js";
import { BridgeEngine } from "../src/cards/effects/bridge-engine.js";

let db: Database.Database;
beforeAll(() => { db = new Database(":memory:"); migrate(db); importBridgeArtifact(db); });
afterAll(() => db.close());

describe("printed Set access on the pinned catalog", () => {
  it("keeps full-catalog selectivity when validating legitimate Niche stat access", () => {
    const engine = storedBridgeEngine(db);
    for (const [source, target] of [["Fire Formation", "Lunalight"], ["Cyber Dragon", "Drytron"]]) {
      const row = engine.deepBetween(source!, target!)!;
      expect(engine.validateAccessPath(row.reasons[0]!, source!, target!, "advanced")).toBe(true);
      expect(buildBridgeJudgeEvidence(db, row), `${source} -> ${target}`).not.toBeNull();
    }
  });

  it("rejects subtype toolboxes, hand Sets and GY recursion as engine access", () => {
    const engine = storedBridgeEngine(db);
    for (const format of ["advanced", "genesys"] as const) for (const [source, target] of [
      ["Lady of Lament", "Ashtra"], ["Sunvine", "Argostars"],
      ["Ashtra", "Labrynth"], ["Supreme King", "Argostars"], ["Altergeist", "Ashtra"],
      ["Archfiend", "Ashtra"], ["Abyss Actor", "Ashtra"], ["Toy", "Ashtra"],
    ] as const) expect(engine.deepBetween(source, target, format), `${format}: ${source} -> ${target}`).toBeNull();
  });

  it("retains Cooclock's permission with Ashtra's own named Deck Set path", () => {
    const engine = storedBridgeEngine(db), row = engine.deepBetween("Labrynth", "Ashtra")!;
    expect(row.reasons[0]).toMatchObject({ key: "rule_enabler", steps: [{ from: 1710647, capability: "set_spell_trap" }] });
    expect(row.reasons.flatMap(reason => reason.steps ?? []).some(step => [73602965, 81497285].includes(step.from))).toBe(false);
  });

  it("proves Toy's extra Deck Set resources only as synergy, with the existing Haiku judges", () => {
    const engine = storedBridgeEngine(db);
    for (const format of ["advanced", "genesys"] as const) {
      const row = engine.synergyBetween("Toy", "Ashtra", format)!;
      expect(row).toMatchObject({ kind: "synergy", tier: "niche", two_way: false });
      const setup = row.reasons[0]!;
      expect(setup.setup).toMatchObject({ card: 1710647 });
      expect(setup.steps![0]).toMatchObject({ from: 24878656, capability: "set_spell_trap" });
      expect([58132856, 65504487, 69925461]).toContain(setup.steps![0]!.to);
      expect(engine.validateAccessPath(setup, "Toy", "Ashtra", format)).toBe(false);
      const evidence = buildBridgeJudgeEvidence(db, row)!;
      expect(evidence).not.toBeNull();
      expect(evidence.kind).toBe("synergy");
      expect(evidence.proposed_lines.some(line => line.steps.some(step => step.action === "reveal_return_set"))).toBe(true);
      expect(evidence.proposed_lines.every(line => !line.steps.some(step => step.card === "Toy Box" && step.target?.includes("Ashtra")))).toBe(true);
      expect(bridgeJudgeRequest(evidence, "mechanic").model).toBe("claude-haiku-5-5");
      expect(buildBridgeJudgeEvidence(db, { ...row, kind: undefined })).toBeNull();
      for (const source of ["Altergeist", "Archfiend", "Abyss Actor", "Sangen"]) expect(engine.synergyBetween(source, "Ashtra", format)).toBeNull();
    }
  });

  it("keeps Ashtra and Labrynth shortlists free of subtype-only Set and hand/GY access rows", () => {
    const service = createBridgeService(db), engine = storedBridgeEngine(db);
    for (const source of ["Ashtra", "Labrynth"]) {
      const rows = [...engine.deepCandidates(source, "advanced", undefined, false), ...engine.deepInto(source)];
      const shortlist = rankEngineCandidates([source], rows, service.rankingContext(), 8, { acceptedNiche: () => false });
      expect(shortlist.filter(row => row.kind === "synergy").length).toBeLessThanOrEqual(1);
      for (const row of shortlist) for (const { bridge } of row.links) {
        if (bridge.kind === "synergy") { expect(row.covered).toBe(0); expect(row.twoWay).toEqual([]); continue; }
        for (const step of bridge.reasons[0]!.steps ?? []) if (step.capability === "set_spell_trap") {
          const caps = engine.rows.get(step.from)!.provides.filter(cap => cap.key === step.capability && cap.targets?.includes(step.to));
          expect(caps.some(cap => cap.from?.includes("deck") && (cap.filter!.names.length || cap.filter!.archetypes.length || cap.targets!.length <= 30))).toBe(true);
        }
      }
    }
  }, 30_000);

  it("grounds revealed Normal Trap recipients and non-archetype Set filters", () => {
    const engine = storedBridgeEngine(db);
    for (const id of [23898021, 32785578, 69895264]) {
      const setters = engine.rows.get(id)!.provides.filter(cap => cap.key === "set_spell_trap");
      expect(setters.some(cap => cap.targets?.includes(37839434)), engine.rows.get(id)!.card.name).toBe(true);
      if (id !== 23898021) expect(setters.flatMap(cap => cap.targets ?? [])).not.toContain(5380979);
    }
  });

  it("keeps separate Spell and Trap Set choices and missing-tag exclusions", () => {
    const engine = storedBridgeEngine(db);
    for (const name of ["Darklord Eveningstar", "Brotherhood of the Fire Fist - Wolf"]) {
      const row = [...engine.rows.values()].find(row => row.card.name === name)!;
      for (const kind of ["spell", "trap"]) expect(row.provides.some(cap => cap.key === "set_spell_trap"
        && cap.filter?.kinds.includes(kind as "spell" | "trap") && cap.targets?.length), `${name}: ${kind}`).toBe(true);
    }
    const source = extractCardCapabilities({ ...engine.rows.get(24878656)!.card, id: 900000001,
      text: 'Set 1 "Ashtra" Spell/Trap directly from your Deck, except "Ashtra Insect Poison".' });
    const missing = new BridgeEngine({ ...engine.data, capabilities: [...engine.data.capabilities, source] });
    const targets = missing.rows.get(source.id)!.provides.filter(cap => cap.key === "set_spell_trap").flatMap(cap => cap.targets ?? []);
    expect(targets).toContain(37839434);
    expect(targets).not.toContain(64455720);
    const tagged = structuredClone(source);
    tagged.provides.push({ ...engine.rows.get(1710647)!.provides.find(cap => cap.key === "set_spell_trap")!,
      from: ["deck"], evidence: source.card.text });
    const repaired = new BridgeEngine({ ...engine.data, capabilities: [...engine.data.capabilities, tagged] });
    expect(repaired.rows.get(source.id)!.provides.filter(cap => cap.key === "set_spell_trap").flatMap(cap => cap.targets ?? []))
      .not.toContain(64455720);
    const named = extractCardCapabilities({ ...source.card, id: 900000002, text: 'Set 1 "Ashtra Divine Domain" directly from your Deck.' });
    const exact = new BridgeEngine({ ...engine.data, capabilities: [...engine.data.capabilities, named] });
    expect(exact.rows.get(named.id)!.provides.filter(cap => cap.key === "set_spell_trap").flatMap(cap => cap.targets ?? []))
      .toEqual([37839434]);
    const archetype = extractCardCapabilities({ ...source.card, id: 900000003, text: 'Set 1 "Necrovalley" Spell/Trap directly from your Deck.' });
    const typed = new BridgeEngine({ ...engine.data, capabilities: [...engine.data.capabilities, archetype] });
    const recovered = typed.rows.get(archetype.id)!.provides.find(cap => cap.key === "set_spell_trap")!;
    expect(recovered.filter?.archetypes).toEqual(["Necrovalley"]);
    expect(recovered.targets!.length).toBeGreaterThan(1);
  });

  it("rejects Set resources that cannot actually return to hand", () => {
    const engine = storedBridgeEngine(db);
    expect(engine.deepBetween("Sangen", "Ashtra")).toBeNull();
    expect(engine.deepBetween("Sangen", "Ashtra", "genesys")).toBeNull();
  });

  it("scopes global same-turn permission to the printed Trap subtype", () => {
    const data = storedBridgeEngine(db).data;
    const engine = new BridgeEngine({ ...data, groups: { ...data.groups, "Clock package": [2511, 5380979, 92714517] },
      group_policies: { ...data.group_policies, "Clock package": { curated: true } } });
    expect(engine.deepBetween("Clock package", "Ashtra")?.reasons[0]).toMatchObject({ key: "rule_enabler" });
    expect(engine.deepBetween("Clock package", "Argostars")).toBeNull();
  });

  it("does not widen recipient restrictions or invent a bridge from any-card toolbox effects", () => {
    const engine = storedBridgeEngine(db);
    expect(engine.deepBetween("Toy", "Argostars")).toBeNull();
    const toyBox = engine.rows.get(24878656)!;
    expect(toyBox.provides.filter(cap => cap.key === "set_spell_trap").flatMap(cap => cap.targets ?? []))
      .not.toContain(37839434);
    const archfiend = engine.rows.get(48745395)!;
    expect(archfiend.provides.filter(cap => cap.key === "set_spell_trap").flatMap(cap => cap.targets ?? []))
      .not.toContain(37839434); // Divine Domain is not attack-declaration-only.
    // Remove every specific Labrynth Set effect: broad any-Trap reset alone cannot enter Ashtra.
    const capabilities = structuredClone(engine.data.capabilities);
    for (const row of capabilities) if (engine.groups.get("Labrynth")!.has(row.id)) {
      row.provides = row.provides.filter(cap => cap.key !== "set_spell_trap");
      row.card.text = "You can Set 1 Trap from your hand.";
    }
    expect(new BridgeEngine({ ...engine.data, capabilities }).deepBetween("Labrynth", "Ashtra")).toBeNull();
  });
});
