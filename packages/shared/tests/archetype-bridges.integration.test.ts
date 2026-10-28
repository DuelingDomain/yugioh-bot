import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../src/db/schema.js";
import { importBridgeArtifact } from "../src/cards/effects/bridge-artifact.js";
import { createBridgeService } from "../src/services/archetype-bridges.js";

describe("pinned bridge pipeline", () => {
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
      const blueEyes = service.explain("Odion", "Blue-Eyes");
      expect(blueEyes?.cards).toContain(42097666);
      const summoned = blueEyes?.reasons.flatMap(reason => reason.steps ?? []).find(step => step.from === 42097666)?.to;
      expect(summoned).toBeDefined();
      const summonedRow = db.prepare("SELECT capabilities_json FROM card_capability WHERE passcode=?").get(summoned) as { capabilities_json: string };
      expect(JSON.parse(summonedRow.capabilities_json).card.name).not.toBe("Sage with Eyes of Blue");
      expect(JSON.parse(summonedRow.capabilities_json).card.name).not.toBe("The White Stone of Ancients");
      const sage = db.prepare("SELECT capabilities_json FROM card_capability WHERE passcode=8240199").get() as { capabilities_json: string };
      expect(JSON.parse(sage.capabilities_json).provides.filter((capability: { key: string }) => capability.key === "archetype")).toEqual([]);
      expect(blueEyes?.warnings.some(warning => warning.includes("while face-up"))).toBe(true);
      expect(service.explain("Odion", "Blue-Eyes", "genesys")).toBeNull();
      expect(candidates.some(row => row.target === "Blue-Eyes")).toBe(true);
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
