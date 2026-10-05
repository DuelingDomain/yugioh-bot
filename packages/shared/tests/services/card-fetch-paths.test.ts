import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/schema.js";
import type { CardCatalogService } from "../../src/services/card-catalog.js";

const paths: Array<[string, (catalog: CardCatalogService) => Promise<unknown>]> = [
  ["id", (c) => c.syncCardById(12345678)],
  ["name", (c) => c.syncCardByName("Cached Dragon")],
  ["search", (c) => c.syncCardsByFuzzyName("cached dragon")],
  ["archetype", (c) => c.syncByArchetype("Cached")],
  ["draft set", (c) => c.syncDraftPool({ setNames: ["Cached Set"], includeNames: [], excludeNames: [] })],
  ["draft include", (c) => c.syncDraftPool({ setNames: [], includeNames: ["Cached Dragon"], excludeNames: [] })],
  ["sets", (c) => c.syncSets()],
  ["preview", (c) => c.getSetPreview("Cached Set")],
  ["archetype list", (c) => c.listArchetypes()],
];
const failures = ["network", "timeout", "429", "503", "json"];
let db: Database.Database;
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); db = new Database(":memory:"); migrate(db); });
afterEach(() => { db.close(); vi.useRealTimers(); });

async function setup(failure: string, cached: boolean) {
  const { createCardCatalogService } = await import("../../src/services/card-catalog.js");
  if (cached) {
    db.prepare(`insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at,archetype)
      values (12345678,'Cached Dragon','Effect Monster','effect','full','small',?,'old','Cached')`)
      .run(JSON.stringify([{ set_name: "Cached Set" }]));
    db.exec(`insert into card_artworks (card_id,artwork_id,image_url,image_url_small,is_main) values (12345678,12345678,'full','small',1);
      insert into card_sets values ('Cached Set','CS',1,'old'); insert into archetypes values ('Cached','old');`);
  }
  const fetch = vi.fn(async () => {
    if (failure === "network") throw new Error("offline");
    if (failure === "timeout") return new Promise<Response>(() => {});
    if (failure === "json") return new Response("not JSON");
    return new Response("", { status: Number(failure), headers: { "Retry-After": "2" } });
  });
  return { catalog: createCardCatalogService(db, { fetch, identityCatalog: new Map() }), fetch };
}

describe.each(failures)("catalog %s failures", (failure) => {
  it.each(paths)("uses cached data for %s", async (_name, call) => {
    const { catalog } = await setup(failure, true);
    const result = expect(call(catalog)).resolves.toBeDefined();
    await vi.runAllTimersAsync();
    await result;
    expect(catalog.findByIds([12345678])[0].name).toBe("Cached Dragon");
  });
  it.each(paths)("returns a retry error without cache for %s", async (_name, call) => {
    const { catalog } = await setup(failure, false);
    const result = expect(call(catalog)).rejects.toThrow(/Try again/);
    await vi.runAllTimersAsync();
    await result;
  });
});
