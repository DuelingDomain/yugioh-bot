import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createCardCatalogService } from "../../src/services/card-catalog.js";
import { canonicalCardCode, type CardIdentityCatalog } from "../../src/duels/pool.js";
import { createDraftService } from "../../src/services/drafts.js";
import { createCubeService } from "../../src/services/cubes.js";
import { loadArtworkIdentityCatalog } from "../../src/services/card-artworks.js";

interface FixtureCard {
  id: number; name: string; type: string; frameType: string; desc: string; atk: number; def: number;
  attribute: string; level: number;
  card_images: Array<{ id: number; image_url: string; image_url_small: string; image_url_cropped: string }>;
  card_sets: Array<{ set_name: string }>;
}
const fixtures = JSON.parse(readFileSync(new URL("../fixtures/card-artworks.json", import.meta.url), "utf8")) as FixtureCard[];
const originals = [81480460, 89631139, 46986414];
const identity: CardIdentityCatalog = new Map(fixtures.flatMap((card, index) =>
  card.card_images.filter((art) => art.id !== 81480461).map((art) => [art.id, {
    name: card.name, type: index === 0 ? 33 : 17, alias: art.id === originals[index] ? 0 : originals[index],
  }] as const),
));
const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function setup() {
  const db = new Database(":memory:"); databases.push(db); migrate(db);
  const calls: URL[] = [];
  const catalog = createCardCatalogService(db, {
    identityCatalog: identity,
    fetch: async (input) => {
      const url = new URL(String(input)); calls.push(url);
      const id = Number(url.searchParams.get("id"));
      let cards = fixtures;
      if (url.searchParams.has("name")) cards = fixtures.filter((c) => c.name === url.searchParams.get("name"));
      if (url.searchParams.has("id")) cards = fixtures.filter((c) => c.card_images.some((a) => a.id === id))
        .map((c) => ({ ...c, id, card_images: c.card_images.filter((a) => a.id === id) }));
      return { ok: true, json: async () => ({ data: cards }) };
    },
  });
  return { db, catalog, calls };
}

