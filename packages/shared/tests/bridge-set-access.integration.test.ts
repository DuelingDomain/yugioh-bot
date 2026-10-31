import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/schema.js";
import { importBridgeArtifact } from "../src/cards/effects/bridge-artifact.js";
import { storedBridgeEngine } from "../src/cards/effects/bridge-graph-store.js";
import { buildBridgeJudgeEvidence, bridgeJudgeRequest } from "../src/cards/effects/bridge-judge.js";
import { extractCardCapabilities } from "../src/cards/effects/bridge-capabilities.js";
import { BridgeEngine } from "../src/cards/effects/bridge-engine.js";

let db: Database.Database;
beforeAll(() => { db = new Database(":memory:"); migrate(db); importBridgeArtifact(db); });
afterAll(() => db.close());

describe("printed Set access on the pinned catalog", () => {
  it("reaches real target Traps through narrow hand, Deck and GY setters", () => {
    const engine = storedBridgeEngine(db);
    for (const format of ["advanced", "genesys"] as const) for (const [source, target, setter] of [
      ["Labrynth", "Ashtra", 73602965], ["Lady of Lament", "Ashtra", 25643346],
      ["Sunvine", "Argostars", 27946124], ["Ashtra", "Labrynth", 38114652],
    ] as const) {
      const row = engine.deepBetween(source, target, format);
      expect(row, `${format}: ${source} -> ${target}`).not.toBeNull();
      expect(row!.reasons.some(reason => reason.steps?.some(step => step.from === setter && step.capability === "set_spell_trap"))).toBe(true);
      expect(engine.validateAccessPath(row!.reasons[0]!, source, target, format)).toBe(true);
      expect(buildBridgeJudgeEvidence(db, row!)?.proposed_lines.some(line => line.steps.some(step => step.action === "set_spell_trap"))).toBe(true);
    }
  });

  it("proves Toy's Set resource for Ashtra without claiming Toy Box Sets Ashtra cards", () => {
    const engine = storedBridgeEngine(db);
    for (const format of ["advanced", "genesys"] as const) {
      const row = engine.deepBetween("Toy", "Ashtra", format)!;
      expect(row).toMatchObject({ tier: "niche" });
      const setup = row.reasons.find(reason => reason.setup?.card === 1710647)!;
      expect(setup.setup).toMatchObject({ card: 1710647 });
      expect(setup.cards).toContain(24878656);
      expect(setup.steps![0]).toMatchObject({ from: 24878656, capability: "set_spell_trap" });
      expect([58132856, 65504487, 69925461]).toContain(setup.steps![0]!.to);
      expect(engine.validateAccessPath(setup, "Toy", "Ashtra", format)).toBe(true);
      const broken = structuredClone(setup); broken.setup!.using = 37839434;
      expect(engine.validateAccessPath(broken, "Toy", "Ashtra", format)).toBe(false);
      const evidence = buildBridgeJudgeEvidence(db, row)!;
      expect(evidence.proposed_lines.some(line => line.steps.some(step => step.action === "reveal_return_set"))).toBe(true);
      expect(evidence.proposed_lines.every(line => !line.steps.some(step => step.card === "Toy Box" && step.target?.includes("Ashtra")))).toBe(true);
    }
  });

  it("retains several distinct physical paths before mentions, including local activation permissions", () => {
    const engine = storedBridgeEngine(db), row = engine.deepBetween("Labrynth", "Ashtra")!;
    const setPaths = row.reasons.filter(reason => reason.steps?.[0]?.capability === "set_spell_trap");
    expect(setPaths.length).toBeGreaterThanOrEqual(2);
    expect(new Set(setPaths.map(reason => reason.steps![0]!.from)).size).toBeGreaterThanOrEqual(2);
    expect(row.reasons[0]!.steps?.[0]?.capability).toBe("set_spell_trap");
    const evidence = buildBridgeJudgeEvidence(db, row)!;
    expect(evidence.proposed_lines.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(bridgeJudgeRequest(evidence, "mechanic"))).toContain("The Set Normal Trap can be activated this turn");
    expect(bridgeJudgeRequest(evidence, "mechanic").model).toBe("claude-haiku-5-5");
  });

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
