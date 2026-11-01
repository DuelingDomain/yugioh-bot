import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { bridgeGate, buildBridgeJudgeEvidence, importBridgeArtifact, importCardEffectArtifact, type ArchetypeBridge, type BridgeJudgeClient } from "@yugidraft/shared/cards/effects";
import { storedBridgeEngine } from "../../shared/dist/cards/effects/bridge-graph-store.js";
import { storedBridgeLegalIds } from "../../shared/dist/cards/effects/bridge-legality-store.js";
import { createBridgeService, createCardCatalogService } from "@yugidraft/shared/services";
import { BridgeApi } from "../src/bridge-api.js";
import { DeckSuggestionWorkers } from "../src/deck-suggestion-workers.js";
import { seedIdentity } from "./helpers/identity.js";

describe("bridge engine cache and host isolation", () => {
  it("reuses the graph after catalog-only writes, and invalidates for capability and graph changes across connections", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bridge-cache-"));
    const db = new Database(join(directory, "app.sqlite"));
    migrate(db); importCardEffectArtifact(db); importBridgeArtifact(db);
    const external = new Database(db.name);
    try {
      db.prepare(`INSERT INTO card_catalog(ygoprodeck_id,name,type,frame_type,effect_text,image_url,image_url_small,card_sets_json,cached_at)
        VALUES(89631139,'Blue-Eyes White Dragon','Normal Monster','normal','Original text','','','[]','first')`).run();
      const initial = storedBridgeEngine(db);
      const service = createBridgeService(db), core = service.corePlan("Blue-Eyes", "advanced"), ranking = service.rankingContext();
      const catalog = createCardCatalogService(external, { identityCatalog: new Map(), fetch: async () => new Response(JSON.stringify({ data: [{
        id: 89631139, name: "Blue-Eyes White Dragon", type: "Normal Monster", frameType: "normal", desc: "Original text",
        card_images: [{ id: 89631139, image_url: "refreshed", image_url_small: "thumbnail" },
          { id: 89631140, image_url: "alternate", image_url_small: "alternate-thumbnail" }],
      }] })) });
      // The second lookup also exercises the artwork writer's temporary reset
      // of is_main before it writes the same canonical mapping back.
      await catalog.syncByArchetype("Blue-Eyes");
      await catalog.syncByArchetype("Blue-Eyes");
      expect(storedBridgeEngine(db) === initial).toBe(true);
      expect(service.corePlan("Blue-Eyes", "advanced") === core).toBe(true);
      expect(service.rankingContext() === ranking).toBe(true);
      external.prepare(`UPDATE card_catalog SET name=name,effect_text=effect_text,type=type,frame_type=frame_type,
        cached_at='lookup',image_url='refreshed' WHERE ygoprodeck_id=89631139`).run();
      expect(storedBridgeEngine(db) === initial).toBe(true);
      external.prepare("UPDATE card_catalog SET effect_text='Changed text' WHERE ygoprodeck_id=89631139").run();
      external.prepare("INSERT INTO archetypes(name,synced_at) VALUES('Cache-only archetype','now')").run();
      external.prepare("INSERT INTO card_release(passcode,quality,source_version) VALUES(4294967295,'unknown','cache-only')").run();
      external.prepare("UPDATE card_release SET quality='ok' WHERE passcode=4294967295").run();
      external.prepare("DELETE FROM card_release WHERE passcode=4294967295").run();
      external.prepare("DELETE FROM archetypes WHERE name='Cache-only archetype'").run();
      external.prepare("DELETE FROM card_artworks WHERE artwork_id=89631140").run();
      external.prepare("DELETE FROM card_catalog WHERE ygoprodeck_id=89631140").run();
      expect(storedBridgeEngine(db) === initial).toBe(true);
      const capability = external.prepare("SELECT passcode,capabilities_json FROM card_capability LIMIT 1").get() as { passcode: number; capabilities_json: string };
      external.prepare("UPDATE card_capability SET capabilities_json=capabilities_json WHERE passcode=?").run(capability.passcode);
      expect(storedBridgeEngine(db) === initial).toBe(true);
      const data = JSON.parse(capability.capabilities_json);
      let previous = initial;
      for (const changed of [{ genesysPoints: (data.card.genesysPoints ?? 0) + 1 }, { banTcg: "Forbidden" }, { formats: [] }]) {
        Object.assign(data.card, changed);
        external.prepare("UPDATE card_capability SET capabilities_json=? WHERE passcode=?").run(JSON.stringify(data), capability.passcode);
        const current = storedBridgeEngine(db);
        expect(current === previous).toBe(false);
        previous = current;
      }
      external.prepare("UPDATE bridge_graph SET graph_json=json_set(graph_json,'$.cacheTest',1) WHERE id=1").run();
      expect(storedBridgeEngine(db) === previous).toBe(false);
    } finally { external.close(); db.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  it("replaces legacy trigger definitions on migration without duplicate revision bumps", () => {
    const db = new Database(":memory:"); migrate(db);
    try {
      db.exec(`DROP TRIGGER card_capability_bridge_engine_update;
        CREATE TRIGGER card_capability_bridge_engine_update AFTER UPDATE ON card_capability
        BEGIN UPDATE bridge_engine_revision SET revision=revision+100 WHERE id=1; END;
        CREATE TRIGGER IF NOT EXISTS card_catalog_bridge_engine_insert AFTER INSERT ON card_catalog
        BEGIN UPDATE bridge_engine_revision SET revision=revision+100 WHERE id=1; END;`);
      migrate(db); migrate(db);
      const revision = () => (db.prepare("SELECT revision FROM bridge_engine_revision WHERE id=1").get() as { revision: number }).revision;
      const initial = revision();
      db.prepare("INSERT INTO card_capability VALUES(1,'{}','text','evidence','source')").run();
      expect(revision()).toBe(initial + 1);
      db.prepare("UPDATE card_capability SET source_version='source-2' WHERE passcode=1").run();
      expect(revision()).toBe(initial + 1);
      db.prepare("UPDATE card_capability SET capabilities_json=? WHERE passcode=1").run(JSON.stringify({ changed: true }));
      expect(revision()).toBe(initial + 2);
      db.prepare("DELETE FROM card_capability WHERE passcode=1").run();
      expect(revision()).toBe(initial + 3);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'card_catalog_bridge_engine_%'").all()).toEqual([]);
      expect(db.prepare("SELECT DISTINCT tbl_name FROM sqlite_master WHERE type='trigger' AND name LIKE '%_bridge_engine_%' ORDER BY tbl_name").all())
        .toEqual([{ tbl_name: "bridge_graph" }, { tbl_name: "card_capability" }]);
    } finally { db.close(); }
  });

  it("builds cold and revised legality sets in a scanner and retries a stale worker snapshot", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bridge-worker-legality-"));
    const db = new Database(join(directory, "app.sqlite"));
    db.pragma("journal_mode = WAL"); migrate(db); importBridgeArtifact(db);
    const external = new Database(db.name);
    let calls = 0;
    const client: BridgeJudgeClient = { messages: { create: async request => {
      // A catalog import can change unrelated legality while a provider is pending.
      if (!calls++) external.prepare("UPDATE card_capability SET capabilities_json=json_set(capabilities_json,'$.card.banTcg',null) WHERE passcode=89631139").run();
      const evidence = JSON.parse(request.messages[0]!.content as string);
      return { id: `msg_legality_${calls}`, model: request.model, stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 },
        content: [{ type: "text", text: JSON.stringify({ verdict: "valid", grade: "good", pros: [], cons: [], lock_note: "",
          line: evidence.cards.slice(0, 3).map((card: { name: string }) => card.name), format_ok: true }) }] };
    } } };
    const workers = new DeckSuggestionWorkers(db, directory, 120_000, { client, env: {}, log: () => {} });
    const original = db.prepare.bind(db);
    const prepare = vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (/FROM card_capability\s*(?:ORDER BY passcode)?\s*$/i.test(sql)) throw new Error("Global catalog scan on host");
      return original(sql);
    });
    const post = Worker.prototype.postMessage;
    let changed = false;
    const messages = vi.spyOn(Worker.prototype, "postMessage").mockImplementation(function (this: Worker, message, ...args) {
      if (message.kind === "bridge-legality" && !changed) {
        this.prependOnceListener("message", () => {
          changed = true;
          external.prepare("UPDATE card_capability SET capabilities_json=json_set(capabilities_json,'$.card.banTcg','Forbidden') WHERE passcode=89631139").run();
        });
      }
      return post.call(this, message, ...args);
    });
    try {
      const row = await workers.bridgeCandidates({ kind: "bridges", op: "explain", source: "Fire Formation", target: "Lunalight", format: "advanced" }) as ArchetypeBridge;
      const read = (state = "pending") => workers.withBridgeLegality("advanced", () => {
        expect(db.inTransaction).toBe(true);
        expect(bridgeGate(db, row).state).toBe(state);
        return storedBridgeLegalIds(db, "advanced");
      });
      const initial = await read();
      expect(changed).toBe(true);
      expect(initial.has(89631139)).toBe(false);
      expect(await read()).toBe(initial);
      expect(messages.mock.calls.filter(([scan]) => scan.kind === "bridge-legality")).toHaveLength(2);
      external.prepare("UPDATE card_capability SET capabilities_json=json_set(capabilities_json,'$.card.banTcg',null) WHERE passcode=89631139").run();
      const revised = await read();
      expect(revised).not.toBe(initial);
      expect(revised.has(89631139)).toBe(true);
      expect(messages.mock.calls.filter(([scan]) => scan.kind === "bridge-legality")).toHaveLength(3);
      // Initial and final judge gates both refresh legality off the host thread.
      external.prepare("UPDATE card_capability SET capabilities_json=json_set(capabilities_json,'$.card.banTcg','Forbidden') WHERE passcode=89631139").run();
      await workers.rateBridge(row);
      expect(calls).toBe(2);
      expect((await read("shown")).has(89631139)).toBe(true);
      expect(messages.mock.calls.filter(([scan]) => scan.kind === "bridge-legality")).toHaveLength(5);
      expect(prepare.mock.calls.some(([sql]) => /FROM card_capability\s*(?:ORDER BY passcode)?\s*$/i.test(sql))).toBe(false);
    } finally {
      messages.mockRestore(); prepare.mockRestore(); await workers.close();
      external.close(); db.close(); rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("keeps cold directed list projection and deep engine resolution out of the host catalog scan", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bridge-cold-host-"));
    const db = new Database(join(directory, "app.sqlite"));
    migrate(db); importCardEffectArtifact(db); importBridgeArtifact(db);
    const identity = seedIdentity(db), workers = new DeckSuggestionWorkers(db, directory);
    const api = new BridgeApi(db, workers);
    const original = db.prepare.bind(db);
    const prepare = vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (/SELECT capabilities_json FROM card_capability ORDER BY passcode/i.test(sql)) throw new Error("Full bridge graph loaded on host");
      return original(sql);
    });
    const call = (bridgeRequest: Record<string, unknown>) => api.handle({ userId: identity.userId, bridgeRequest }, "g", identity.playerId);
    try {
      const stored = db.prepare("SELECT bridge_json FROM archetype_bridge WHERE source='Odion' AND target='Blue-Eyes' AND format='advanced'").get() as { bridge_json: string };
      const niche = JSON.parse(stored.bridge_json) as ArchetypeBridge;
      expect(buildBridgeJudgeEvidence(db, niche)).not.toBeNull();
      expect(bridgeGate(db, niche).state).toBe("pending");
      await expect(call({ op: "between", source: "Odion", target: "Argostars" })).resolves.toHaveProperty("results");
      await expect(call({ op: "from", source: "Odion" })).resolves.toHaveProperty("results");
      // Joining an absent job resolves explicit engines without starting any paid work.
      await expect(call({ op: "start", engines: ["Odion"], join: true })).rejects.toMatchObject({ status: 404 });
    } finally { prepare.mockRestore(); await api.jobs.close(); await workers.close(); db.close(); rmSync(directory, { recursive: true, force: true }); }
  }, 20_000);

  it("projects directed deep results and next engines in one worker request within the status deadline", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bridge-status-budget-"));
    const db = new Database(join(directory, "app.sqlite"));
    migrate(db); importBridgeArtifact(db);
    const identity = seedIdentity(db), workers = new DeckSuggestionWorkers(db, directory);
    vi.spyOn(workers, "bridgeCandidates").mockResolvedValue([]);
    let now = Date.now();
    const api = new BridgeApi(db, workers, () => now);
    const messages = vi.spyOn(Worker.prototype, "postMessage");
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const call = (bridgeRequest: Record<string, unknown>) => api.handle({ userId: identity.userId, bridgeRequest }, "g", identity.playerId);
    try {
      const started = await call({ op: "start", source: "Temple of the Kings" }) as { jobId: string };
      await api.jobs.close();
      messages.mockClear();
      const status = () => call({ op: "status", jobId: started.jobId });
      await expect(status()).resolves.toMatchObject({ state: "done", results: [], next: [] });
      expect(messages.mock.calls.map(([scan]) => (scan as { kind: string }).kind)).toEqual(["bridge-directed-projection"]);
      now += 6000; // Expire the completed projection cache.
      // A scanner that stops answering must release the caller's status slot
      // before the web's five-second read deadline, including this combined work.
      messages.mockImplementation(() => {});
      await expect(Promise.race([status(), new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error("Status exceeded its five-second web deadline")), 5000);
      })])).rejects.toMatchObject({ status: 503 });
    } finally {
      clearTimeout(deadline); messages.mockRestore();
      await api.jobs.close(); await workers.close(); db.close(); rmSync(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
