import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createCardCatalogService as initialCreate, isExtraDeckFrame, rankCardsByName } from "../../src/services/card-catalog.js";

let createCardCatalogService = initialCreate;
beforeEach(async () => {
  vi.resetModules();
  createCardCatalogService = (await import("../../src/services/card-catalog.js")).createCardCatalogService;
});

type YgoprodeckCard = {
  id: number;
  name: string;
  type: string;
  frameType: string;
  card_images: Array<{
    image_url: string;
    image_url_small: string;
  }>;
  card_sets?: Array<{
    set_name: string;
  }>;
};

function setup(
  cardsBySet: Record<string, YgoprodeckCard[]> = {},
  cardsByName: Record<string, YgoprodeckCard[]> = {},
  cardsById: Record<string, YgoprodeckCard[]> = {},
  cardsByFuzzyName: Record<string, YgoprodeckCard[]> = {},
) {
  const db = new Database(":memory:");
  migrate(db);

  const fetchCalls: string[] = [];
  const catalog = createCardCatalogService(db, {
    fetch: async (input) => {
      const url = new URL(String(input));
      fetchCalls.push(url.toString());

      const setName = url.searchParams.get("cardset");
      const cardName = url.searchParams.get("name");
      const fuzzyName = url.searchParams.get("fname");
      const cardId = url.searchParams.get("id");
      const data = setName
        ? cardsBySet[setName] ?? []
        : cardName
          ? cardsByName[cardName] ?? []
          : fuzzyName
            ? cardsByFuzzyName[fuzzyName] ?? []
            : cardId
              ? cardsById[cardId] ?? []
              : [];

      return {
        ok: true,
        async json() {
          return { data };
        },
      };
    },
  });

  return { catalog, db, fetchCalls };
}

