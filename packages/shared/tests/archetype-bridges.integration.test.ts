import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../src/db/schema.js";
import { importBridgeArtifact } from "../src/cards/effects/bridge-artifact.js";
import { createBridgeService } from "../src/services/archetype-bridges.js";
import { readBridgeManifest } from "../src/cards/effects/bridge-artifact.js";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { ArchetypeProfile } from "../src/cards/effects/synergy.js";
import { BridgeEngine, bridgeGroups } from "../src/cards/effects/bridge-engine.js";

describe("pinned bridge pipeline", () => {
  it("builds curated memberships, aliases and exclusions from group data", () => {
    const db = new Database(":memory:");
    try {
      migrate(db); importBridgeArtifact(db);
      const capabilities = (db.prepare("SELECT capabilities_json FROM card_capability").all() as { capabilities_json: string }[]).map(row => JSON.parse(row.capabilities_json));
      const profiles = new Map<string, ArchetypeProfile>(gunzipSync(readFileSync(new URL("../data/effects/profiles.jsonl.gz", import.meta.url))).toString().trim().split("\n").map(line => { const row = JSON.parse(line); return [row.archetype, row.profile]; }));
      const policies = JSON.parse(readFileSync(new URL("../data/effects/bridge-groups.json", import.meta.url), "utf8"));
      const groups = bridgeGroups(capabilities, profiles, policies);
      expect(groups.Odion).toContain(29762407);
      expect(groups["Blue-Eyes"]).toContain(42097666);
      for (const label of ["Trap Monster", "Hole", "Heart"]) expect(groups[label]).toBeUndefined();
      const renamed = bridgeGroups(capabilities, profiles, { "Temple package": policies.Odion });
      expect(renamed["Temple package"]).toEqual(groups.Odion);
      const engine = new BridgeEngine({ capabilities, groups, group_policies: policies, target_means: { advanced: {}, genesys: {} } });
      const before = engine.between("Branded", "Danger!")!.reasons.find(reason => reason.key === "gy_fuel")!.weight;
      const frequent = new BridgeEngine({ ...engine.data, reason_frequencies: { advanced: { "Danger!": { gy_fuel: 0.25 } }, genesys: {} } });
      expect(frequent.between("Branded", "Danger!")!.reasons.find(reason => reason.key === "gy_fuel")!.weight).toBeLessThan(before / 2);
      for (const format of ["advanced", "genesys"] as const) {
        expect(engine.between("Blue-Eyes", "Tenyi", format)).toBeNull();
        expect(engine.between("Fiendsmith", "Tenyi", format)).toBeNull();
        const line = engine.between("Swordsoul", "Tenyi", format);
        expect(line?.reasons.some(reason => reason.key === "profile")).toBe(true);
        expect(line?.reasons.every(reason => engine.validateReason(reason, format))).toBe(true);
      }
    } finally { db.close(); }
  }, 15_000);

  it("keeps labels, self references and isolated stat searches out of engine bridges", () => {
    const db = new Database(":memory:");
    try {
      migrate(db); importBridgeArtifact(db);
      const service = createBridgeService(db), manifest = readBridgeManifest();
      const graph = JSON.parse((db.prepare("SELECT graph_json FROM bridge_graph WHERE id=1").get() as { graph_json: string }).graph_json);
      const validator = new BridgeEngine({ ...graph, capabilities: (db.prepare("SELECT capabilities_json FROM card_capability ORDER BY passcode").all() as { capabilities_json: string }[]).map(row => JSON.parse(row.capabilities_json)) });
      for (const name of ["Trap Monster", "Hole", "Trap Hole", "Heart", "Signature move"]) expect(manifest.groups[name]).toBeUndefined();
      const chaos = service.explain("Blue-Eyes", "Chaos", "advanced");
      const ritual = chaos?.reasons.find(reason => reason.description === "Chaos Form names Chaos");
      expect(ritual).toBeDefined();
      const ritualTarget = db.prepare("SELECT json_extract(capabilities_json,'$.card.subtypes') AS subtypes FROM card_capability WHERE passcode=?").get(ritual!.cards[1]) as { subtypes: string };
      expect(JSON.parse(ritualTarget.subtypes)).toContain("ritual");
      for (const format of ["advanced", "genesys"] as const) {
        expect(validator.between("Swordsoul", "Dogmatika", format)).toBeNull();
        for (const [source, target] of [["Yubel", "Ashtra"], ["Ryzeal", "Ashtra"], ["Blue-Eyes", "Ashtra"], ["Swordsoul", "Blue-Eyes"]]) {
          expect(validator.between(source!, target!, format), `${source} -> ${target}`).toBeNull();
        }
        const ranked = validator.liveCandidates("Odion", format);
        expect(ranked.slice(0, 2).map(row => row.target)).toContain("Ashtra");
        expect(ranked.slice(0, 4).map(row => row.target)).toContain("Argostars");
        expect(validator.liveCandidates("Snake-Eye", format)[0]?.target).toBe("Fire King");
        for (const target of ["Ashtra", "Argostars"]) {
          const row = validator.between("Odion", target, format)!;
          expect(row.cards.some(id => manifest.groups[target]!.includes(id))).toBe(true);
        }
        const odion = service.liveCandidates("Odion", format);
        const argostars = odion.find(row => row.target === "Argostars");
        expect(argostars).toBeDefined();
        expect(argostars!.score).toBeGreaterThan(odion.find(row => row.target === "Paleozoic")?.score ?? 0);
        expect(argostars!.score).toBeGreaterThan(odion.find(row => row.target === "Golden Land")?.score ?? 0);
        for (const [source, target] of [["Kashtira", "Heart"], ["Ryzeal", "Hole"], ["Yubel", "Signature move"], ["Snake-Eye", "Volcanic"], ["Snake-Eye", "Flamvell"], ["Snake-Eye", "Laval"], ["Swordsoul", "True Draco"], ["Swordsoul", "Metaphys"], ["Fiendsmith", "Duston"]]) expect(service.explain(source!, target!, format)).toBeNull();
        const darkWorld = service.explain("Fiendsmith", "Dark World", format);
        expect(darkWorld?.cards).not.toContain(7623640);
        expect(service.explain("Branded", "Dark World", format)?.cards).not.toContain(7623640);
        for (const target of ["Danger!", "Fabled", "Dark World"]) {
          const bridge = service.explain("Branded", target, format);
          const reason = bridge?.reasons.find(reason => reason.key === "gy_fuel" && reason.cards.includes(29948294));
          expect(reason).toBeDefined();
          const cards = reason!.cards.map(id => JSON.parse((db.prepare("SELECT capabilities_json FROM card_capability WHERE passcode=?").get(id) as { capabilities_json: string }).capabilities_json).card);
          const discarded = cards.find(card => card.kind === "monster" && !card.subtypes.includes("fusion"));
          const fusion = cards.find(card => card.subtypes.includes("fusion"));
          expect(discarded.name).not.toBe("Danger!? Tsuchinoko?");
          expect(fusion.monsterType).toBe(discarded.monsterType);
          expect(fusion.level).toBe(8);
          expect(fusion.atk === 2500 || fusion.def === 2500).toBe(true);
          expect(reason!.description).toContain(fusion.name);
          expect(validator.validateReason(reason!, format)).toBe(true);
          expect(validator.validateReason({ ...reason!, cards: reason!.cards.filter(id => id !== fusion.id), evidence: reason!.evidence.filter((_, i) => reason!.cards[i] !== fusion.id) }, format)).toBe(false);
        }
        expect(odion.every(row => !row.two_way)).toBe(true);
      }
    } finally { db.close(); }
  }, 15_000);

  it("imports validated evidence, serves directed lookups and excludes Links in Genesys", () => {
    const db = new Database(":memory:");
    try {
      migrate(db);
      const imported = importBridgeArtifact(db);
      expect(imported.bridges).toBeGreaterThan(0);
      expect(importBridgeArtifact(db).skipped).toBe(true);
      const service = createBridgeService(db);
      const started = performance.now();
      const candidates = service.liveCandidates("Odion", "advanced");
      expect(performance.now() - started).toBeLessThan(2000);
      const argostars = service.bridgeBetween("Odion", "Argostars", "advanced");
      expect(argostars?.reasons.some(reason => reason.key === "rule_enabler")).toBe(true);
      expect(service.explain("Argostars", "Odion")).toBeNull();
      expect(service.explain("Live☆Twin", "Evil★Twin", "genesys")).toBeNull();
      expect(service.explain("Gadget", "Utopia")).toBeNull();
      expect(service.capabilities("activate_trap_turn_set", "provides").map(row => row.card.name)).not.toContain("Argostars - Fierce Parthe");
      const illegalNormalSummon = db.prepare(`SELECT 1 FROM archetype_bridge b,
        json_each(b.bridge_json,'$.reasons') r,json_each(r.value,'$.steps') s
        JOIN card_capability c ON c.passcode=json_extract(s.value,'$.to')
        WHERE json_extract(s.value,'$.capability')='normal_summon'
        AND json_extract(c.capabilities_json,'$.card.text') LIKE '%Cannot be Normal Summoned/Set%' LIMIT 1`).get();
      expect(illegalNormalSummon).toBeUndefined();
      expect(service.bridgesFrom("Odion", "advanced").length).toBeLessThanOrEqual(4);
      // Generic Link-1 access cannot establish a bridge on its own.
      expect(candidates.some(row => row.target === "Blue-Eyes")).toBe(false);
      const sage = db.prepare("SELECT capabilities_json FROM card_capability WHERE passcode=8240199").get() as { capabilities_json: string };
      expect(JSON.parse(sage.capabilities_json).provides.filter((capability: { key: string }) => capability.key === "archetype")).toEqual([]);
      expect(service.explain("Odion", "Blue-Eyes", "genesys")).toBeNull();
      expect(candidates.every(row => row.validation === "deterministic")).toBe(true);
      const beastLocks = service.capabilities("summon_lock", "needs").filter(row => row.card.name === "Simorgh, Bird of Bringing");
      expect(beastLocks[0]?.locks.flatMap(lock => lock.allow.types)).not.toContain("Beast");
      expect(beastLocks[0]?.locks.flatMap(lock => lock.allow.types)).toContain("Winged Beast");
      const starter = service.capabilities("summon_lock", "needs").find(row => row.card.name === "Spright Starter");
      expect(starter?.locks[0]?.allow.level_min).toBe(2);
      expect(starter?.locks[0]?.allow.level_max).toBe(2);
      expect(starter?.locks[0]?.allow.subtypes).toEqual([]);
      expect(db.prepare("SELECT count(*) AS n FROM bridge_judgement").get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT count(*) AS n FROM bridge_feedback").get()).toEqual({ n: 0 });
    } finally { db.close(); }
  }, 15_000);
});
