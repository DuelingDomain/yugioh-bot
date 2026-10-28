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
    const capabilities = (db.prepare("SELECT capabilities_json FROM card_capability ORDER BY passcode").all() as { capabilities_json: string }[])
      .map(row => JSON.parse(row.capabilities_json));
    data = { ...graph, capabilities };
  } finally { db.close(); }
});

describe("round 3 bridge rules on the pinned catalog", () => {
  it("deduplicates a shared primary source only when the Y-side line also overlaps", () => {
    const engine = new BridgeEngine(data);
    for (const format of ["advanced", "genesys"] as const) {
      const eyes = engine.between("Black Luster Soldier", "Blue-Eyes", format)!;
      const chaos = engine.between("Black Luster Soldier", "Chaos", format)!;
      expect(eyes.reasons[0]!.cards).toEqual(chaos.reasons[0]!.cards); // Gateway to Chaos -> Chaos Form.
      const kept = engine.distinctTargets([eyes, chaos], 4);
      expect(kept).toHaveLength(1);
      expect(kept[0]!.score).toBe(Math.max(eyes.score, chaos.score));
      expect(engine.distinctTargets([eyes, chaos], 25)).toHaveLength(2); // Preserve direct lookup candidates.

      // Chaos Form reaches different Ritual Monsters in these two targets.
      const rituals = [engine.between("Blue-Eyes", "Chaos", format)!, engine.between("Blue-Eyes", "Black Luster Soldier", format)!];
      expect(rituals.every(row => row.reasons[0]!.cards[0] === 21082832)).toBe(true);
      expect(engine.distinctTargets(rituals, 4)).toHaveLength(2);
    }
  }, 15_000);

  it("keeps distinct Temple and Sinful Spoils target engines in the top four", () => {
    const engine = new BridgeEngine(data);
    for (const format of ["advanced", "genesys"] as const) {
      const odion = engine.distinctTargets(engine.liveCandidates("Odion", format), 4).map(row => row.target);
      expect(odion).toEqual(expect.arrayContaining(["Ashtra", "Argostars"]));
      const altergeist = engine.between("Odion", "Altergeist", format);
      if (altergeist && altergeist.score >= 4) expect(odion).toContain("Altergeist");
      const azamina = engine.distinctTargets(engine.liveCandidates("Azamina", format), 4).map(row => row.target);
      expect(azamina).toEqual(["White Forest", "Sinful Spoils", "Diabell", "Snake-Eye"]);
      const diabell = engine.distinctTargets(engine.liveCandidates("Diabell", format), 4).map(row => row.target);
      expect(diabell).toEqual(["White Forest", "Snake-Eye", "Azamina"]);
    }
  }, 15_000);

  it("merges two-way naming families without merging distinct bridge engines", () => {
    const engine = new BridgeEngine(data);
    for (const [source, target] of [["Fluffal", "Frightfur"], ["Fluffal", "Edge Imp"], ["Fluffal", "Toy"], ["Nouvelles", "Recipe"],
      ["Apoqliphort", "Qli"], ["Evil★Twin", "Live☆Twin"], ["Evil★Twin", "Lil-la"], ["Live☆Twin", "Lil-la"],
      ["D/D", "Dark Contract"], ["Diabell", "Sinful Spoils"]]) {
      for (const format of ["advanced", "genesys"] as const) {
        expect(engine.between(source!, target!, format), `${source} -> ${target}`).toBeNull();
        expect(engine.between(target!, source!, format), `${target} -> ${source}`).toBeNull();
      }
    }
    for (const [source, target] of [["Branded", "Despia"], ["Branded", "Bystial"], ["Snake-Eye", "Fire King"],
      ["Kashtira", "Tearlaments"], ["Swordsoul", "Tenyi"], ["Zefra", "Yang Zing"]]) {
      expect(engine.between(source!, target!), `${source} -> ${target}`).not.toBeNull();
    }
  }, 15_000);

  it("requires API source-archetype evidence while preserving aliases and curated groups", () => {
    const engine = new BridgeEngine(data);
    for (const format of ["advanced", "genesys"] as const) {
      for (const [source, target] of [["Crystal", "Melodious"], ["Cyber", "Harpie"], ["Clear", "T.G."], ["Guardian", "T.G."],
        ["Contact", "Darklord"], ["Parasite", "Graydle"], ["Junk", "Gimmick Puppet"], ["Cyberdark", "Cyber"]]) {
        expect(engine.between(source!, target!, format), `${source} -> ${target}`).toBeNull();
      }
      expect(engine.liveCandidates("Anti", format)).toEqual([]);
      expect(engine.liveCandidates("Toon", format).every(row => row.cards.some(id => engine.rows.get(id)!.card.archetype === "Toon"))).toBe(true);
      for (const [source, target] of [["Branded", "Despia"], ["Blue-Eyes", "Millennium"], ["Kashtira", "Scareclaw"], ["Odion", "Argostars"]]) {
        expect(engine.between(source!, target!, format), `${source} -> ${target}`).not.toBeNull();
      }
      expect([...engine.groups.get("Stellarknight")!].some(id => engine.rows.get(id)!.card.archetype === "Tellarknight")).toBe(true);
    }
  }, 15_000);

  it("requires discard profiles on both engines for a substantive discard outlet", () => {
    const engine = new BridgeEngine(data);
    for (const format of ["advanced", "genesys"] as const) {
      for (const [source, target] of [["Danger!", "Dark World"], ["Dark World", "Danger!"]]) {
        const row = engine.between(source!, target!, format);
        expect(row, `${source} -> ${target} (${format})`).not.toBeNull();
        expect(row!.reasons[0]!.key).toBe("gy_fuel");
        expect(row!.reasons[0]!.ancillary).not.toBe(true);
      }
      for (const source of ["Fiendsmith", "Branded", "Battleguard", "Triamid"]) {
        for (const target of ["Danger!", "Dark World"]) expect(engine.between(source, target, format), `${source} -> ${target}`).toBeNull();
      }
    }
  }, 15_000);

  it("preserves named fan-out into real engine members and rejects label filler", () => {
    const engine = new BridgeEngine(data);
    for (const format of ["advanced", "genesys"] as const) {
      for (const [source, target] of [["Diabell", "Snake-Eye"], ["Azamina", "Diabell"], ["Diabell", "Azamina"], ["Azamina", "Snake-Eye"],
        ["Zefra", "Yang Zing"], ["Zefra", "Nekroz"], ["Zefra", "Ritual Beast"]]) {
        if (format === "genesys" && source === "Zefra") continue; // Its Pendulum entry cards are barred.
        expect(engine.between(source!, target!, format), `${source} -> ${target} (${format})`).not.toBeNull();
      }
      for (const target of ["Chaos", "Void"]) {
        expect(engine.between("Traptrix", target, format), `Traptrix -> ${target}`).toBeNull();
      }
    }
    const groups = Object.fromEntries(["Diabell", "Snake-Eye", "Azamina", "Sinful Spoils", "White Forest"].map(name => [name, data.groups[name]!]));
    const rebuilt = new BridgeEngine({ ...data, groups, target_means: { advanced: {}, genesys: {} }, materials: undefined });
    rebuilt.rebuild();
    for (const format of ["advanced", "genesys"] as const) {
      expect(rebuilt.data.ancillary_outlets?.[format]?.[72270339]).toBeUndefined(); // Diabellstar the Black Witch.
      expect(rebuilt.reasons("Diabell", "Snake-Eye", format).some(reason => reason.key === "reach" && !reason.ancillary)).toBe(true);
    }
  }, 15_000);

  it("rejects incidental name hybrids while retaining cross-engine landing cards", () => {
    const engine = new BridgeEngine(data);
    for (const format of ["advanced", "genesys"] as const) {
      for (const [source, target] of [["Chaos", "Galaxy"], ["Dark Contract", "Supreme King"]]) {
        expect(engine.between(source!, target!, format), `${source} -> ${target} (${format})`).toBeNull();
      }
      for (const [source, target, card] of [
        ["Zefra", "Yang Zing", 21495657], ["Zefra", "Nekroz", 20773176],
        ["Azamina", "Diabell", 23151193], ["Diabell", "Azamina", 65033975],
        ["Diabell", "Snake-Eye", 24081957], ["Azamina", "Snake-Eye", 24081957],
      ] as const) {
        if (format === "genesys" && source === "Zefra") continue;
        expect(engine.reasons(source, target, format).some(reason => !reason.ancillary && reason.cards.includes(card)),
          `${source} -> ${target} retains ${card} (${format})`).toBe(true);
      }
    }
  }, 15_000);
});
