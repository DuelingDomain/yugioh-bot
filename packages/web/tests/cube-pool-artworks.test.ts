import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createCardLookupBudget, createCardCatalogService } from "@yugidraft/shared/services";
import { ensureCatalogCards } from "../src/lib/cube-pool";

it("materializes engine-only artwork IDs before a cube can reference them", async () => {
  const db = new Database(":memory:"); migrate(db);
  const fixtures = JSON.parse(readFileSync(new URL("../../shared/tests/fixtures/card-artworks.json", import.meta.url), "utf8"));
  const catalog = createCardCatalogService(db, { identityCatalog: new Map([
    [89631139, { name: "Blue-Eyes White Dragon", type: 17, alias: 0 }],
    [89631147, { name: "Blue-Eyes White Dragon", type: 17, alias: 89631139 }],
  ]), fetch: async () => ({ ok: true, json: async () => ({ data: [fixtures[1]] }) }) });
  try {
    await catalog.syncCardByName("Blue-Eyes White Dragon");
    expect(catalog.findByIds([89631147])).toHaveLength(1);
    expect(catalog.hasCatalogRow(89631147)).toBe(false);
    expect(await ensureCatalogCards(catalog, [89631147])).toEqual([]);
    expect(catalog.hasCatalogRow(89631147)).toBe(true);
    expect(catalog.canonicalId(89631147)).toBe(89631139);
  } finally { db.close(); }
});

it("saves a legacy 100-card cube without artwork requests when the API is offline", async () => {
  const db = new Database(":memory:"); migrate(db);
  const ids = Array.from({ length: 100 }, (_, i) => 10000000 + i);
  const insert = db.prepare(`insert into card_catalog
    (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
    values (?,'Legacy','Effect Monster','effect','full','small','[]','old')`);
  for (const id of ids) insert.run(id);
  const fetch = vi.fn(async () => { throw new Error("offline"); });
  const catalog = createCardCatalogService(db, { identityCatalog: new Map(), fetch });
  try {
    await expect(ensureCatalogCards(catalog, ids)).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  } finally { db.close(); }
});

it("fills Extra Deck artworks once across repeated cube checks", async () => {
  const db = new Database(":memory:"); migrate(db);
  const card = { id: 44508094, name: "Stardust Dragon", type: "Synchro Monster", frameType: "synchro",
    card_images: [{ id: 44508094, image_url: "full", image_url_small: "small" }] };
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: [card] }) }));
  const catalog = createCardCatalogService(db, { identityCatalog: new Map(), fetch });
  try {
    for (let i = 0; i < 3; i++) expect(await ensureCatalogCards(catalog, [card.id])).toEqual([]);
    expect(catalog.hasArtworks(card.id)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally { db.close(); }
});


const listing = () => vi.fn(async (input: string | URL | Request) => {
  const params = new URL(String(input)).searchParams;
  const ids = params.has("id") ? params.get("id")!.split(",").map(Number) : [Number(params.get("name")!.split(" ")[1])];
  return Response.json({ data: ids.map((id) => ({ id, name: `Card ${id}`, type: "Effect Monster", frameType: "effect",
    card_images: [{ id, image_url: "i", image_url_small: "i" }] })) });
});

it("looks passcodes up in batches of 20, one budgeted request each, and keeps artwork lookups off the budget", async () => {
  const db = new Database(":memory:"); migrate(db);
  const fetch = listing();
  const catalog = createCardCatalogService(db, { identityCatalog: new Map(), fetch });
  const ids = Array.from({ length: 60 }, (_, i) => i + 1);
  const budget = createCardLookupBudget();
  // Advance the real fetch helper's rate-limit timers without waiting for the artwork requests.
  vi.useFakeTimers();
  try {
    const result = expect(ensureCatalogCards(catalog, ids, budget)).resolves.toEqual([]);
    await Promise.all([result, vi.runAllTimersAsync()]);
    const requests = fetch.mock.calls.map(([input]) => new URL(String(input)).searchParams);
    expect(requests.filter((params) => params.has("id")).map((params) => params.get("id")!.split(",").length)).toEqual([20, 20, 20]);
    expect(requests.filter((params) => params.has("name"))).toHaveLength(60);
    expect(budget).toEqual({ remaining: 47, lookupLimited: false });
    expect(catalog.findByIds(ids).map((card) => card.ygoprodeckId)).toEqual(ids);
  } finally { vi.useRealTimers(); db.close(); }
});

it("reserves the lookup budget for cards and retains successfully fetched cards", async () => {
  const db = new Database(":memory:"); migrate(db);
  const fetch = listing();
  const catalog = createCardCatalogService(db, { identityCatalog: new Map(), fetch });
  const ids = Array.from({ length: 60 }, (_, i) => i + 1);
  // Two lookups are left: two batches of 20 fit, the last 20 passcodes are skipped.
  const budget = { remaining: 2, lookupLimited: false };
  vi.useFakeTimers();
  try {
    const result = expect(ensureCatalogCards(catalog, ids, budget)).resolves.toEqual(ids.slice(40));
    await Promise.all([result, vi.runAllTimersAsync()]);
    expect(budget).toEqual({ remaining: 0, lookupLimited: true });
    expect(catalog.findByIds(ids).map((card) => card.ygoprodeckId)).toEqual(ids.slice(0, 40));
  } finally { vi.useRealTimers(); db.close(); }
});
