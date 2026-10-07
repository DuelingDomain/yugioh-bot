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


it("counts artwork enrichment in the 50-fetch budget and retains successfully fetched cards", async () => {
  const db = new Database(":memory:"); migrate(db);
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const params = new URL(String(input)).searchParams;
    const id = Number(params.get("id") ?? params.get("name")!.split(" ")[1]);
    return Response.json({ data: [{ id, name: `Card ${id}`, type: "Effect Monster", frameType: "effect",
      card_images: [{ id, image_url: "i", image_url_small: "i" }] }] });
  });
  const catalog = createCardCatalogService(db, { identityCatalog: new Map(), fetch });
  const ids = Array.from({ length: 60 }, (_, i) => i + 1);
  const budget = createCardLookupBudget();
  try {
    expect(await ensureCatalogCards(catalog, ids, budget)).toEqual(ids.slice(25));
    expect(fetch).toHaveBeenCalledTimes(50);
    expect(budget.lookupLimited).toBe(true);
    expect(catalog.findByIds(ids)).toHaveLength(25);
  } finally { db.close(); }
}, 40000);
