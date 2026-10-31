import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { bridgeGate, buildBridgeJudgeEvidence, importBridgeArtifact, importCardEffectArtifact, type ArchetypeBridge } from "@yugidraft/shared/cards/effects";
import { storedBridgeEngine } from "../../shared/dist/cards/effects/bridge-graph-store.js";
import { createBridgeService, createCardCatalogService } from "@yugidraft/shared/services";
import { BridgeApi } from "../src/bridge-api.js";
import { DeckSuggestionWorkers } from "../src/deck-suggestion-workers.js";
import { seedIdentity } from "./helpers/identity.js";

describe("bridge engine cache and host isolation", () => {
  it("reuses the graph after real catalog lookups, and invalidates for changed text and legality across connections", async () => {
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
        card_images: [{ id: 89631139, image_url: "refreshed", image_url_small: "thumbnail" }],
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
      const changedText = storedBridgeEngine(db);
      expect(changedText === initial).toBe(false);
      const capability = external.prepare("SELECT passcode,capabilities_json FROM card_capability LIMIT 1").get() as { passcode: number; capabilities_json: string };
      external.prepare("UPDATE card_capability SET capabilities_json=capabilities_json WHERE passcode=?").run(capability.passcode);
      expect(storedBridgeEngine(db) === changedText).toBe(true);
      const data = JSON.parse(capability.capabilities_json);
      let previous = changedText;
      for (const changed of [{ genesysPoints: (data.card.genesysPoints ?? 0) + 1 }, { banTcg: "Forbidden" }, { formats: [] }]) {
        Object.assign(data.card, changed);
        external.prepare("UPDATE card_capability SET capabilities_json=? WHERE passcode=?").run(JSON.stringify(data), capability.passcode);
        const current = storedBridgeEngine(db);
        expect(current === previous).toBe(false);
        previous = current;
      }
    } finally { external.close(); db.close(); rmSync(directory, { recursive: true, force: true }); }
  });

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
      const started = await call({ op: "start", source: "Odion", target: "Argostars" }) as { jobId: string };
      await api.jobs.close();
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
