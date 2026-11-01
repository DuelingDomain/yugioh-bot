import Database from "better-sqlite3";
import { beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/schema.js";
import { importBridgeArtifact } from "../src/cards/effects/bridge-artifact.js";
import { BridgeEngine, indexBridgeCapabilities } from "../src/cards/effects/bridge-engine.js";
import type { BridgeGraphData } from "../src/cards/effects/bridge-types.js";

let data: BridgeGraphData;
let engine: BridgeEngine;
beforeAll(() => {
  const db = new Database(":memory:");
  try {
    migrate(db); importBridgeArtifact(db);
    const graph = JSON.parse((db.prepare("SELECT graph_json FROM bridge_graph WHERE id=1").get() as { graph_json: string }).graph_json);
    const capabilities = (db.prepare("SELECT capabilities_json FROM card_capability ORDER BY passcode").all() as { capabilities_json: string }[])
      .map(row => JSON.parse(row.capabilities_json));
    data = { ...graph, capabilities };
    engine = new BridgeEngine(data);
  } finally { db.close(); }
}, 120_000); // Share the pinned catalog and engine across read-only cases.

describe("round 3 bridge rules on the pinned catalog", () => {
  it("keeps uppercase archetype searches out of similarly spelled card names", () => {
    const capabilities = structuredClone(data.capabilities);
    indexBridgeCapabilities(capabilities);
    const stratos = capabilities.find(row => row.card.name === "Elemental HERO Stratos")!;
    const searches = stratos.provides.filter(capability => capability.key === "search" && capability.filter?.archetypes.includes("HERO"));
    expect(searches.length).toBeGreaterThan(0);
    const targets = new Set(searches.flatMap(capability => capability.targets ?? []));
    const falseNames = ["Dyna, Hero Fur Hire", "Hero of the Ashened City", "Hero Kid", "Oscillo Hero", "Hero of the East"];
    for (const name of falseNames) {
      const card = capabilities.find(row => row.card.name === name)!;
      expect(card, name).toBeDefined();
      expect(targets.has(card.id), name).toBe(false);
    }
    expect(targets.has(58932615)).toBe(true); // Elemental HERO Burstinatrix.
    expect(targets.has(48486809)).toBe(true); // Winged Kuriboh LV6 is treated as Elemental HERO.
    const engine = new BridgeEngine({ ...data, capabilities });
    for (const format of ["advanced", "genesys"] as const) {
      for (const source of Object.keys(data.groups).filter(name => name.includes("HERO"))) {
        for (const target of ["Fur Hire", "Ashened"]) expect(engine.between(source, target, format), `${source} -> ${target} (${format})`).toBeNull();
      }
    }
  }, 120_000); // Reindex the complete capability catalog before checking both formats.

  it("deduplicates shared Y-side lines and same-sentence mention twins", () => {
    for (const format of ["advanced", "genesys"] as const) {
      const eyes = engine.between("Black Luster Soldier", "Blue-Eyes", format)!;
      const chaos = engine.between("Black Luster Soldier", "Chaos", format)!;
      expect(eyes.reasons[0]!.cards).toEqual(chaos.reasons[0]!.cards); // Gateway to Chaos -> Chaos Form.
      const kept = engine.distinctTargets([eyes, chaos], 4);
      expect(kept).toHaveLength(1);
      expect(kept[0]!.score).toBe(Math.max(eyes.score, chaos.score));
      expect(engine.distinctTargets([eyes, chaos], 25)).toHaveLength(2); // Preserve direct lookup candidates.

      // Chaos Form lists both target labels in the same Ritual Summon sentence.
      const rituals = [engine.between("Blue-Eyes", "Chaos", format)!, engine.between("Blue-Eyes", "Black Luster Soldier", format)!];
      expect(rituals.every(row => row.reasons[0]!.cards[0] === 21082832)).toBe(true);
      expect(engine.distinctTargets(rituals, 4).map(row => row.target)).toEqual(["Black Luster Soldier"]);
      expect(engine.distinctTargets(rituals, 25)).toHaveLength(2);

      const capabilities = structuredClone(data.capabilities);
      const chaosForm = capabilities.find(row => row.id === 21082832)!;
      chaosForm.card.text = chaosForm.card.text.replace('any "Chaos" or "Black Luster Soldier" Ritual Monster.',
        'any "Chaos" Ritual Monster. This card can be used to Ritual Summon any "Black Luster Soldier" Ritual Monster.')
        .replaceAll('"Chaos" or "Black Luster Soldier" Ritual Monster you Ritual Summon', 'Ritual Monster you Ritual Summon');
      const separate = new BridgeEngine({ ...data, capabilities });
      const separateRituals = ["Chaos", "Black Luster Soldier"].map(target => separate.between("Blue-Eyes", target, format)!);
      expect(separate.distinctTargets(separateRituals, 4)).toHaveLength(2);
    }
  }, 60_000);

  it("keeps distinct Temple and Sinful Spoils target engines in the top four", () => {
    for (const format of ["advanced", "genesys"] as const) {
      const odionRows = engine.distinctTargets(engine.liveCandidates("Odion", format), 4);
      const odion = odionRows.map(row => row.target);
      expect(odion).toEqual(expect.arrayContaining(["Ashtra", "Argostars"]));
      expect(odionRows.filter(row => ["Ashtra", "Argostars"].includes(row.target)).every(row => row.reasons[0]!.key === "rule_enabler")).toBe(true);
      const altergeist = engine.between("Odion", "Altergeist", format);
      if (altergeist && altergeist.score >= 4) expect(odion).toContain("Altergeist");
      const azamina = engine.distinctTargets(engine.liveCandidates("Azamina", format), 4).map(row => row.target);
      expect(azamina).toEqual(["White Forest", "Sinful Spoils", "Diabell", "Snake-Eye"]);
      const diabell = engine.distinctTargets(engine.liveCandidates("Diabell", format), 4).map(row => row.target);
      expect(diabell).toEqual(["White Forest", "Snake-Eye", "Azamina"]);
      if (format === "advanced") {
        const zefra = engine.distinctTargets(engine.liveCandidates("Zefra", format), 4);
        expect(zefra.map(row => row.target)).toEqual(["Yang Zing", "Stellarknight", "Shaddoll", "Nekroz"]);
        expect(zefra.every(row => row.reasons[0]!.key === "reach")).toBe(true);
      }
    }
  }, 60_000);

  it("merges two-way naming families without merging distinct bridge engines", () => {
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
  }, 60_000);

  it("requires API source-archetype evidence while preserving aliases and curated groups", () => {
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
  }, 60_000);

  it("requires discard profiles and three distinct source outlets for a substantive discard engine", () => {
    for (const format of ["advanced", "genesys"] as const) {
      for (const [source, target] of [["Danger!", "Dark World"], ["Dark World", "Danger!"]]) {
        const row = engine.between(source!, target!, format);
        expect(row, `${source} -> ${target} (${format})`).not.toBeNull();
        expect(row!.reasons[0]!.key).toBe("gy_fuel");
        expect(row!.reasons[0]!.ancillary).not.toBe(true);
      }
      for (const source of ["Fiendsmith", "Branded", "Battleguard", "Triamid", "Firewall", "Sangen", "WAKE CUP!", "Clown Crew", "Purrely"]) {
        for (const target of ["Danger!", "Dark World"]) expect(engine.between(source, target, format), `${source} -> ${target}`).toBeNull();
      }
      const fabled = engine.between("Fiendsmith", "Fabled", format)!;
      expect(fabled.grade).toBe("Niche");
      expect(engine.reasons("Fiendsmith", "Fabled", format).find(reason => reason.key === "gy_fuel")).toMatchObject({ ancillary: true, weight: 1 });
    }
  }, 60_000);

  it("preserves named fan-out into real engine members and rejects label filler", () => {
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
    // Rebuild rewrites nested frequencies and outlets; preserve the shared engine's catalog.
    const rebuilt = new BridgeEngine({ ...structuredClone(data), groups, target_means: { advanced: {}, genesys: {} }, materials: undefined });
    rebuilt.rebuild();
    for (const format of ["advanced", "genesys"] as const) {
      expect(rebuilt.data.ancillary_outlets?.[format]?.[72270339]).toBeUndefined(); // Diabellstar the Black Witch.
      expect(rebuilt.reasons("Diabell", "Snake-Eye", format).some(reason => reason.key === "reach" && !reason.ancillary)).toBe(true);
    }
  }, 60_000);

  it("rejects incidental name hybrids while retaining cross-engine landing cards", () => {
    for (const format of ["advanced", "genesys"] as const) {
      for (const [source, target] of [["Chaos", "Galaxy"], ["Dark Contract", "Supreme King"]]) {
        expect(engine.between(source!, target!, format), `${source} -> ${target} (${format})`).toBeNull();
      }
      for (const source of Object.keys(data.groups).filter(name => name.includes("HERO"))) {
        for (const target of ["Rose", "Kuriboh"]) expect(engine.between(source, target, format), `${source} -> ${target} (${format})`).toBeNull();
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
  }, 60_000);

  it("requires Toon setup evidence when another engine reaches a Toon monster", () => {
    for (const format of ["advanced", "genesys"] as const) {
      for (const source of ["Gaia The Fierce Knight", "Destruction Sword", "Archfiend", "Performapal"]) {
        expect(engine.between(source, "Toon", format), `${source} -> Toon (${format})`).toBeNull();
      }
    }
  }, 60_000);
});