describe("card artwork mapping", () => {
  it.each(fixtures.map((c, i) => ({ name: c.name, fixture: c, main: originals[i] })))(
    "stores every $name artwork and returns the original for name sync", async ({ name, fixture, main }) => {
      const { db, catalog } = setup();
      const card = await catalog.syncCardByName(name);
      expect(card?.ygoprodeckId).toBe(main);
      expect(card?.imageUrl).toBe(fixture.card_images.find((a) => a.id === main)!.image_url);
      const artworks = catalog.listArtworks(fixture.id);
      expect(artworks[0]).toMatchObject({ cardId: main, artworkId: main, isMain: true });
      expect(artworks.map((a) => a.artworkId).sort()).toEqual(fixture.card_images.map((a) => a.id).sort());
      for (const art of fixture.card_images) {
        expect(catalog.findByIds([art.id])[0]).toMatchObject({ ygoprodeckId: art.id, canonicalCardId: main,
          name, effectText: fixture.desc, atk: fixture.atk, imageUrl: art.image_url, imageUrlCropped: art.image_url_cropped });
        expect(catalog.canonicalId(art.id)).toBe(main);
        if (identity.has(art.id)) expect(catalog.canonicalId(art.id)).toBe(canonicalCardCode(art.id, identity));
      }
      expect((db.prepare("select count(*) as n from card_catalog").get() as { n: number }).n).toBe(fixture.card_images.length);
    },
  );

  it("enriches the single-image ID response and retains the requested artwork", async () => {
    const { catalog, calls } = setup();
    const card = await catalog.syncCardById(81480461);
    expect(card?.ygoprodeckId).toBe(81480461);
    expect(catalog.listArtworks(81480460)).toHaveLength(2);
    expect(calls.map((c) => c.search)).toEqual(["?id=81480461", "?name=Barrel+Dragon"]);
    await catalog.syncDraftPool({ setNames: [], customCardIds: [81480460, 81480461], includeNames: [], excludeNames: [] });
    expect(calls).toHaveLength(2);
  });

  it("uses legacy custom rows until a normal set sync fills their artworks", async () => {
    const { db, catalog, calls } = setup();
    db.prepare("insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (81480461,'Barrel Dragon','Effect Monster','effect','old','old','[]','old')").run();
    await catalog.syncDraftPool({ setNames: [], customCardIds: [81480461], includeNames: [], excludeNames: [] });
    expect(calls).toHaveLength(0);
    expect(catalog.findByIds([81480461])).toHaveLength(1);
    await catalog.syncDraftPool({ setNames: ["Artwork Test Set"], includeNames: [], excludeNames: [] });
    expect(calls).toHaveLength(1);
    expect(catalog.listArtworks(81480460)).toHaveLength(2);
  });

  it("enriches a numeric card search with all artworks", async () => {
    const { catalog } = setup();
    expect((await catalog.syncCardsByFuzzyName("81480461"))[0].ygoprodeckId).toBe(81480460);
    expect(catalog.listArtworks(81480460)).toHaveLength(2);
  });

  it("searches an engine-only alternate by its validated card name", async () => {
    const { db } = setup();
    const catalog = createCardCatalogService(db, { identityCatalog: new Map([...identity,
      [89631147, { name: "Blue-Eyes White Dragon", type: 17, alias: 89631139 }],
    ]), fetch: async (input) => {
      const named = new URL(String(input)).searchParams.get("name") === "Blue-Eyes White Dragon";
      return { ok: named, status: named ? 200 : 400, json: async () => named ? { data: [fixtures[1]] } : {
        error: "No card matching your query was found in the database. Please see https://db.ygoprodeck.com/api-guide/ for syntax usage.",
      } };
    } });
    expect((await catalog.syncCardsByFuzzyName("89631147"))[0]?.ygoprodeckId).toBe(89631139);
  });

  it("uses only main artworks for automatic pools and set previews", async () => {
    const { db, catalog } = setup();
    const result = await catalog.syncDraftPool({ setNames: ["Artwork Test Set"], includeNames: [], excludeNames: [] });
    expect(result.map((c) => c.ygoprodeckId)).toEqual(originals);
    const drafts = createDraftService(db);
    expect(drafts.resolvePoolCardIds({ setNames: ["Artwork Test Set"] })).toEqual([...originals].sort((a,b) => a-b));
    expect(drafts.resolvePoolCardIds({ customCardIds: [81480461] })).toEqual([81480461]);
    expect((await catalog.getSetPreview("Artwork Test Set")).sampleCards.map((c) => c.ygoprodeckId)).toEqual(originals);
  });

  it("does not treat a different-name or different-type engine alias as alternate art", () => {
    const { db } = setup();
    const catalog = createCardCatalogService(db, { identityCatalog: new Map([
      [9000000, { name: "Original", type: 17, alias: 0 }],
      [9000001, { name: "Different", type: 17, alias: 9000000 }],
      [9000002, { name: "Original", type: 33, alias: 9000000 }],
    ]) });
    expect(catalog.canonicalId(9000001)).toBe(9000001);
    expect(catalog.canonicalId(9000002)).toBe(9000002);
    expect(catalog.canonicalId(99999999)).toBe(99999999);
  });

  it("resolves and imports an engine artwork absent from API metadata", async () => {
    const { db } = setup();
    const catalog = createCardCatalogService(db, { identityCatalog: new Map([...identity,
      [89631147, { name: "Blue-Eyes White Dragon", type: 17, alias: 89631139 }],
    ]), fetch: async () => ({ ok: true, json: async () => ({ data: [fixtures[1]] }) }) });
    await catalog.syncCardByName("Blue-Eyes White Dragon");
    expect(catalog.findByIds([89631147])[0]).toMatchObject({ canonicalCardId: 89631139, atk: 3000,
      imageUrl: "https://images.ygoprodeck.com/images/cards/89631147.jpg" });
    expect(catalog.listArtworks(89631147)).toHaveLength(8);
    expect(catalog.hasArtworks(89631147)).toBe(false);
    const cubes = createCubeService(db, catalog);
    const cube = cubes.createBlank("g", "Engine Art", "u");
    expect(await cubes.importPasscodes(cube.id, [89631147])).toEqual({ added: 1, unknown: [] });
    expect(catalog.hasArtworks(89631147)).toBe(true);
    expect(createDraftService(db).resolvePoolCardIds({ customCardIds: [89631147] })).toEqual([89631147]);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(catalog.listArtworks(89631147)).toHaveLength(8);
    const withoutEngine = createCardCatalogService(db, { identityCatalog: new Map() });
    expect(withoutEngine.canonicalId(89631147)).toBe(89631139);
  });

  it("keeps a proven main when a later sync cannot read engine identity", async () => {
    const { db, catalog } = setup();
    await catalog.syncCardByName("Blue-Eyes White Dragon");
    const withoutEngine = createCardCatalogService(db, { identityCatalog: new Map(),
      fetch: async () => ({ ok: true, json: async () => ({ data: [fixtures[1]] }) }) });
    expect((await withoutEngine.syncCardByName("Blue-Eyes White Dragon"))?.ygoprodeckId).toBe(89631139);
    expect(withoutEngine.listArtworks(89631146)[0].artworkId).toBe(89631139);
  });

  it("moves a fallback family to its proven main without losing known crops", async () => {
    const { db } = setup();
    const mutableIdentity = new Map();
    let response = fixtures[2];
    const catalog = createCardCatalogService(db, { identityCatalog: mutableIdentity,
      fetch: async () => ({ ok: true, json: async () => ({ data: [response] }) }) });
    await catalog.syncCardByName(response.name);
    expect(catalog.canonicalId(46986414)).toBe(response.id);
    mutableIdentity.set(46986414, { name: response.name, type: 17, alias: 0 });
    response = { ...response, id: 46986414, card_images: [response.card_images[1]] };
    await catalog.syncCardByName(response.name);
    expect(catalog.listArtworks(46986414)).toHaveLength(9);
    expect(catalog.listArtworks(46986421)[0]).toMatchObject({ artworkId: 46986414, isMain: true });
    expect(catalog.listArtworks(46986421).find((art) => art.artworkId === 46986421)?.imageUrlCropped).toContain("46986421.jpg");
  });

  it.each([fixtures[0], fixtures[2]])("prefers the API main artwork for $name when engine identity is missing", async (card) => {
    const { db } = setup();
    const catalog = createCardCatalogService(db, { identityCatalog: new Map(),
      fetch: async () => ({ ok: true, json: async () => ({ data: [card] }) }) });
    expect((await catalog.syncCardByName(card.name))?.ygoprodeckId).toBe(card.id);
    expect(catalog.listArtworks(card.id)[0]).toMatchObject({ artworkId: card.id, isMain: true });
  });

  it("uses the lowest passcode only when there is no engine, cached main or API main artwork", async () => {
    const { db } = setup();
    const card = { ...fixtures[2], id: 99999999 };
    const catalog = createCardCatalogService(db, { identityCatalog: new Map(),
      fetch: async () => ({ ok: true, json: async () => ({ data: [card] }) }) });
    expect((await catalog.syncCardByName(card.name))?.ygoprodeckId).toBe(36996508);
  });

  it("keeps an existing main when a narrower response calls an alternate the API main", async () => {
    const { db, catalog } = setup();
    await catalog.syncCardByName("Dark Magician");
    const art = fixtures[2].card_images.find((image) => image.id === 36996508)!;
    const card = { ...fixtures[2], id: art.id, card_images: [art] };
    const withoutEngine = createCardCatalogService(db, { identityCatalog: new Map(),
      fetch: async () => ({ ok: true, json: async () => ({ data: [card] }) }) });
    expect((await withoutEngine.syncCardByName(card.name))?.ygoprodeckId).toBe(46986414);
    expect(withoutEngine.listArtworks(art.id)[0]).toMatchObject({ artworkId: 46986414, isMain: true });
  });

  it("does not guess over conflicting existing main rows without engine identity", async () => {
    const { db, catalog } = setup();
    await catalog.syncCardByName("Dark Magician");
    db.exec("update card_artworks set card_id = 36996508, is_main = 1 where artwork_id = 36996508");
    const before = db.prepare("select * from card_artworks order by artwork_id").all();
    const withoutEngine = createCardCatalogService(db, { identityCatalog: new Map(),
      fetch: async () => ({ ok: true, json: async () => ({ data: [fixtures[2]] }) }) });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(withoutEngine.syncCardByName("Dark Magician")).resolves.toBeUndefined();
      await expect(withoutEngine.syncCardByName("Dark Magician")).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("conflicting artwork mains");
    } finally { warn.mockRestore(); }
    expect(db.prepare("select * from card_artworks order by artwork_id").all()).toEqual(before);
  });

  it.each(["draft", "archetype", "search", "preview"])("saves other cards in a %s sync when legacy artwork mains conflict", async (path) => {
    const { db, catalog } = setup();
    await catalog.syncCardByName("Dark Magician");
    db.exec("update card_artworks set card_id = 36996508, is_main = 1 where artwork_id = 36996508");
    const before = db.prepare("select * from card_artworks order by artwork_id").all();
    const withoutEngine = createCardCatalogService(db, { identityCatalog: new Map(),
      fetch: async () => ({ ok: true, json: async () => ({ data: [fixtures[0], fixtures[2], fixtures[1]] }) }) });
    if (path === "draft") {
      expect((await withoutEngine.syncDraftPool({ setNames: ["Artwork Test Set"], includeNames: [], excludeNames: [] }))
        .map((card) => card.name)).toEqual([fixtures[0].name, fixtures[1].name]);
    } else if (path === "archetype") {
      expect((await withoutEngine.syncByArchetype("Test")).main.map((card) => card.name)).toEqual([fixtures[0].name, fixtures[1].name]);
    } else if (path === "search") {
      expect((await withoutEngine.syncCardsByFuzzyName("dragon")).map((card) => card.name).sort())
        .toEqual([fixtures[0].name, fixtures[1].name].sort());
    } else {
      expect((await withoutEngine.getSetPreview("Artwork Test Set")).sampleCards.map((card) => card.name))
        .toEqual([fixtures[0].name, fixtures[1].name]);
    }
    expect(withoutEngine.listArtworks(fixtures[0].id)).toHaveLength(fixtures[0].card_images.length);
    expect(withoutEngine.listArtworks(fixtures[1].id)).toHaveLength(fixtures[1].card_images.length);
    expect(db.prepare("select * from card_artworks where card_id in (46986414,36996508) order by artwork_id").all()).toEqual(before);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    // Engine evidence can still repair the skipped family on a later sync.
    await catalog.syncCardByName("Dark Magician");
    expect(catalog.canonicalId(36996508)).toBe(46986414);
  });

  it("uses main card data even if a legacy alternate row has stale stats", async () => {
    const { db, catalog } = setup();
    await catalog.syncCardByName("Blue-Eyes White Dragon");
    db.prepare("update card_catalog set atk=1, effect_text='stale' where ygoprodeck_id=89631146").run();
    expect(catalog.findByIds([89631146])[0]).toMatchObject({ atk: 3000, effectText: fixtures[1].desc });
  });

  it("keeps main printing sets when exact-name enrichment returns alternate printing sets", async () => {
    const { db } = setup();
    const catalog = createCardCatalogService(db, { identityCatalog: identity, fetch: async (input) => {
      const byId = new URL(String(input)).searchParams.has("id");
      return { ok: true, json: async () => ({ data: [{ ...fixtures[0],
        card_sets: [{ set_name: byId ? "Main Printing" : "Alternate Printing" }] }] }) };
    } });
    await catalog.syncCardById(81480460);
    expect(catalog.findByIds([81480460])[0].cardSets.map((s) => s.set_name).sort())
      .toEqual(["Alternate Printing", "Main Printing"]);
  });

  it("keeps a supported engine alternate's ID-specific printing and crop", async () => {
    const { db } = setup();
    const catalog = createCardCatalogService(db, { identityCatalog: identity, fetch: async (input) => {
      const byId = new URL(String(input)).searchParams.has("id");
      const art = fixtures[1].card_images.find((image) => image.id === 89631140)!;
      const card = byId ? { ...fixtures[1], id: 89631140, card_images: [{ ...art, image_url_cropped: "https://example.com/id-crop.jpg" }],
        card_sets: [{ set_name: "ID Printing" }] } : fixtures[1];
      return { ok: true, json: async () => ({ data: [card] }) };
    } });
    expect((await catalog.syncCardById(89631140))?.imageUrlCropped).toBe("https://example.com/id-crop.jpg");
    expect(catalog.findByIds([89631140])[0].cardSets.map((s) => s.set_name)).toContain("ID Printing");
  });

  it("keeps the name-response crop when an ID response omits it", async () => {
    const { db } = setup();
    const catalog = createCardCatalogService(db, { identityCatalog: identity, fetch: async (input) => {
      const byId = new URL(String(input)).searchParams.has("id");
      const art = fixtures[0].card_images[1];
      return { ok: true, json: async () => ({ data: [byId ? { ...fixtures[0], id: 81480460,
        card_images: [{ id: art.id, image_url: art.image_url, image_url_small: art.image_url_small }] } : fixtures[0]] }) };
    } });
    expect((await catalog.syncCardById(81480460))?.imageUrlCropped).toBe(fixtures[0].card_images[1].image_url_cropped);
  });

  it("fetches a supported alternate's metadata even when its main is already cached", async () => {
    const { db } = setup();
    const main = { ...fixtures[1], id: 89631139, card_images: fixtures[1].card_images.filter((a) => a.id === 89631139) };
    const alt = { ...fixtures[1], id: 89631140, card_images: fixtures[1].card_images.filter((a) => a.id === 89631140)
      .map((a) => ({ ...a, image_url_cropped: "https://example.com/cached-family-crop.jpg" })) };
    const catalog = createCardCatalogService(db, { identityCatalog: identity, fetch: async (input) => ({
      ok: true, json: async () => ({ data: [new URL(String(input)).searchParams.has("id") ? alt : main] }),
    }) });
    await catalog.syncCardByName("Blue-Eyes White Dragon");
    expect((await catalog.syncCardById(89631140))?.imageUrlCropped).toBe("https://example.com/cached-family-crop.jpg");
    expect(catalog.listArtworks(89631139)).toHaveLength(2);
  });
});