describe("shared card catalog service", () => {
  it("syncs selected sets plus explicit includes while filtering excluded and Extra Deck cards", async () => {
    const summonedSkull = {
      id: 70781052,
      name: "Summoned Skull",
      type: "Fiend / Normal Monster",
      frameType: "normal",
      card_images: [{ image_url: "https://img/full/summoned-skull", image_url_small: "https://img/small/summoned-skull" }],
      card_sets: [{ set_name: "Metal Raiders" }],
    } satisfies YgoprodeckCard;
    const timeWizard = {
      id: 71625222,
      name: "Time Wizard",
      type: "Spellcaster / Effect Monster",
      frameType: "effect",
      card_images: [{ image_url: "https://img/full/time-wizard", image_url_small: "https://img/small/time-wizard" }],
      card_sets: [{ set_name: "Metal Raiders" }],
    } satisfies YgoprodeckCard;
    const thousandDragon = {
      id: 11829830,
      name: "Thousand Dragon",
      type: "Dragon / Fusion Monster",
      frameType: "fusion",
      card_images: [{ image_url: "https://img/full/thousand-dragon", image_url_small: "https://img/small/thousand-dragon" }],
      card_sets: [{ set_name: "Metal Raiders" }],
    } satisfies YgoprodeckCard;
    const raigeki = {
      id: 12580477,
      name: "Raigeki",
      type: "Spell Card",
      frameType: "spell",
      card_images: [{ image_url: "https://img/full/raigeki", image_url_small: "https://img/small/raigeki" }],
      card_sets: [{ set_name: "Legend of Blue Eyes White Dragon" }],
    } satisfies YgoprodeckCard;

    const app = setup(
      {
        "Metal Raiders": [summonedSkull, timeWizard, thousandDragon],
      },
      {
        Raigeki: [raigeki],
      },
    );

    const pool = await app.catalog.syncDraftPool({
      setNames: ["Metal Raiders"],
      includeNames: ["Raigeki"],
      excludeNames: ["Time Wizard"],
    });

    expect(app.fetchCalls).toEqual([
      "https://db.ygoprodeck.com/api/v7/cardinfo.php?cardset=Metal+Raiders",
      "https://db.ygoprodeck.com/api/v7/cardinfo.php?name=Raigeki",
    ]);
    expect(pool.map((card) => card.ygoprodeckId)).toEqual([summonedSkull.id, raigeki.id]);
    expect(app.catalog.findByIds([raigeki.id, summonedSkull.id, timeWizard.id, thousandDragon.id])).toEqual([
      expect.objectContaining({
        ygoprodeckId: raigeki.id,
        name: "Raigeki",
      }),
      expect.objectContaining({
        ygoprodeckId: summonedSkull.id,
        name: "Summoned Skull",
      }),
      expect.objectContaining({ ygoprodeckId: thousandDragon.id, name: "Thousand Dragon" }),
    ]);
    expect(app.catalog.hasArtworks(thousandDragon.id)).toBe(true);
    expect(app.db.prepare("select count(*) as count from card_catalog").get()).toEqual({ count: 3 });
  });

  it("syncs custom card ids into the local catalog", async () => {
    const summonedSkull = {
      id: 70781052,
      name: "Summoned Skull",
      type: "Fiend / Normal Monster",
      frameType: "normal",
      card_images: [{ image_url: "https://img/full/summoned-skull", image_url_small: "https://img/small/summoned-skull" }],
      card_sets: [{ set_name: "Metal Raiders" }],
    } satisfies YgoprodeckCard;
    const app = setup({}, {}, { "70781052": [summonedSkull] });

    await app.catalog.syncDraftPool({
      setNames: [],
      customCardIds: [70781052],
      includeNames: [],
      excludeNames: [],
    });

    expect(app.fetchCalls).toEqual(["https://db.ygoprodeck.com/api/v7/cardinfo.php?id=70781052", "https://db.ygoprodeck.com/api/v7/cardinfo.php?name=Summoned+Skull"]);
    expect(app.catalog.findByIds([70781052])).toEqual([
      expect.objectContaining({
        ygoprodeckId: 70781052,
        name: "Summoned Skull",
      }),
    ]);
  });

  it("skips re-fetching custom card ids already in the catalog", async () => {
    const summonedSkull = {
      id: 70781052,
      name: "Summoned Skull",
      type: "Fiend / Normal Monster",
      frameType: "normal",
      card_images: [{ image_url: "https://img/full/summoned-skull", image_url_small: "https://img/small/summoned-skull" }],
      card_sets: [{ set_name: "Metal Raiders" }],
    } satisfies YgoprodeckCard;
    const app = setup({}, {}, { "70781052": [summonedSkull] });

    // First sync fetches and caches the card.
    await app.catalog.syncDraftPool({ setNames: [], customCardIds: [70781052], includeNames: [], excludeNames: [] });
    // Second sync (and duplicate ids in the same call) must not hit the network again.
    await app.catalog.syncDraftPool({ setNames: [], customCardIds: [70781052, 70781052], includeNames: [], excludeNames: [] });

    expect(app.fetchCalls).toEqual(["https://db.ygoprodeck.com/api/v7/cardinfo.php?id=70781052", "https://db.ygoprodeck.com/api/v7/cardinfo.php?name=Summoned+Skull"]);
  });

  it("syncs one card by exact name into the local catalog", async () => {
    const monsterReborn = {
      id: 83764718,
      name: "Monster Reborn",
      type: "Spell Card",
      frameType: "spell",
      card_images: [{ image_url: "https://img/full/monster-reborn", image_url_small: "https://img/small/monster-reborn" }],
      card_sets: [{ set_name: "Legend of Blue Eyes White Dragon" }],
    } satisfies YgoprodeckCard;
    const app = setup({}, { "Monster Reborn": [monsterReborn] });

    const card = await app.catalog.syncCardByName("Monster Reborn");

    expect(app.fetchCalls).toEqual(["https://db.ygoprodeck.com/api/v7/cardinfo.php?name=Monster+Reborn"]);
    expect(card).toEqual(expect.objectContaining({ ygoprodeckId: 83764718, name: "Monster Reborn" }));
    expect(app.catalog.findByIds([83764718])).toEqual([
      expect.objectContaining({ ygoprodeckId: 83764718, name: "Monster Reborn" }),
    ]);
  });

  it("returns undefined when exact-name sync finds no cards", async () => {
    const app = setup({}, { "Missing Card": [] });

    await expect(app.catalog.syncCardByName("Missing Card")).resolves.toBeUndefined();

    expect(app.fetchCalls).toEqual(["https://db.ygoprodeck.com/api/v7/cardinfo.php?name=Missing+Card"]);
    expect(app.db.prepare("select count(*) as count from card_catalog").get()).toEqual({ count: 0 });
  });

  it("syncs multiple cards by fuzzy name into the local catalog", async () => {
    const blueEyesWhiteDragon = {
      id: 89631139,
      name: "Blue-Eyes White Dragon",
      type: "Dragon / Normal Monster",
      frameType: "normal",
      card_images: [{ image_url: "https://img/full/bewd", image_url_small: "https://img/small/bewd" }],
      card_sets: [{ set_name: "Legend of Blue Eyes White Dragon" }],
    } satisfies YgoprodeckCard;
    const blueEyesUltimateDragon = {
      id: 23995346,
      name: "Blue-Eyes Ultimate Dragon",
      type: "Dragon / Fusion Monster",
      frameType: "fusion",
      card_images: [{ image_url: "https://img/full/beud", image_url_small: "https://img/small/beud" }],
      card_sets: [{ set_name: "Legend of Blue Eyes White Dragon" }],
    } satisfies YgoprodeckCard;
    const app = setup({}, {}, {}, { "blue-eyes": [blueEyesWhiteDragon, blueEyesUltimateDragon] });

    const result = await app.catalog.syncCardsByFuzzyName("blue-eyes");

    expect(app.fetchCalls).toEqual(["https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=blue-eyes"]);
    expect(result.map((c) => c.name)).toEqual(["Blue-Eyes White Dragon"]);
    expect(app.catalog.findByIds([89631139, 23995346, 46986414]).map((c) => c.name)).toEqual(["Blue-Eyes White Dragon"]);
  });
});

