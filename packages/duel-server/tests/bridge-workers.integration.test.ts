import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Worker } from "node:worker_threads";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { BRIDGE_JUDGE_FRAMINGS, buildBridgeJudgeEvidence, importBridgeArtifact, makeBridgeJudgementRecord, saveBridgeJudgement, importCardEffectArtifact, type ArchetypeBridge, type BridgeJudgeClient } from "@yugidraft/shared/cards/effects";
import { createBridgeService, parseDeckSuggestionQuery } from "@yugidraft/shared/services";
import { defaultDuelSettings } from "@yugidraft/shared/duels";
import { BridgeApi } from "../src/bridge-api.js";
import { seedIdentity } from "./helpers/identity.js";
import { DeckSuggestionWorkers, type BridgeScan } from "../src/deck-suggestion-workers.js";
import { deckSuggestionScope } from "../src/deck-legality.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";

let bridgeCatalog: Buffer;
let effectCatalog: Buffer;
beforeAll(() => {
  const db = new Database(":memory:");
  try {
    migrate(db); importBridgeArtifact(db);
    bridgeCatalog = db.serialize();
    importCardEffectArtifact(db);
    effectCatalog = db.serialize();
  } finally { db.close(); }
}, 120_000); // Keep each worker/DB isolated without reimporting the pinned catalogs per test.

describe("bridge scanner isolation", () => {
  it("lets the first bridge scan warm even after Suggestions has used the scanner", async () => {
    const db = new Database(bridgeCatalog);
    const directory = createHostDataFixture([{ code: 89631139, name: "Blue-Eyes White Dragon", type: 0x11 }]);
    const workers = new DeckSuggestionWorkers(db, directory);
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
    const db = new Database(bridgeCatalog);
    const directory = createHostDataFixture([{ code: 89631139, name: "Blue-Eyes White Dragon", type: 0x11 }]);
    const workers = new DeckSuggestionWorkers(db, directory, 50);
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
    const db = new Database(bridgeCatalog);
    const directory = createHostDataFixture([{ code: 89631139, name: "Blue-Eyes White Dragon", type: 0x11 }]);
    const workers = new DeckSuggestionWorkers(db, directory);
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
    const actor = seedIdentity(db), workers = new DeckSuggestionWorkers(db, directory);
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

  it("projects full engines requests off the file-DB host loop and observes external feedback", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bridge-worker-projection-"));
    writeFileSync(join(directory, "app.sqlite"), effectCatalog);
    const db = new Database(join(directory, "app.sqlite"));
    db.pragma("journal_mode = WAL");
    const actor = seedIdentity(db), row = createBridgeService(db).bridgeBetween("Odion", "Argostars")!;
    const evidence = buildBridgeJudgeEvidence(db, row)!;
    for (const framing of BRIDGE_JUDGE_FRAMINGS) saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing, {
      verdict: "valid", grade: "good", pros: [], cons: [], lock_note: "", line: evidence.cards.map(card => card.name), format_ok: true,
    }));
    const workers = new DeckSuggestionWorkers(db, directory), api = new BridgeApi(db, workers);
    const call = (engines: string[]) => api.handle({ userId: actor.userId, bridgeRequest: { op: "engines", engines, format: "advanced" } }, "g", actor.playerId) as Promise<{ next: { engine: string }[] }>;
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
        const legacyWorkers = new DeckSuggestionWorkers(db, directory);
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

  it("keeps deep scans in their own lane while interactive traffic and Suggestions run", async () => {
    const db = new Database(bridgeCatalog);
    const directory = createHostDataFixture([{ code: 89631139, name: "Blue-Eyes White Dragon", type: 0x11 }]);
    const workers = new DeckSuggestionWorkers(db, directory);
    const jobs = () => (workers as unknown as { jobs: unknown[] }).jobs;
    try {
      const progress: string[] = [];
      const scan = { kind: "bridges", op: "live", source: "Odion", format: "advanced" } as const;
      const first = workers.bridgeCandidates(scan, value => {
        progress.push(value.phase);
        if (value.phase === "index") throw new Error("Progress consumer disconnected");
      });
      const second = workers.bridgeCandidates({ ...scan, source: "Blue-Eyes" });
      const genesys = workers.bridgeCandidates({ ...scan, format: "genesys" });
      expect(jobs()).toHaveLength(1);
      const interactive = workers.bridgeEngines({ engines: ["Odion"] }, "g");
      const suggestions = workers.run({
        query: parseDeckSuggestionQuery({ op: "suggestRows", deck: { main: [89631139], extra: [], side: [] } })!,
        legality: deckSuggestionScope("normal", directory, defaultDuelSettings("normal"), { cardBlocks: [] }),
      });
      expect(jobs()).toHaveLength(3);
      const [result, queued, filtered, normal, fast] = await Promise.all([first, second, genesys, suggestions, interactive]);
      expect(fast.engines).toEqual(["Odion"]);
      expect(Array.isArray(result)).toBe(true);
      expect(Array.isArray(queued)).toBe(true);
      expect(Array.isArray(filtered) && filtered.length > 0 && filtered.every(row => row.format === "genesys")).toBe(true);
      expect(normal).toHaveProperty("rows");
      expect(progress).toContain("score");
      expect(progress.at(-1)).toBe("done");
      const [outgoing, incoming] = await Promise.all([
        workers.bridgeCandidates({ ...scan, op: "outgoing", source: "Blue-Eyes" }),
        workers.bridgeCandidates({ ...scan, op: "into", source: "Blue-Eyes" }),
      ]);
      expect(Array.isArray(outgoing) && outgoing.length > 0 && outgoing.every(row => row.source === "Blue-Eyes")).toBe(true);
      expect(Array.isArray(incoming) && incoming.length > 0 && incoming.every(row => row.target === "Blue-Eyes")).toBe(true);
      const pressure = Array.from({ length: 20 }, () => workers.bridgeEngineProjection([], {
        source: "Odion", engines: ["Odion"], format: "advanced",
      }).then(() => "done", error => error.status));
      await expect(workers.bridgeCandidates({ ...scan, op: "from", limit: 1 })).resolves.toBeInstanceOf(Array);
      const answers = await Promise.all(pressure);
      expect(answers).toContain(503);
      const cold = new DeckSuggestionWorkers(db, directory);
      try {
        await expect(cold.bridgeEngines({ engines: ["Odion"] }, "g", 1)).rejects.toMatchObject({ status: 503 });
        const jobs = (cold as unknown as { jobs: { reject?: unknown; worker: unknown }[] }).jobs;
        expect(jobs).toHaveLength(1);
        const scanner = jobs[0]!.worker;
        // The caller deadline stays short, but the cold scan may finish warming.
        await vi.waitFor(() => expect(jobs[0]?.reject).toBeUndefined(), { timeout: 30_000 });
        await expect(cold.bridgeEngines({ engines: ["Odion"] }, "g")).resolves.toMatchObject({ engines: ["Odion"] });
        expect(jobs[0]!.worker).toBe(scanner);
      } finally { await cold.close(); }
    } finally { await workers.close(); db.close(); rmSync(directory, { recursive: true, force: true }); }
  }, 180_000); // Several real deep scans plus cold initialization; admission and caller deadlines stay checked above.

  it("judges on the host with at most two requests while both scanners remain free", async () => {
    const db = new Database(effectCatalog);
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
    const workers = new DeckSuggestionWorkers(db, directory, 120_000, { client, env: {}, log: () => {} });
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