describe("artwork fetch limits", () => {
  it("materializes a proven engine alternate from a legacy original without a fetch", async () => {
    const { db } = setup();
    db.exec("insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (89631139,'Blue-Eyes White Dragon','Normal Monster','normal','full','small','[]','old')");
    const fetch = vi.fn(async () => { throw new Error("offline"); });
    const catalog = createCardCatalogService(db, { identityCatalog: identity, fetch });
    await expect(catalog.syncDraftPool({ setNames: [], customCardIds: [89631140], includeNames: [], excludeNames: [] })).resolves.toBeDefined();
    expect(catalog.hasCatalogRow(89631140)).toBe(true);
    const cubes = createCubeService(db, catalog);
    const cube = cubes.createBlank("g", "Cached engine art", "u");
    await expect(cubes.importPasscodes(cube.id, [89631140])).resolves.toEqual({ added: 1, unknown: [] });
    expect(fetch).not.toHaveBeenCalled();
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
  it("uses 100 legacy cube rows without calls or requests in flight, even when the API returns 429", async () => {
    const { db } = setup();
    const ids = Array.from({ length: 100 }, (_, i) => 10000000 + i);
    const insert = db.prepare(`insert into card_catalog
      (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
      values (?,'Legacy','Effect Monster','effect','full','small','[]','old')`);
    for (const id of ids) insert.run(id);
    let calls = 0, inFlight = 0, maxInFlight = 0;
    const catalog = createCardCatalogService(db, { identityCatalog: new Map(), fetch: async () => {
      calls++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve(); inFlight--;
      return { ok: false, status: 429, json: async () => ({}) };
    } });
    await expect(catalog.syncDraftPool({ setNames: [], customCardIds: ids, includeNames: [], excludeNames: [] })).resolves.toBeDefined();
    const cubes = createCubeService(db, catalog);
    const cube = cubes.createBlank("g", "Legacy 100", "u");
    await expect(cubes.importPasscodes(cube.id, ids)).resolves.toEqual({ added: 100, unknown: [] });
    expect(catalog.findByIds(ids)).toHaveLength(100);
    expect(calls).toBe(0);
    expect(maxInFlight).toBe(0);
    expect(db.prepare("select count(*) as n from card_artworks").get()).toEqual({ n: 0 });
  });

  it("caches Extra Deck artworks while keeping them out of the draft pool", async () => {
    const { db } = setup();
    const card = { ...fixtures[0], id: 44508094, name: "Stardust Dragon", type: "Synchro Monster", frameType: "synchro",
      card_images: [{ ...fixtures[0].card_images[0], id: 44508094 }] };
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: [card] }) }));
    const catalog = createCardCatalogService(db, { identityCatalog: new Map(), fetch });
    for (let i = 0; i < 3; i++) {
      expect(await catalog.syncDraftPool({ setNames: [], customCardIds: [card.id], includeNames: [], excludeNames: [] })).toEqual([]);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(catalog.hasArtworks(card.id)).toBe(true);
  });

  it("keeps an ID response when its optional artwork name fetch fails", async () => {
    const { db } = setup();
    const catalog = createCardCatalogService(db, { identityCatalog: identity, fetch: async (input) => {
      const byId = new URL(String(input)).searchParams.has("id");
      return { ok: byId, status: byId ? 200 : 429, json: async () => ({ data: [fixtures[0]] }) };
    } });
    await expect(catalog.syncDraftPool({ setNames: [], customCardIds: [81480461], includeNames: [], excludeNames: [] })).resolves.toHaveLength(1);
    expect(catalog.hasArtworks(81480461)).toBe(true);
  });

  it("shares a four-request limit and spaces starts across catalog services", async () => {
    vi.resetModules();
    const { createCardCatalogService: create } = await import("../../src/services/card-catalog.js");
    const { db } = setup();
    vi.useFakeTimers();
    const starts: number[] = [];
    let inFlight = 0, maxInFlight = 0;
    const fetch = async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const id = Number(url.searchParams.get("id") ?? url.searchParams.get("name"));
      starts.push(Date.now()); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      return { ok: true, json: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        inFlight--;
        return { data: [{ ...fixtures[0], id, name: String(id), card_images: [{ ...fixtures[0].card_images[0], id }] }] };
      } };
    };
    const catalogs = [create(db, { identityCatalog: new Map(), fetch }), create(db, { identityCatalog: new Map(), fetch })];
    try {
      const jobs = Array.from({ length: 10 }, (_, i) => catalogs[i % 2].syncCardById(10000000 + i));
      await vi.runAllTimersAsync();
      await Promise.all(jobs);
      expect(starts).toHaveLength(20);
      expect(maxInFlight).toBeLessThanOrEqual(4);
      for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(200);
      for (const start of starts) expect(starts.filter((time) => time >= start && time < start + 1000).length).toBeLessThanOrEqual(5);
    } finally { vi.useRealTimers(); }
  });
});

