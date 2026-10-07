import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/schema.js";
import type { CardCatalogService } from "../../src/services/card-catalog.js";
import { createCardLookupBudget } from "../../src/services/card-lookup-budget.js";

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
afterEach(() => { db.close(); vi.useRealTimers(); vi.unstubAllEnvs(); });

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

describe("healthy draft imports", () => {
  it.each([undefined, "32"])("saves all 60 new passcodes with CARD_FETCH_QUEUE_LIMIT=%s", async (limit) => {
    vi.stubEnv("CARD_FETCH_QUEUE_LIMIT", limit);
    const { createCardCatalogService } = await import("../../src/services/card-catalog.js");
    const cards = Array.from({ length: 60 }, (_, i) => ({
      id: 10000000 + i, name: `New Card ${i}`, type: "Effect Monster", frameType: "effect",
      card_images: [{ id: 10000000 + i, image_url: "full", image_url_small: "small" }],
    }));
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const params = new URL(String(input)).searchParams;
      const card = cards.find((card) => params.has("id") ? card.id === Number(params.get("id")) : card.name === params.get("name"));
      return new Response(JSON.stringify({ data: card ? [card] : [] }));
    });
    const catalog = createCardCatalogService(db, { fetch, identityCatalog: new Map() });
    const result = expect(catalog.syncDraftPool({ setNames: [], customCardIds: cards.map((card) => card.id),
      includeNames: [], excludeNames: [] })).resolves.toHaveLength(60);
    await Promise.all([result, vi.runAllTimersAsync()]);
    expect(catalog.findByIds(cards.map((card) => card.id))).toHaveLength(60);
    expect(db.prepare("select count(*) as n from card_catalog").get()).toEqual({ n: 60 });
    expect(fetch).toHaveBeenCalledTimes(120);
  });
});

describe("passcode lookup budget", () => {
  it.each([
    ["individual", 50], ["individual", 51], ["draft pool", 50], ["draft pool", 51],
  ] as const)("resolves 50 new cards with artwork enrichment via %s (%i requested)", async (path, count) => {
    const { createCardCatalogService } = await import("../../src/services/card-catalog.js");
    const cards = Array.from({ length: count }, (_, i) => ({
      id: 10000000 + i, name: `New Card ${i}`, type: "Effect Monster", frameType: "effect",
      card_images: [{ id: 10000000 + i, image_url: "full", image_url_small: "small" }],
    }));
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const params = new URL(String(input)).searchParams;
      const card = cards.find((card) => params.has("id") ? card.id === Number(params.get("id")) : card.name === params.get("name"));
      return Response.json({ data: card ? [card] : [] });
    });
    const catalog = createCardCatalogService(db, { fetch, identityCatalog: new Map() });
    const lookupBudget = createCardLookupBudget();
    const ids = cards.map((card) => card.id);
    const resolve = async () => {
      if (path === "draft pool") {
        await catalog.syncDraftPool({ setNames: [], customCardIds: ids, includeNames: [], excludeNames: [] }, { lookupBudget });
      } else {
        for (const id of ids) await catalog.syncCardById(id, { lookupBudget });
      }
    };
    await Promise.all([resolve(), vi.runAllTimersAsync()]);
    expect(catalog.findByIds(ids).map((card) => card.ygoprodeckId)).toEqual(ids.slice(0, 50));
    expect(lookupBudget).toEqual({ remaining: 0, lookupLimited: count > 50 });
    expect(fetch.mock.calls.filter(([input]) => new URL(String(input)).searchParams.has("id"))).toHaveLength(50);
    // A cached card remains usable without triggering another lookup after exhaustion.
    expect((await catalog.syncCardById(ids[0], { lookupBudget }))?.ygoprodeckId).toBe(ids[0]);
    expect(lookupBudget.lookupLimited).toBe(count > 50);
  });
});

describe("cached draft sets", () => {
  const draft = (catalog: CardCatalogService) => catalog.syncDraftPool({
    setNames: ["Pendulum Domination Structure Deck"], includeNames: [], excludeNames: [],
  });

  it.each([43, null])("rejects one cached card when the set count is %s", async (count) => {
    const { catalog } = await setup("503", true);
    db.prepare("update card_catalog set card_sets_json = ?").run(JSON.stringify([{ set_name: "Pendulum Domination Structure Deck" }]));
    db.prepare("update card_sets set set_name = ?, card_count = ?").run("Pendulum Domination Structure Deck", count);
    const result = expect(draft(catalog)).rejects.toThrow("Could not reach the card database. Try again shortly.");
    await Promise.all([result, vi.runAllTimersAsync()]);
  });

  it("does not count alternate artworks as additional cards", async () => {
    const { catalog } = await setup("503", true);
    db.exec(`update card_sets set card_count = 2;
      insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
      select 12345679,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at from card_catalog;
      insert into card_artworks (card_id,artwork_id,image_url,image_url_small,is_main) values (12345678,12345679,'alt','alt',0);`);
    const result = expect(catalog.syncDraftPool({ setNames: ["Cached Set"], includeNames: [], excludeNames: [] })).rejects.toThrow(/Try again/);
    await Promise.all([result, vi.runAllTimersAsync()]);
  });

  it("checks the full set before excluding names and Extra Deck cards", async () => {
    const { catalog } = await setup("503", true);
    db.exec(`update card_sets set card_count = 2;
      insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
      select 22345678,'Cached Fusion','Fusion Monster','fusion',image_url,image_url_small,card_sets_json,cached_at from card_catalog;`);
    const result = expect(catalog.syncDraftPool({ setNames: ["Cached Set"], includeNames: [], excludeNames: ["Cached Dragon"] })).resolves.toEqual([]);
    await Promise.all([result, vi.runAllTimersAsync()]);
  });
});

describe("invalid queries with cached results", () => {
  const queriedPaths = paths.filter(([name]) => ["name", "search", "archetype", "draft set", "draft include", "sets"].includes(name));

  it.each(queriedPaths)("does not hide an invalid 400 query with the cache for %s", async (_name, call) => {
    await setup("503", true);
    const { createCardCatalogService } = await import("../../src/services/card-catalog.js");
    const catalog = createCardCatalogService(db, { identityCatalog: new Map(), fetch: async () =>
      new Response(JSON.stringify({ error: "Invalid query parameter" }), { status: 400 }) });
    await expect(call(catalog)).rejects.toMatchObject({ name: "CardFetchError", status: 400 });
  });

  it("does not hide an unreadable 400 body with a complete set cache", async () => {
    await setup("503", true);
    const { createCardCatalogService } = await import("../../src/services/card-catalog.js");
    const catalog = createCardCatalogService(db, { identityCatalog: new Map(),
      fetch: async () => new Response("invalid JSON", { status: 400 }) });
    await expect(catalog.syncDraftPool({ setNames: ["Cached Set"], includeNames: [], excludeNames: [] }))
      .rejects.toMatchObject({ name: "CardFetchError", status: 400 });
  });
});
