import { bridgeProjectionRows, type BridgeProjectionInput } from "../src/bridge-projection-input.js";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { BRIDGE_JUDGE_FRAMINGS, bridgeGate, buildBridgeJudgeEvidence, importBridgeArtifact, makeBridgeJudgementRecord, saveBridgeJudgement, shownBridge, type ArchetypeBridge } from "@yugidraft/shared/cards/effects";
import { createBridgeService } from "@yugidraft/shared/services";
import { BridgeEngineQueries, type EngineQuery } from "../src/bridge-engine-queries.js";
import { BridgeApi } from "../src/bridge-api.js";
import { seedIdentity } from "./helpers/identity.js";

describe("deep-only Niche API integration", () => {
  it("requires both independent reviews and keeps accepted deep rows out of strict lookups", async () => {
    const db = new Database(":memory:"); migrate(db); importBridgeArtifact(db);
    const user = seedIdentity(db), service = createBridgeService(db);
    const rows = [service.deepBetween("Odion", "Blue-Eyes")!, service.deepBetween("Odion", "Altergeist")!];
    const bridgeEngineProjection = async (rows: BridgeProjectionInput, query: EngineQuery) => new BridgeEngineQueries(db).project(bridgeProjectionRows(db, rows), query, 6);
    const bridgeEngineShortlist = async (rows: ArchetypeBridge[], query: EngineQuery) => new BridgeEngineQueries(db).shortlist(rows, query);
    const workers = { bridgeEngineShortlist, bridgeEngineProjection, bridgeEngines: vi.fn(), bridgeCandidates: vi.fn(async () => rows), rateBridge: vi.fn(async () => {}) };
    const api = new BridgeApi(db, workers);
    const call = (bridgeRequest: unknown) => api.handle({ userId: user.userId, bridgeRequest }, "g", user.playerId);
    try {
      for (const row of rows) {
        const evidence = buildBridgeJudgeEvidence(db, row)!;
        expect(evidence).toMatchObject({ tier: "niche" });
        expect(bridgeGate(db, row).state).toBe("pending");
        for (const [i, framing] of BRIDGE_JUDGE_FRAMINGS.entries()) {
          saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing, { verdict: "valid", grade: "good", pros: [], cons: [], lock_note: "", line: evidence.cards.map(card => card.name), format_ok: true }));
          expect(shownBridge(db, row)?.grade ?? null).toBe(i === 0 ? null : "Niche");
        }
      }
      const eyes = buildBridgeJudgeEvidence(db, rows[0]!)!;
      expect(eyes.proposed_lines[0]!.steps[0]).toMatchObject({ action: "material", card: "The Man with the Mark", target: "Spirit with Eyes of Blue" });
      const geist = buildBridgeJudgeEvidence(db, rows[1]!)!;
      expect(geist.proposed_lines[0]!.steps[0]).toMatchObject({ action: "set_spell_trap", card: "Altergeist Marionetter", target: "Altergeist Emulatelf", from_zones: ["deck"] });
      expect(geist.proposed_lines[0]!.steps.some(step => step.action === "set")).toBe(false);
      const started = await call({ op: "start", source: "Odion" }) as { jobId: string };
      await api.jobs.close();
      expect(await call({ op: "status", jobId: started.jobId })).toMatchObject({ state: "done", results: [{ target: "Altergeist", tier: "niche", grade: "Niche" }, { target: "Blue-Eyes", tier: "niche", grade: "Niche" }] });
      expect(workers.rateBridge).not.toHaveBeenCalled();
      expect(await call({ op: "from", source: "Odion" })).toMatchObject({ results: [] });
      expect(await call({ op: "between", source: "Odion", target: "Blue-Eyes" })).toMatchObject({ results: [], reverse: [] });
      expect(service.bridgeBetween("Odion", "Blue-Eyes")).toBeNull();
      expect(service.shownFrom("Odion")).toEqual([]);
      expect(service.shownBetween("Odion", "Blue-Eyes")).toBeNull();
      expect(service.deepFrom("Odion").filter(row => row.tier === "niche").map(row => row.target)).toEqual(expect.arrayContaining(["Altergeist", "Blue-Eyes"]));
    } finally { await api.jobs.close(); db.close(); }
  }, 20_000);
});
