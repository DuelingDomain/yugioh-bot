import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Worker } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { BRIDGE_JUDGE_FRAMINGS, buildBridgeJudgeEvidence, importBridgeArtifact, makeBridgeJudgementRecord, saveBridgeJudgement, importCardEffectArtifact, type ArchetypeBridge, type BridgeJudgeClient } from "@yugidraft/shared/cards/effects";
import { createBridgeService, parseDeckSuggestionQuery } from "@yugidraft/shared/services";
import { defaultDuelSettings } from "@yugidraft/shared/duels";
import { BridgeApi } from "../src/bridge-api.js";
import { seedIdentity } from "./helpers/identity.js";
import { DeckSuggestionWorkers } from "../src/deck-suggestion-workers.js";
import { deckSuggestionScope } from "../src/deck-legality.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";
import { bridgeDatabase, effectDatabase, FAST_QUERY_TIMEOUT_MS } from "./helpers/bridge-worker-database.js";

describe("bridge scanner isolation", () => {
  it("lets the first bridge scan warm even after Suggestions has used the scanner", async () => {
    const db = bridgeDatabase();
    const directory = createHostDataFixture([{ code: 89631139, name: "Blue-Eyes White Dragon", type: 0x11 }]);
    const workers = new DeckSuggestionWorkers(db, directory, 120_000, {}, FAST_QUERY_TIMEOUT_MS);
    const jobs = () => (workers as unknown as { jobs: { worker: Worker; reject?: unknown; retiring?: boolean }[] }).jobs;
    try {
      await workers.run({
        query: parseDeckSuggestionQuery({ op: "suggestRows", deck: { main: [89631139], extra: [], side: [] } })!,
        legality: deckSuggestionScope("normal", directory, defaultDuelSettings("normal"), { cardBlocks: [] }),
      });
      const scanner = jobs()[0]!.worker;
      await expect(workers.bridgeEngines({ engines: ["Odion"] }, "g", 1)).rejects.toMatchObject({ status: 503 });
      expect(jobs()[0]?.retiring).not.toBe(true);
      await vi.waitFor(() => expect(jobs()[0]?.reject).toBeUndefined(), { timeout: 30_000 });
      await expect(workers.bridgeEngines({ engines: ["Odion"] }, "g")).resolves.toMatchObject({ engines: ["Odion"] });
      expect(jobs()[0]!.worker).toBe(scanner);
    } finally { await workers.close(); db.close(); rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);

  it("spawns scanners lazily within a 512 MiB heap budget and retires them while idle", async () => {
    const db = bridgeDatabase();
    const directory = createHostDataFixture([{ code: 89631139, name: "Blue-Eyes White Dragon", type: 0x11 }]);
    const workers = new DeckSuggestionWorkers(db, directory, 50, {}, FAST_QUERY_TIMEOUT_MS);
    const jobs = () => (workers as unknown as { jobs: { worker: Worker }[] }).jobs;
    const pending: Promise<unknown>[] = [];
    try {
      expect(jobs()).toHaveLength(0);
      pending.push(workers.bridgeCandidates({ kind: "bridges", op: "from", source: "Odion", format: "advanced", limit: 1 }));
      const scan = {
        query: parseDeckSuggestionQuery({ op: "suggestRows", deck: { main: [89631139], extra: [], side: [] } })!,
        legality: deckSuggestionScope("normal", directory, defaultDuelSettings("normal"), { cardBlocks: [] }),
      };
      pending.push(workers.run(scan), workers.run(scan));
      expect(jobs()).toHaveLength(3);
      const heap = jobs().reduce((mb, { worker }) => mb + worker.resourceLimits!.maxOldGenerationSizeMb! + worker.resourceLimits!.maxYoungGenerationSizeMb!, 0);
      expect(heap).toBeLessThanOrEqual(512);
      await Promise.all(pending);
      await vi.waitFor(() => expect(jobs()).toHaveLength(0), { timeout: 30_000 });
    } finally { const settled = Promise.allSettled(pending); await workers.close(); await settled; db.close(); rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);

  it("reserves a scanner for Suggestions when multiple interactive bridge queries arrive", async () => {
    const db = bridgeDatabase();
    const directory = createHostDataFixture([{ code: 89631139, name: "Blue-Eyes White Dragon", type: 0x11 }]);
    const workers = new DeckSuggestionWorkers(db, directory, 120_000, {}, FAST_QUERY_TIMEOUT_MS);
    const pending: Promise<unknown>[] = [];
    try {
      pending.push(workers.bridgeEngines({ engines: ["Odion"] }, "g"), workers.bridgeEngines({ engines: ["Blue-Eyes"] }, "g"));
      pending.push(Promise.resolve().then(() => workers.run({
        query: parseDeckSuggestionQuery({ op: "suggestRows", deck: { main: [89631139], extra: [], side: [] } })!,
        legality: deckSuggestionScope("normal", directory, defaultDuelSettings("normal"), { cardBlocks: [] }),
      })));
      const results = await Promise.all(pending);
      expect(results[0]).toMatchObject({ engines: ["Odion"] });
      expect(results[1]).toMatchObject({ engines: ["Blue-Eyes"] });
      expect(results[2]).toHaveProperty("rows");
    } finally { const settled = Promise.allSettled(pending); await workers.close(); await settled; db.close(); rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);

  it("reports unavailable ranking data lazily for an old graph, including an external replacement", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bridge-old-graph-"));
    const db = new Database(join(directory, "app.sqlite"));
    migrate(db);
    db.prepare("INSERT INTO bridge_graph VALUES(1,?,?)").run(JSON.stringify({ groups: {} }), "old");
    const actor = seedIdentity(db), workers = new DeckSuggestionWorkers(db, directory, 120_000, {}, FAST_QUERY_TIMEOUT_MS);
    const api = new BridgeApi(db, workers);
    const call = () => api.handle({ userId: actor.userId, bridgeRequest: { op: "engines", engines: ["Odion"] } }, "g", actor.playerId);
    try {
      await expect(call()).rejects.toMatchObject({ status: 503, message: "Bridge data is unavailable" });
      importCardEffectArtifact(db); importBridgeArtifact(db);
      await expect(call()).resolves.toMatchObject({ engines: ["Temple of the Kings"] });
      const external = new Database(db.name);
      try { external.prepare("UPDATE bridge_graph SET graph_json=?,source_version='older-replacement'").run(JSON.stringify({ groups: {} })); }
      finally { external.close(); }
      await expect(call()).rejects.toMatchObject({ status: 503, message: "Bridge data is unavailable" });
    } finally { await api.jobs.close(); await workers.close(); db.close(); rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);

  it("judges on the host with at most two requests while both scanners remain free", async () => {
    const db = effectDatabase();
    const directory = createHostDataFixture([{ code: 89631139, name: "Blue-Eyes White Dragon", type: 0x11 }]);
    const service = createBridgeService(db);
    const bridges = [["Odion", "Argostars"], ["Branded", "Despia"], ["Swordsoul", "Tenyi"]]
      .map(([source, target]) => service.bridgeBetween(source!, target!)!);
    let release!: () => void, active = 0, maximum = 0, calls = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const client: BridgeJudgeClient = { messages: { async create(request) {
      active++; calls++; maximum = Math.max(maximum, active);
      const evidence = JSON.parse(String(request.messages[0]!.content)) as ReturnType<typeof buildBridgeJudgeEvidence>;
      await gate; active--;
      return { id: `msg_pool_${calls}`, model: "claude-haiku-5-5", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 100 },
        content: [{ type: "text", text: JSON.stringify({ verdict: "valid", grade: "good", format_ok: true,
          pros: ["The supplied cards interact.", "Enables the proposed line."], cons: ["Needs the supplied cards.", "Requires the printed conditions."],
          lock_note: "Apply the supplied restrictions.", line: evidence!.cards.map(card => card.name) }) }] };
    } } };
    const workers = new DeckSuggestionWorkers(db, directory, 120_000, { client, env: {}, log: () => {} }, FAST_QUERY_TIMEOUT_MS);
    const pending: Promise<void>[] = [];
    try {
      for (const bridge of bridges) { expect(bridge).toBeTruthy(); pending.push(workers.rateBridge(bridge as ArchetypeBridge)); }
      await vi.waitFor(() => expect(active).toBe(2), { timeout: 30_000 });
      // Cold legality was prepared in a scanner before judging. Provider waits
      // leave that scanner idle and both Suggestions slots available.
      expect((workers as unknown as { jobs: { reject?: unknown }[] }).jobs.every(job => !job.reject)).toBe(true);
      const scan = {
        query: parseDeckSuggestionQuery({ op: "suggestRows", deck: { main: [89631139], extra: [], side: [] } })!,
        legality: deckSuggestionScope("normal", directory, defaultDuelSettings("normal"), { cardBlocks: [] }),
      };
      const normal = await Promise.all([workers.run(scan), workers.run(scan)]);
      expect(normal.every(result => "rows" in result)).toBe(true);
      expect(active).toBe(2);
      release(); await Promise.all(pending);
      expect(calls).toBe(6);
      expect(maximum).toBe(2);
    } finally { release(); await Promise.allSettled(pending); await workers.close(); db.close(); rmSync(directory, { recursive: true, force: true }); }
  }, 60_000);
});
