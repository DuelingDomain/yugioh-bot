import Database from "better-sqlite3";
import { expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { BRIDGE_JUDGE_FRAMINGS, buildBridgeJudgeEvidence, importBridgeArtifact, importCardEffectArtifact,
  makeBridgeJudgementRecord, readBridgeJudgements, saveBridgeJudgement } from "@yugidraft/shared/cards/effects";
import { createBridgeService } from "@yugidraft/shared/services";
import { BridgeApi } from "../src/bridge-api.js";
import { BridgeEngineQueries } from "../src/bridge-engine-queries.js";
import { bridgeQueryFixture } from "./helpers/bridge-query-fixture.js";
import { seedIdentity } from "./helpers/identity.js";

it("shows official names while preserving stored reviews, aliases and saved chip identities", async () => {
  const db = new Database(":memory:"); migrate(db); importCardEffectArtifact(db); importBridgeArtifact(db);
  const queries = new BridgeEngineQueries(db);
  const row = createBridgeService(db).bridgeBetween("Odion", "Argostars")!;
  const evidence = buildBridgeJudgeEvidence(db, row)!;
  for (const framing of BRIDGE_JUDGE_FRAMINGS) saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing, {
    verdict: "valid", grade: "good", pros: [], cons: [], lock_note: "", line: ["Temple of the Kings"], format_ok: true,
  }));
  const reviews = readBridgeJudgements(db, row.evidence_hash);
  const workers = { ...bridgeQueryFixture(db), bridgeEngineShortlist: vi.fn(), bridgeEngineProjection: vi.fn(),
    bridgeEngines: async (input: Record<string, unknown>, guildId: string) => {
      const { query, detected } = queries.resolve(input, guildId);
      return { ...queries.project(queries.service.engineRows(query.engines, query.format), query), ...(detected ? { detected } : {}) };
    }, bridgeCandidates: vi.fn(), rateBridge: vi.fn() };
  const api = new BridgeApi(db, workers);
  const user = seedIdentity(db, { name: "Official engine names" });
  const call = (bridgeRequest: Record<string, unknown>) => api.handle({ userId: user.userId, bridgeRequest }, "g", user.playerId);
  try {
    const official = await call({ op: "between", source: "Temple of the Kings", target: "Argostars" });
    expect(official).toMatchObject({ results: [{ source: "Temple of the Kings", target: "Argostars", evidence_hash: row.evidence_hash }] });
    expect(await call({ op: "between", source: "Odion", target: "Argostars" })).toEqual(official);
    const deck = { main: [29762407, 29762407, 97522863, 97522863], extra: [] };
    const detected = await call({ op: "engines", deck, format: "advanced" });
    expect(JSON.stringify(detected)).not.toContain("Odion");
    expect(detected).toMatchObject({ engines: ["Temple of the Kings"], detected: [{ name: "Temple of the Kings" }] });
    expect(queries.resolve({ engines: ["Odion"], format: "advanced" }, "g").query)
      .toEqual(queries.resolve({ engines: [" temple of the kings "], format: "advanced" }, "g").query);
    expect(readBridgeJudgements(db, row.evidence_hash)).toEqual(reviews);
    expect(buildBridgeJudgeEvidence(db, row)?.input_hash).toBe(evidence.input_hash);
    expect(workers.rateBridge).not.toHaveBeenCalled();
    expect(workers.bridgeCandidates).not.toHaveBeenCalled();
  } finally { await api.jobs.close(); db.close(); }
}, 30_000);