it.each(["absolute", "relative", "default"])("resolves the %s engine path from cwd and filters legacy alternate options", (mode) => {
  const dir = mkdtempSync(join(tmpdir(), "card-art-engine-"));
  const engineDir = join(dir, "data/duel-engine");
  mkdirSync(engineDir, { recursive: true });
  const engine = new Database(join(engineDir, "cards.cdb"));
  engine.exec(`create table datas (id integer primary key, alias integer, type integer);
    create table texts (id integer primary key, name text);
    insert into datas values (89631139,0,17),(89631146,89631139,17);
    insert into texts values (89631139,'Blue-Eyes White Dragon'),(89631146,'Blue-Eyes White Dragon');`);
  engine.close();
  vi.stubEnv("DUEL_DATA_DIR", mode === "absolute" ? engineDir : mode === "relative" ? relative(dir, engineDir) : undefined);
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
  try {
    expect(canonicalCardCode(89631146, loadArtworkIdentityCatalog())).toBe(89631139);
    const { db } = setup();
    const insert = db.prepare("insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (?,'Blue-Eyes White Dragon','Normal Monster','normal','full','small','[]','old')");
    insert.run(89631139); insert.run(89631146);
    const drafts = createDraftService(db);
    expect(drafts.resolvePoolCardIds({})).toEqual([89631139]);
    expect(drafts.resolvePoolCardIds({ customCardIds: [89631146] })).toEqual([89631146]);
    db.prepare("delete from card_catalog where ygoprodeck_id = 89631139").run();
    migrate(db);
    expect(drafts.resolvePoolCardIds({})).toEqual([89631139]);
    expect(catalogMainImage(db, 89631139)).toBe("https://images.ygoprodeck.com/images/cards/89631139.jpg");
  } finally { cwd.mockRestore(); vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); }
});

