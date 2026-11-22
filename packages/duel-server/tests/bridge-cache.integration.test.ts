import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { storedBridgeEngine } from "../../shared/dist/cards/effects/bridge-graph-store.js";
import { createBridgeService, createCardCatalogService } from "@yugidraft/shared/services";
import { effectFileDatabase } from "./helpers/bridge-worker-database.js";

describe("bridge engine cache and host isolation", () => {
  it("reuses the graph after catalog-only writes, and invalidates for capability and graph changes across connections", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bridge-cache-"));
    const path = join(directory, "app.sqlite");
    const db = effectFileDatabase(path);
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
});
