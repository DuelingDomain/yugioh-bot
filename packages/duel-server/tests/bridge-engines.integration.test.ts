import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { BRIDGE_JUDGE_FRAMINGS, buildBridgeJudgeEvidence, importBridgeArtifact, importCardEffectArtifact, makeBridgeJudgementRecord,
  saveBridgeJudgement, type ArchetypeBridge, type BridgeEnginesResponse } from "@yugidraft/shared/cards/effects";
import { createBridgeService } from "@yugidraft/shared/services";
import { BridgeApi } from "../src/bridge-api.js";
import { seedIdentity } from "./helpers/identity.js";

let db: Database.Database;
beforeAll(() => { db = new Database(":memory:"); migrate(db); importCardEffectArtifact(db); importBridgeArtifact(db); });
afterAll(() => db.close());
function approve(row: ArchetypeBridge) {
  const evidence = buildBridgeJudgeEvidence(db, row)!;
  expect(evidence).not.toBeNull();
  for (const framing of BRIDGE_JUDGE_FRAMINGS) saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing, {
    verdict: "valid", grade: "good", pros: ["The supplied cards interact."], cons: ["Needs the supplied cards."],
    lock_note: "Apply the printed conditions.", line: evidence.cards.map(card => card.name), format_ok: true,
  }));
}
const deck = { main: [29762407, 29762407, 97522863, 97522863, 1710647, 1710647, 37839434, 37839434], extra: [] };

describe("stored multi-engine bridge API", () => {
  it("detects the open deck and projects only accepted links without admitting work", async () => {
    const user = seedIdentity(db), workers = { bridgeCandidates: vi.fn(), rateBridge: vi.fn() };
    const api = new BridgeApi(db, workers);
    const call = (request: Record<string, unknown>) => api.handle({ userId: user.userId, bridgeRequest: { op: "engines", format: "advanced", ...request } }, "g", user.playerId) as Promise<BridgeEnginesResponse>;
    try {
      expect(await call({ deck })).toMatchObject({ engines: ["Ashtra", "Odion"], next: [], between: [], detected: expect.any(Array) });
      const service = createBridgeService(db);
      for (const [from, to] of [["Odion", "Ashtra"], ["Ashtra", "Odion"], ["Odion", "Argostars"], ["Ashtra", "Argostars"], ["Argostars", "Odion"]]) {
        const row = service.bridgeBetween(from!, to!); if (row) approve(row);
      }
      const result = await call({ deck });
      expect(result.between).not.toHaveLength(0);
      const argostars = result.next.find(row => row.engine === "Argostars")!;
      expect(argostars).toBeDefined();
      expect(argostars.links.length).toBeLessThanOrEqual(3);
      expect(argostars.links.every(link => link.bridge.judge === "accepted")).toBe(true);
      // The pinned graph has Odion -> Argostars, but no Ashtra -> Argostars.
      expect(argostars.covered).toBe(1);
      expect(argostars.of).toBe(2);
      expect(argostars.score).toBeGreaterThanOrEqual(4);
      expect(argostars.missing).not.toContain(29762407);
      expect(result.next.every(row => !/synchron/i.test(row.engine))).toBe(true);
      expect(await call({ deck, engines: ["odion"] })).toMatchObject({ engines: ["Odion"], detected: expect.any(Array) });
      expect(await call({ engines: ["odion", " ASHTRA "] })).toMatchObject({ engines: ["Ashtra", "Odion"] });
      expect(workers.bridgeCandidates).not.toHaveBeenCalled(); expect(workers.rateBridge).not.toHaveBeenCalled();
      expect(db.prepare("SELECT count(*) AS n FROM bridge_deep_job").get()).toEqual({ n: 0 });
      for (const request of [{}, { engines: [] }, { engines: ["missing"] }, { engines: Array(5).fill("Odion") },
        { deck: { ...deck, side: [] } }, { deck: { main: Array(92).fill(1), extra: [] } }, { deck: { main: [0], extra: [] } }, { engines: ["Odion"], userId: 3 }]) {
        await expect(call(request)).rejects.toMatchObject({ status: 400 });
      }
    } finally { await api.jobs.close(); }
  });

  it("rechecks feedback and keeps Genesys package costs specific to the open deck", async () => {
    const user = seedIdentity(db, { name: "Engine points" });
    const row = createBridgeService(db).bridgeBetween("Odion", "Ashtra", "genesys")!; approve(row);
    const api = new BridgeApi(db, { bridgeCandidates: vi.fn(), rateBridge: vi.fn() });
    const call = (request: Record<string, unknown>) => api.handle({ userId: user.userId, bridgeRequest: { op: "engines", format: "genesys", ...request } }, "g", user.playerId) as Promise<BridgeEnginesResponse>;
    try {
      expect((await call({ engines: ["Odion"], genesysRemaining: 0 })).next.some(next => next.engine === "Ashtra")).toBe(false);
      const result = await call({ engines: ["Odion"], deck: { main: row.cards, extra: [] }, genesysRemaining: 0 });
      const ashtra = result.next.find(next => next.engine === "Ashtra")!;
      expect(ashtra).toBeDefined(); expect(ashtra.genesysPoints).toBe(0); expect(ashtra.missing).toEqual([]);
      for (const actor of ["engine-report-one", "engine-report-two"]) db.prepare("INSERT INTO bridge_feedback(evidence_hash,actor_hash,reason) VALUES(?,?,'')").run(row.evidence_hash, actor);
      expect((await call({ engines: ["Odion"] })).next.some(next => next.engine === "Ashtra")).toBe(false);
    } finally { await api.jobs.close(); }
  });
});