it("warns only once when the engine identity database is missing", async () => {
  vi.resetModules();
  const { loadArtworkIdentityCatalog: load } = await import("../../src/services/card-artworks.js");
  vi.stubEnv("DUEL_DATA_DIR", join(tmpdir(), "missing-artwork-engine"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(load().size).toBe(0);
    expect(load().size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("artwork");
  } finally { warn.mockRestore(); vi.unstubAllEnvs(); }
});

function catalogMainImage(db: Database.Database, id: number) {
  return (db.prepare("select image_url from card_catalog where ygoprodeck_id = ?").get(id) as { image_url: string } | undefined)?.image_url;
}

describe("artwork migration", () => {
  it("keeps old rows and foreign keys and is safe to run again", () => {
    const { db } = setup();
    db.exec("drop table card_artworks");
    db.prepare("insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (81480461,'Barrel Dragon','Effect Monster','effect','old','old','[]','old')").run();
    db.prepare("insert into cubes (guild_id,name,created_by_user_id) values ('g','Legacy','u')").run();
    db.prepare("insert into cube_cards (cube_id,catalog_card_id,pool) values (1,81480461,'main')").run();
    migrate(db); migrate(db);
    expect(db.prepare("select count(*) as n from card_catalog").get()).toEqual({ n: 1 });
    expect(db.prepare("select count(*) as n from card_artworks").get()).toEqual({ n: 0 });
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.prepare("select catalog_card_id from cube_cards").get()).toEqual({ catalog_card_id: 81480461 });
    expect(() => db.prepare("insert into card_artworks (card_id,artwork_id,image_url,image_url_small,image_url_cropped,is_main) values (123, 124, 'full','small',null,1)").run()).toThrow(/FOREIGN KEY/);
  });
});
