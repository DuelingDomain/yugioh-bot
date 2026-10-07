import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createCardLookupBudget } from "../../src/services/card-lookup-budget.js";
import { createCardCatalogService } from "../../src/services/card-catalog.js";

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
const card = (id: number, name: string, frameType = "effect") => ({ id, name, frameType,
  type: frameType === "synchro" ? "Synchro Monster" : "Effect Monster",
  card_images: [{ id, image_url: "image", image_url_small: "small" }] });

function setup(cached: ReturnType<typeof card>[] = [], remote: ReturnType<typeof card>[] = []) {
  const db = new Database(":memory:"); databases.push(db); migrate(db);
  const insert = db.prepare(`insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
    values (?,?,?,?,?,?,'[]','now')`);
  for (const c of cached) insert.run(c.id, c.name, c.type, c.frameType, "image", "small");
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const params = new URL(String(input)).searchParams;
    const names = params.get("name")?.toLowerCase().split("|");
    const fuzzy = params.get("fname")?.toLowerCase();
    const data = remote.filter((c) => names?.includes(c.name.toLowerCase()) || (fuzzy && c.name.toLowerCase().includes(fuzzy)));
    return data.length ? Response.json({ data }) : Response.json({ error: "No card matching your query was found" }, { status: 400 });
  });
  return { db, fetch, catalog: createCardCatalogService(db, { fetch, identityCatalog: new Map() }) };
}

describe("catalog list name resolution", () => {
  it("can check only normalized exact cached names without probing missing alternatives", async () => {
    const { catalog, fetch } = setup([card(1, "7 Colored Fish")]);
    const result = await catalog.resolveCardNames(["Colored Fish", "7 Colored Fish"], { cacheOnly: true });
    expect(result.map((r) => r.card?.ygoprodeckId)).toEqual([undefined, 1]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses normalized catalog names without fetching, including Extra Deck and straight/curly quotes", async () => {
    const { catalog, fetch } = setup([card(1, "Blue-Eyes White Dragon"), card(2, 'Maxx "C"'), card(3, "Gravekeeper's Spy"), card(4, "Shooting Star Dragon", "synchro")]);
    const result = await catalog.resolveCardNames([" blue eyes  WHITE dragon ", 'Maxx “C”', "Gravekeeper’s Spy", "Shooting Star Dragon"]);
    expect(result.map((r) => r.card?.ygoprodeckId)).toEqual([1, 2, 3, 4]);
    expect(result.every((r) => !r.corrected)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("batches missing names, caches resolved artwork families and does not re-fetch", async () => {
    const { catalog, fetch, db } = setup([], [card(1, "Dark Hole"), card(2, "Shooting Star Dragon", "synchro"), card(3, 'Maxx "C"')]);
    const names = ["Dark Hole", "Shooting Star Dragon", 'Maxx “C”'];
    expect((await catalog.resolveCardNames(names)).map((r) => r.card?.ygoprodeckId)).toEqual([1, 2, 3]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetch.mock.calls[0][0])).searchParams.get("name")).toBe('Dark Hole|Shooting Star Dragon|Maxx "C"');
    expect(db.prepare("select count(*) n from card_catalog").get()).toEqual({ n: 3 });
    expect(db.prepare("select count(*) n from card_artworks").get()).toEqual({ n: 3 });
    await catalog.resolveCardNames(names);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  const corrections = [
    ["Subterrror Behemoth Stygokraken", "Subterror Behemoth Stygokraken"],
    ["Artifact Moraltech", "Artifact Moralltach"],
    ["Ally of Justic Catastor", "Ally of Justice Catastor"],
    ["White Drragon Wyverburster", "White Dragon Wyverburster"],
  ];
  it.each([true, false])("corrects the four real typos (cached candidates: %s)", async (cached) => {
    const cards = corrections.map(([, name], i) => card(i + 1, name, i === 2 ? "synchro" : "effect"));
    const { catalog } = setup(cached ? cards : [], cached ? [] : cards);
    const result = await catalog.resolveCardNames(corrections.map(([from]) => from));
    expect(result.map((r) => r.corrected)).toEqual(corrections.map(([from, to]) => ({ from, to })));
    expect(result.map((r) => r.card?.ygoprodeckId)).toEqual([1, 2, 3, 4]);
  });

  it("finds punctuation differences remotely and preserves the full name", async () => {
    const { catalog } = setup([], [card(1, "Blue-Eyes White Dragon")]);
    const [resolved] = await catalog.resolveCardNames(["blue eyes white dragon"]);
    expect(resolved.card?.name).toBe("Blue-Eyes White Dragon");
    expect(resolved.corrected).toBeUndefined();
  });

  it("reports no result for weak, short, truncated or ambiguous matches", async () => {
    const { catalog } = setup([card(1, "Dark Magician"), card(2, "Dark Magician Girl"), card(3, "Artifact Moralltach"), card(4, "Artifact Moralltech"), card(5, "Gluey"), card(6, "Blue-Eyes White Dragon")]);
    const result = await catalog.resolveCardNames(["Dark", "Dark Magic", "Artifact Moralltich", "Glue", "Blu dragon", "Engines", "Flip.dek"]);
    expect(result.every((r) => !r.card && !r.corrected)).toBe(true);
  });

  it("ignores duplicate artwork names when deciding whether a match is unique", async () => {
    const { catalog } = setup([card(1, "White Dragon Wyverburster"), card(2, "White Dragon Wyverburster")]);
    expect((await catalog.resolveCardNames(["White Drragon Wyverburster"]))[0].corrected?.to).toBe("White Dragon Wyverburster");
  });

  it("propagates an upstream hard failure instead of silently reporting not found", async () => {
    const { catalog, fetch } = setup([card(1, "Dark Hole")]);
    fetch.mockImplementation(async () => Response.json({}, { status: 503, headers: { "Retry-After": "2" } }));
    await expect(catalog.resolveCardNames(["Dark Hole", "Missing"])).rejects.toMatchObject({ name: "CardFetchError", status: 503 });
  });
});

it("bounds exact batches and word probes together, without limiting cached matches", async () => {
  const { catalog, fetch } = setup([card(1, "Dark Hole")]);
  const lookupBudget = createCardLookupBudget();
  const names = Array.from({ length: 1000 }, (_, i) => `Unknownword${i} Missingword${i}`);
  const result = await catalog.resolveCardNames([...names, "Dark Hole"], { lookupBudget });
  expect(fetch).toHaveBeenCalledTimes(50);
  expect(lookupBudget.lookupLimited).toBe(true);
  expect(result.slice(0, 1000).every((r) => !r.card)).toBe(true);
  expect(result[1000].card?.ygoprodeckId).toBe(1);
}, 40000);