describe("card name search", () => {
  const monster = (id: number, name: string, frameType = "normal"): YgoprodeckCard => ({
    id,
    name,
    type: frameType === "normal" ? "Normal Monster" : "Fusion Monster",
    frameType,
    card_images: [{ image_url: `https://img/full/${id}`, image_url_small: `https://img/small/${id}` }],
  });

  /** The card database: it matches the text as written inside a name and answers HTTP 400 when nothing matches. */
  function cardDatabase(cards: YgoprodeckCard[], failure?: { status: number; fname?: string }) {
    const db = new Database(":memory:");
    migrate(db);
    const calls: string[] = [];
    const catalog = createCardCatalogService(db, {
      fetch: async (input) => {
        const url = new URL(String(input));
        calls.push(url.search);
        const fname = url.searchParams.get("fname")?.toLowerCase();
        const id = url.searchParams.get("id");
        if (failure && (failure.fname === undefined || failure.fname === fname)) {
          return { ok: false, status: failure.status, async json() { return {}; } } as Response;
        }
        const data = cards.filter((card) => (fname ? card.name.toLowerCase().includes(fname) : String(card.id) === id));
        return { ok: data.length > 0, status: data.length > 0 ? 200 : 400, async json() {
          return data.length > 0 ? { data } : {
            error: "No card matching your query was found in the database. Please see https://db.ygoprodeck.com/api-guide/ for syntax usage.",
          };
        } } as Response;
      },
    });
    return { catalog, calls };
  }

  const pool = [
    monster(1, "Dark Magician Girl"),
    monster(2, "Skilled Dark Magician"),
    monster(3, "Dark Magician"),
    monster(4, "Dark Magician of Chaos"),
    monster(89631139, "Blue-Eyes White Dragon"),
    monster(23995346, "Blue-Eyes Ultimate Dragon", "fusion"),
    monster(5, "Sage with Eyes of Blue"),
  ];

  it("puts the exact name first, then names that start with the text, then names that contain it", async () => {
    const { catalog } = cardDatabase(pool);

    const names = (await catalog.syncCardsByFuzzyName("dark magician")).map((card) => card.name);

    expect(names).toEqual(["Dark Magician", "Dark Magician Girl", "Dark Magician of Chaos", "Skilled Dark Magician"]);
  });

  it("finds a card from a lowercase partial with no hyphen", async () => {
    const { catalog, calls } = cardDatabase(pool);

    const names = (await catalog.syncCardsByFuzzyName("blue eyes")).map((card) => card.name);

    // The closest match is first; a name with both words in another order still shows below it.
    expect(names).toEqual(["Blue-Eyes White Dragon", "Sage with Eyes of Blue"]);
    expect(calls).toEqual(["?fname=blue+eyes", "?fname=blue"]);
  });

  const harpies = [
    monster(6, "Flight of the Harpies"),
    monster(7, "Harpies' Hunting Ground"),
    monster(8, "Harpie's Feather Duster"),
  ];

  it("tries the next word when the first probe finds no cards with all the words", async () => {
    const { catalog, calls } = cardDatabase(harpies);

    expect((await catalog.syncCardsByFuzzyName("harpies feather duster")).map((card) => card.name)).toEqual([
      "Harpie's Feather Duster",
    ]);
    expect(calls).toEqual(["?fname=harpies+feather+duster", "?fname=harpies", "?fname=feather"]);
  });

  it.each(["harpie's", "harpie’s", "harpies!"])("prefers an unchanged probe word for %s", async (word) => {
    const { catalog, calls } = cardDatabase(harpies);

    expect((await catalog.syncCardsByFuzzyName(`${word} duster feather`)).map((card) => card.name)).toEqual([
      "Harpie's Feather Duster",
    ]);
    expect(calls.map((call) => new URLSearchParams(call).get("fname"))).toEqual([
      `${word} duster feather`, "feather",
    ]);
  });

  it("prefers a shorter unchanged word to a longer word with punctuation", async () => {
    const { catalog, calls } = cardDatabase([monster(9, "Blue-Eyes Dragon")]);

    expect((await catalog.syncCardsByFuzzyName("dragon! blue")).map((card) => card.name)).toEqual(["Blue-Eyes Dragon"]);
    expect(calls).toEqual(["?fname=dragon%21+blue", "?fname=blue"]);
  });

  it("tries the next word when a probe gets HTTP 400", async () => {
    const { catalog, calls } = cardDatabase([monster(10, "Harpie's Feather")]);

    expect((await catalog.syncCardsByFuzzyName("harpies feather")).map((card) => card.name)).toEqual([
      "Harpie's Feather",
    ]);
    expect(calls).toEqual(["?fname=harpies+feather", "?fname=harpies", "?fname=feather"]);
  });

  it("does not probe words shorter than three characters for magican of b", async () => {
    const { catalog, calls } = cardDatabase(pool);

    await expect(catalog.syncCardsByFuzzyName("magican of b")).resolves.toEqual([]);
    expect(calls).toEqual(["?fname=magican+of+b", "?fname=magican"]);
  });

  it("does not repeat a fallback probe for repeated query words", async () => {
    const { catalog, calls } = cardDatabase(harpies);

    expect((await catalog.syncCardsByFuzzyName("harpies harpies feather duster")).map((card) => card.name)).toEqual([
      "Harpie's Feather Duster",
    ]);
    expect(calls).toEqual(["?fname=harpies+harpies+feather+duster", "?fname=harpies", "?fname=feather"]);
  });

  it("sends at most two distinct fallback probes", async () => {
    const { catalog, calls } = cardDatabase([monster(11, "Duster Feather Harpie's")]);

    await expect(catalog.syncCardsByFuzzyName("harpies harpies nonexistent feather duster")).resolves.toEqual([]);
    expect(calls).toEqual([
      "?fname=harpies+harpies+nonexistent+feather+duster", "?fname=nonexistent", "?fname=harpies",
    ]);
  });

  it("does not repeat a probe that folds to the full text", async () => {
    const { catalog, calls } = cardDatabase(pool);

    await expect(catalog.syncCardsByFuzzyName("gaia's")).resolves.toEqual([]);
    expect(calls).toEqual(["?fname=gaia%27s"]);
  });

  it.each([429, 500])("throws for HTTP %s without sending a fallback probe", async (status) => {
    const { catalog, calls } = cardDatabase(pool, { status });

    await expect(catalog.syncCardsByFuzzyName("blue eyes")).rejects.toThrow(/Could not reach the card database/);
    expect(calls).toEqual(["?fname=blue+eyes"]);
  });

  it("rejects a failed response without a status instead of treating it as no match", async () => {
    const db = new Database(":memory:");
    migrate(db);
    let calls = 0;
    const catalog = createCardCatalogService(db, {
      fetch: async () => {
        calls++;
        return { ok: false, async json() { throw new Error("Failed responses must not be parsed"); } };
      },
    });

    try {
      await expect(catalog.syncCardsByFuzzyName("blue eyes")).rejects.toThrow(
        "Could not reach the card database. Try again shortly.",
      );
      expect(calls).toBe(1);
    } finally {
      db.close();
    }
  });

  it.each([429, 500])("stops when a fallback probe gets HTTP %s", async (status) => {
    const { catalog, calls } = cardDatabase(harpies, { status, fname: "harpies" });

    await expect(catalog.syncCardsByFuzzyName("harpies feather duster")).rejects.toThrow(/Could not reach the card database/);
    expect(calls).toEqual(["?fname=harpies+feather+duster", "?fname=harpies"]);
  });

  it("finds a card when the words are typed in pieces, in any case and in any order", async () => {
    const { catalog } = cardDatabase(pool);

    expect((await catalog.syncCardsByFuzzyName("  BLUE EYES white ")).map((card) => card.name)).toEqual(["Blue-Eyes White Dragon"]);
    expect((await catalog.syncCardsByFuzzyName("eyes blue")).map((card) => card.name)).toEqual([
      "Blue-Eyes White Dragon",
      "Sage with Eyes of Blue",
    ]);
  });

  it("returns no cards, not an error, when the card database finds nothing", async () => {
    const { catalog } = cardDatabase(pool);

    await expect(catalog.syncCardsByFuzzyName("no such card")).resolves.toEqual([]);
    await expect(catalog.syncCardsByFuzzyName("   ")).resolves.toEqual([]);
  });

  it.each([
    "No card matching your query",
    "No card matching your query was found in the database. Please see https://db.ygoprodeck.com/api-guide/v8/ for syntax usage.",
  ])("accepts a no-result 400 when the message tail changes: %s", async (error) => {
    const db = new Database(":memory:"); migrate(db);
    const catalog = createCardCatalogService(db, { identityCatalog: new Map(),
      fetch: async () => Response.json({ error }, { status: 400 }) });
    try {
      await expect(catalog.syncCardById(1)).resolves.toBeUndefined();
    } finally { db.close(); }
  });

  it.each([
    { error: "Invalid cardset. Please use a valid set name." },
    { error: 400 },
    { error: null },
    { data: [] },
    {},
  ])("rejects a 400 that is not the no-result response: %j", async (body) => {
    const db = new Database(":memory:"); migrate(db);
    const catalog = createCardCatalogService(db, { identityCatalog: new Map(),
      fetch: async () => new Response(JSON.stringify(body), { status: 400 }) });
    try {
      await expect(catalog.syncCardByName("Dark Magician")).rejects.toMatchObject({ name: "CardFetchError", status: 400 });
    } finally { db.close(); }
  });

  it.each([
    "No card matching your query",
    "No card matching your query was found in the database. Please see https://db.ygoprodeck.com/api-guide/ for syntax usage.",
    "No card matching your query was found in the database. Please see https://db.ygoprodeck.com/api-guide/v8/ for syntax usage.",
  ])("reports an invalid set even when the API uses its no-result 400 body: %s", async (error) => {
    const db = new Database(":memory:"); migrate(db);
    const catalog = createCardCatalogService(db, { identityCatalog: new Map(),
      fetch: async () => Response.json({ error }, { status: 400 }) });
    try {
      await expect(catalog.syncDraftPool({ setNames: ["Pendulum Domination Structure Decc"],
        includeNames: [], excludeNames: [] })).rejects.toThrow(/Try again/);
    } finally { db.close(); }
  });

  it("keeps Extra Deck monsters out unless the caller asks for them", async () => {
    const { catalog } = cardDatabase(pool);

    expect((await catalog.syncCardsByFuzzyName("blue-eyes")).map((card) => card.name)).toEqual(["Blue-Eyes White Dragon"]);
    expect((await catalog.syncCardsByFuzzyName("blue-eyes", { includeExtra: true })).map((card) => card.name)).toEqual([
      "Blue-Eyes White Dragon",
      "Blue-Eyes Ultimate Dragon",
    ]);
  });

  it("finds one card from its full passcode", async () => {
    const { catalog } = cardDatabase(pool);

    expect((await catalog.syncCardsByFuzzyName("89631139")).map((card) => card.name)).toEqual(["Blue-Eyes White Dragon"]);
  });

  it("still fails when the card database cannot be reached", async () => {
    const db = new Database(":memory:");
    migrate(db);
    const catalog = createCardCatalogService(db, {
      fetch: async () => {
        throw new Error("fetch failed");
      },
    });

    await expect(catalog.syncCardsByFuzzyName("blue eyes")).rejects.toThrow(/Could not reach the card database/);
  });

  it("ranks by folded text: case, accents and punctuation do not matter", () => {
    const ranked = rankCardsByName(
      [{ name: "Sky Striker Ace - Raye" }, { name: "Raye" }, { name: "Ace of Raye Striker" }, { name: "Striker Raye Plus" }],
      "RAYE",
    );

    expect(ranked.map((card) => card.name)).toEqual(["Raye", "Striker Raye Plus", "Ace of Raye Striker", "Sky Striker Ace - Raye"]);
  });
});

describe("isExtraDeckFrame", () => {
  it.each([
    ["fusion", "Fusion Monster"],
    ["synchro", "Synchro Monster"],
    ["xyz", "XYZ Monster"],
    ["link", "Link Monster"],
    ["fusion_pendulum", "Pendulum Effect Fusion Monster"],
    ["synchro_pendulum", "Synchro Pendulum Effect Monster"],
    ["xyz_pendulum", "XYZ Pendulum Effect Monster"],
    ["", "XYZ Pendulum Effect Monster"],
    ["synchro_pendulum", ""],
  ])("counts frame %s / type %s as Extra Deck", (frameType, type) => {
    expect(isExtraDeckFrame({ frameType, type })).toBe(true);
  });

  it.each([
    ["effect", "Effect Monster"],
    ["normal", "Normal Monster"],
    ["effect_pendulum", "Pendulum Effect Monster"],
    ["ritual", "Ritual Effect Monster"],
    ["spell", "Spell Card"],
    ["trap", "Trap Card"],
    ["token", "Token"],
  ])("keeps frame %s / type %s in the Main Deck", (frameType, type) => {
    expect(isExtraDeckFrame({ frameType, type })).toBe(false);
  });
});
