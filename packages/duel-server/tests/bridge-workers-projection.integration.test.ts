import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BRIDGE_JUDGE_FRAMINGS, buildBridgeJudgeEvidence, makeBridgeJudgementRecord, saveBridgeJudgement } from "@yugidraft/shared/cards/effects";
import { createBridgeService } from "@yugidraft/shared/services";
import { BridgeApi } from "../src/bridge-api.js";
import { DeckSuggestionWorkers, type BridgeScan } from "../src/deck-suggestion-workers.js";
import { seedIdentity } from "./helpers/identity.js";
import { effectFileDatabase, FAST_QUERY_TIMEOUT_MS } from "./helpers/bridge-worker-database.js";

describe("bridge scanner isolation", () => {
  it("projects full engines requests off the file-DB host loop and observes external feedback", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bridge-worker-projection-"));
    const db = effectFileDatabase(join(directory, "app.sqlite"));
    db.pragma("journal_mode = WAL");
    const actor = seedIdentity(db), row = createBridgeService(db).bridgeBetween("Odion", "Argostars")!;
    const evidence = buildBridgeJudgeEvidence(db, row)!;
    for (const framing of BRIDGE_JUDGE_FRAMINGS) saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing, {
      verdict: "valid", grade: "good", pros: [], cons: [], lock_note: "", line: evidence.cards.map(card => card.name), format_ok: true,
    }));
    const workers = new DeckSuggestionWorkers(db, directory, 120_000, {}, FAST_QUERY_TIMEOUT_MS), api = new BridgeApi(db, workers);
    const call = (engines: string[]) => {
      ticks = 0;
      return api.handle({ userId: actor.userId, bridgeRequest: { op: "engines", engines, format: "advanced" } }, "g", actor.playerId) as Promise<{ next: { engine: string }[] }>;
    };
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 2);
    try {
      await call(["The Weather", "Genex", "Synchron", "Blue-Eyes"]);
      expect(ticks).toBeGreaterThan(5);
      await expect(call(["Unknown engine"])).rejects.toMatchObject({ status: 400 });
      expect((await call(["Odion"])).next.some(next => next.engine === "Argostars")).toBe(true);
      const external = new Database(db.name);
      try {
        for (const user of ["external-one", "external-two"]) external.prepare("INSERT INTO bridge_feedback(evidence_hash,actor_hash,reason) VALUES(?,?,'')").run(row.evidence_hash, user);
      } finally { external.close(); }
      expect((await call(["Odion"])).next.some(next => next.engine === "Argostars")).toBe(false);
      const service = createBridgeService(db), selected = ["The Weather", "Genex", "Synchron", "Blue-Eyes"];
      const deep = new BridgeApi(db, {
        withBridgeLegality: (format, read) => workers.withBridgeLegality(format, read),
        bridgeResolve: (input, guildId) => workers.bridgeResolve(input, guildId),
        bridgeDirectedProjection: (query, rows, deep) => workers.bridgeDirectedProjection(query, rows, deep),
        bridgeEngines: (input, guildId) => workers.bridgeEngines(input, guildId),
        bridgeEngineShortlist: (rows, query) => workers.bridgeEngineShortlist(rows, query),
        bridgeEngineProjection: (rows, query) => workers.bridgeEngineProjection(rows, query),
        bridgeCandidates: async (scan: BridgeScan) => service.engineRows([scan.source], scan.format)
          .filter(row => scan.op === "into" ? row.target === scan.source : row.source === scan.source),
        rateBridge: async row => {
          const evidence = buildBridgeJudgeEvidence(db, row)!;
          for (const framing of BRIDGE_JUDGE_FRAMINGS) saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing, {
            verdict: "valid", grade: "good", pros: [], cons: [], lock_note: "", line: evidence.cards.map(card => card.name), format_ok: true,
          }));
        },
      });
      try {
        const started = await deep.handle({ userId: actor.userId, bridgeRequest: { op: "start", engines: selected } }, "g", actor.playerId) as { jobId: string };
        await deep.jobs.close();
        const stored = db.prepare("SELECT json_array_length(result_json,'$.pairs') AS n,length(result_json) AS bytes FROM bridge_deep_job WHERE id=?")
          .get(started.jobId) as { n: number; bytes: number };
        expect(stored.n).toBeGreaterThan(100);
        expect(stored.bytes).toBeLessThan(JSON.stringify(service.engineRows(selected, "advanced")).length / 4);
        ticks = 0;
        const status = await deep.handle({ userId: actor.userId, bridgeRequest: { op: "status", jobId: started.jobId } }, "g", actor.playerId);
        expect(status).toMatchObject({ state: "done" });
        expect(ticks).toBeGreaterThan(5);
        // An already completed job from the previous build can still contain
        // full rows. Send only its ID and parse those rows in a fresh scanner.
        const legacyJson = JSON.stringify(service.engineRows(selected, "advanced"));
        db.prepare("UPDATE bridge_deep_job SET result_json=? WHERE id=?").run(legacyJson, started.jobId);
        const legacyWorkers = new DeckSuggestionWorkers(db, directory, 120_000, {}, FAST_QUERY_TIMEOUT_MS);
        const parse = vi.spyOn(JSON, "parse");
        try {
          expect(await legacyWorkers.bridgeEngineProjection({ jobId: started.jobId }, {
            source: selected[0]!, engines: selected, format: "advanced",
          })).toMatchObject({ engines: selected });
          expect(parse.mock.calls.some(([value]) => value === legacyJson)).toBe(false);
        } finally { parse.mockRestore(); await legacyWorkers.close(); }
      } finally { await deep.jobs.close(); }

    } finally { clearInterval(timer); await api.jobs.close(); await workers.close(); db.close(); rmSync(directory, { recursive: true, force: true }); }
  }, 120_000); // Cold scanners, full projections, feedback refresh, and legacy result parsing.
});
