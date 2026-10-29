import Database from "better-sqlite3";
import { beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/schema.js";
import { importBridgeArtifact } from "../src/cards/effects/bridge-artifact.js";
import { BridgeEngine } from "../src/cards/effects/bridge-engine.js";
import type { BridgeGraphData } from "../src/cards/effects/bridge-types.js";

let data: BridgeGraphData;
beforeAll(() => {
  const db = new Database(":memory:");
  try {
    migrate(db); importBridgeArtifact(db);
    const graph = JSON.parse((db.prepare("SELECT graph_json FROM bridge_graph WHERE id=1").get() as { graph_json: string }).graph_json);
    const capabilities = (db.prepare("SELECT capabilities_json FROM card_capability ORDER BY passcode").all() as { capabilities_json: string }[]).map(row => JSON.parse(row.capabilities_json));
    data = { ...graph, capabilities };
  } finally { db.close(); }
});

describe("deep-only access paths on the pinned catalog", () => {
  it("admits the owner's material and Deck-set paths without changing strict candidates", () => {
    const engine = new BridgeEngine(data);
    const strict = engine.liveCandidates("Odion");
    expect(strict.map(row => row.target)).toEqual(["Ashtra", "Argostars"]);
    const eyes = engine.deepBetween("Odion", "Blue-Eyes")!;
    expect(eyes).toMatchObject({ tier: "niche", grade: "Niche" });
    expect(eyes.reasons[0]).toMatchObject({ key: "extra_deck", materials: [97522863], steps: [{ from: 42097666, to: 89631139, capability: "special_summon" }] });
    expect(eyes.warnings.join(" ")).toContain("self-removal ends it");
    expect(engine.between("Odion", "Blue-Eyes")).toBeNull();
    for (const format of ["advanced", "genesys"] as const) {
      const altergeist = engine.deepBetween("Odion", "Altergeist", format)!;
      expect(altergeist).toMatchObject({ tier: "niche", grade: "Niche" });
      expect(altergeist.score).toBeLessThan(4);
      expect(altergeist.reasons[0]).toMatchObject({ key: "rule_enabler", steps: [{ from: 53143898, to: 86885905, capability: "set_spell_trap" }] });
      expect(engine.deepBetween("Odion", "Paleozoic", format)).toBeNull();
    }
    expect(engine.deepBetween("Odion", "Blue-Eyes", "genesys")).toBeNull();
    expect(engine.deepTargets(engine.deepCandidates("Odion"), 10).slice(0, strict.length).map(row => row.target)).toEqual(strict.map(row => row.target));
  }, 20_000);

  it("rejects labels, same-deck families, generic discards and negated entry chains", () => {
    const engine = new BridgeEngine(data);
    for (const [source, target] of [["Elemental HERO", "HERO"], ["Fluffal", "Frightfur"], ["Ghoti", "Shark"], ["Fiendsmith", "Dark World"], ["Branded", "Fabled"], ["Snake-Eye", "Volcanic"], ["Traptrix", "Void"]]) {
      expect(engine.deepBetween(source!, target!), `${source} -> ${target}`).toBeNull();
    }
    // Justicia has a separate valid Spirit material path; the negated Agarpain line is still absent.
    expect(engine.deepBetween("Guardragon", "Blue-Eyes")?.reasons.some(reason => reason.steps?.some(step => step.from === 5043020))).not.toBe(true);
  }, 20_000);

  it("uses group membership and capabilities instead of an Odion pair list", () => {
    const renamed = new BridgeEngine({ ...data, groups: { ...data.groups, "Temple package": data.groups.Odion! }, group_policies: { ...data.group_policies, "Temple package": data.group_policies!.Odion! } });
    expect(renamed.deepBetween("Temple package", "Blue-Eyes")).toMatchObject({ tier: "niche" });
    expect(renamed.deepBetween("Temple package", "Altergeist")).toMatchObject({ tier: "niche" });
    expect(renamed.deepBetween("Temple package", "Paleozoic")).toBeNull();
  }, 20_000);

  it("requires a real setter edge and supports a specific cost into a named target", () => {
    const engine = new BridgeEngine(data);
    const cost = engine.deepBetween("Odion", "Gravekeeper's")!;
    expect(cost.reasons[0]).toMatchObject({ key: "access", cost: { capability: "discard" } });
    expect(cost.reasons[0]!.description).toContain("Mudora the Sword Oracle");
    expect(engine.validateReason(cost.reasons[0]!, "advanced")).toBe(true);
    const brokenCost = structuredClone(cost.reasons[0]!);
    brokenCost.cost!.effect = 999;
    expect(engine.validateReason(brokenCost, "advanced")).toBe(false);
    const capabilities = structuredClone(data.capabilities);
    const setter = capabilities.find(row => row.id === 53143898)!;
    setter.provides = setter.provides.filter(capability => capability.key !== "set_spell_trap");
    const missing = new BridgeEngine({ ...data, capabilities });
    expect(missing.deepBetween("Odion", "Altergeist")).toBeNull();
    // Artemis needs another Magistus Summon before it can equip and search.
    expect(engine.deepBetween("Odion", "Magistus")).toBeNull();
    const eyes = engine.deepBetween("Odion", "Blue-Eyes")!;
    const altergeist = { ...engine.deepBetween("Odion", "Altergeist")!, two_way: true, score: 0 };
    expect(engine.deepTargets([eyes, altergeist, ...engine.liveCandidates("Odion")]).map(row => row.target))
      .toEqual(["Ashtra", "Argostars", "Altergeist", "Blue-Eyes"]);
  }, 20_000);
});
