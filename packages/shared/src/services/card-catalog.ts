import type Database from "better-sqlite3";
import type { Card } from "../types/index.js";
import { foldCardText } from "../duels/card-query.js";

type CardSet = {
  set_name: string;
};

type YgoprodeckSetInfo = {
  set_name: string;
  set_code: string;
  num_of_cards: number;
};

type YgoprodeckCard = {
  id: number;
  name: string;
  type: string;
  frameType: string;
  desc?: string;
  atk?: number;
  def?: number;
  attribute?: string;
  level?: number;
  archetype?: string;
  card_images: Array<{
    image_url: string;
    image_url_small: string;
  }>;
  card_sets?: CardSet[];
};

type FetchLike = (
  input: string | URL | globalThis.Request,
  init?: globalThis.RequestInit,
) => Promise<Pick<Response, "ok" | "json">>;

export type CardCatalogCard = Card;

export type SyncDraftPoolInput = {
  setNames: string[];
  customCardIds?: number[];
  includeNames: string[];
  excludeNames: string[];
};

const YGOPRODECK_API_URL = "https://db.ygoprodeck.com/api/v7/cardinfo.php";
const YGOPRODECK_CARDSETS_URL = "https://db.ygoprodeck.com/api/v7/cardsets.php";
const YGOPRODECK_ARCHETYPES_URL = "https://db.ygoprodeck.com/api/v7/archetypes.php";
const EXTRA_DECK_FRAME_TYPES = new Set(["fusion", "synchro", "xyz", "link"]);

function normalizeName(name: string) {
  return name.trim().toLowerCase();
}

/**
 * Orders cards for a typed name: the exact name first, then names that start with it, then names that
 * contain it, then names that have every word in any order. Case, accents and punctuation do not matter,
 * so "blue eyes" matches "Blue-Eyes White Dragon". Shorter names come before longer ones in a tier.
 */
export function rankCardsByName<T extends { name: string }>(cards: readonly T[], query: string): T[] {
  const phrase = foldCardText(query);
  const words = phrase.split(" ").filter(Boolean);
  const tier = (name: string) => {
    if (name === phrase) return 0;
    if (name.startsWith(phrase)) return 1;
    if (name.includes(phrase)) return 2;
    if (words.every((word) => name.includes(word))) return 3;
    return 4;
  };
  return cards
    .map((card) => ({ card, name: foldCardText(card.name) }))
    .map((entry) => ({ ...entry, tier: tier(entry.name) }))
    .sort((a, b) => a.tier - b.tier || a.name.length - b.name.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((entry) => entry.card);
}

/**
 * Fusion, Synchro, Xyz and Link monsters live in the Extra Deck, Pendulum variants included
 * (frame `synchro_pendulum`, type "Synchro Pendulum Effect Monster"). Mirrors the web
 * `isExtraDeckMonster`.
 */
export function isExtraDeckFrame(card: { frameType: string; type: string }) {
  const frameType = card.frameType.trim().toLowerCase();
  if (EXTRA_DECK_FRAME_TYPES.has(frameType) || [...EXTRA_DECK_FRAME_TYPES].some((f) => frameType.startsWith(`${f}_`))) {
    return true;
  }
  const type = card.type.toLowerCase();
  return type.includes("monster") && /\b(fusion|synchro|xyz|link)\b/.test(type);
}

function isExtraDeckCard(card: YgoprodeckCard) {
  return isExtraDeckFrame(card);
}

function mapCard(row: any): CardCatalogCard {
  return {
    ygoprodeckId: row.ygoprodeck_id,
    name: row.name,
    type: row.type,
    frameType: row.frame_type,
    effectText: row.effect_text ?? "",
    atk: row.atk ?? undefined,
    def: row.def ?? undefined,
    attribute: row.attribute ?? undefined,
    level: row.level ?? undefined,
    imageUrl: row.image_url,
    imageUrlSmall: row.image_url_small,
    cardSets: JSON.parse(row.card_sets_json),
    cachedAt: row.cached_at,
    archetype: row.archetype ?? undefined,
  };
}

export function createCardCatalogService(
  db: Database.Database,
  options: { fetch?: FetchLike } = {},
) {
  const fetchImpl = options.fetch ?? globalThis.fetch;

  // Fail fast on an unreachable API instead of hanging the request for minutes.
  const REQUEST_TIMEOUT_MS = 12000;
  const withTimeout = (input: string | URL) => {
    const init = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
      ? { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
      : undefined;
    return fetchImpl(input, init);
  };

  const fetchCardsWith = async (params: Record<string, string>) => {
    const url = new URL(YGOPRODECK_API_URL);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    let response;
    try {
      response = await withTimeout(url);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not reach the card database (${reason}). Check connectivity and try again.`);
    }

    if (!response.ok) {
      throw new Error(`YGOPRODeck request failed for ${new URLSearchParams(params).toString()}`);
    }

    const payload = (await response.json()) as { data?: YgoprodeckCard[] };
    return payload.data ?? [];
  };

  const fetchCards = (searchParam: "cardset" | "id" | "name" | "fname", value: string) =>
    fetchCardsWith({ [searchParam]: value });

  const upsertCard = db.prepare(
    `
      insert into card_catalog (
        ygoprodeck_id,
        name,
        type,
        frame_type,
        effect_text,
        atk,
        def,
        attribute,
        level,
        image_url,
        image_url_small,
        card_sets_json,
        cached_at,
        archetype
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(ygoprodeck_id) do update set
        name = excluded.name,
        type = excluded.type,
        frame_type = excluded.frame_type,
        effect_text = excluded.effect_text,
        atk = excluded.atk,
        def = excluded.def,
        attribute = excluded.attribute,
        level = excluded.level,
        image_url = excluded.image_url,
        image_url_small = excluded.image_url_small,
        card_sets_json = excluded.card_sets_json,
        cached_at = excluded.cached_at,
        archetype = excluded.archetype
    `,
  );

  const upsertCards = db.transaction((cards: YgoprodeckCard[]) => {
    const cachedAt = new Date().toISOString();

    for (const card of cards) {
      const [image] = card.card_images;

      if (!image) {
        continue;
      }

      upsertCard.run(
        card.id,
        card.name,
        card.type,
        card.frameType,
        card.desc ?? "",
        card.atk ?? null,
        card.def ?? null,
        card.attribute ?? null,
        card.level ?? null,
        image.image_url,
        image.image_url_small,
        JSON.stringify(card.card_sets ?? []),
        cachedAt,
        card.archetype ?? null,
      );
    }
  });

  const findByIds = (ids: number[]): CardCatalogCard[] => {
    if (ids.length === 0) {
      return [];
    }

    const rows = db
      .prepare(
        `
          select * from card_catalog
          where ygoprodeck_id in (${ids.map(() => "?").join(", ")})
        `,
      )
      .all(...ids);
    const cardsById = new Map(rows.map((row: any) => [row.ygoprodeck_id, mapCard(row)]));

    return ids.map((id) => cardsById.get(id)).filter((card): card is CardCatalogCard => card !== undefined);
  };

  return {
    async syncDraftPool(input: SyncDraftPoolInput) {
      const fetchedSets = await Promise.all(input.setNames.map((setName) => fetchCards("cardset", setName)));
      // Only fetch custom passcodes missing from the catalog. A materialized
      // cube can carry hundreds of passcodes already synced via their sets;
      // re-fetching each one individually makes saves take many seconds.
      const distinctCustomIds = [...new Set(input.customCardIds ?? [])];
      const cachedCustomIds = new Set(findByIds(distinctCustomIds).map((card) => card.ygoprodeckId));
      const missingCustomIds = distinctCustomIds.filter((id) => !cachedCustomIds.has(id));
      const fetchedCustomCards = await Promise.all(
        missingCustomIds.map((cardId) => fetchCards("id", String(cardId))),
      );
      const fetchedIncludes = await Promise.all(
        input.includeNames.map((cardName) => fetchCards("name", cardName)),
      );
      const excludedNames = new Set(input.excludeNames.map(normalizeName));
      const seenIds = new Set<number>();
      const cardsToCache: YgoprodeckCard[] = [];

      for (const card of [...fetchedSets.flat(), ...fetchedCustomCards.flat(), ...fetchedIncludes.flat()]) {
        if (seenIds.has(card.id) || excludedNames.has(normalizeName(card.name)) || isExtraDeckCard(card)) {
          continue;
        }

        seenIds.add(card.id);
        cardsToCache.push(card);
      }

      upsertCards(cardsToCache);

      return findByIds(cardsToCache.map((card) => card.id));
    },

    async syncByArchetype(
      archetype: string,
      opts: { banlist?: string } = {},
    ): Promise<{ main: CardCatalogCard[]; extra: CardCatalogCard[] }> {
      const params: Record<string, string> = { archetype };
      if (opts.banlist) {
        params.banlist = opts.banlist;
      }

      const cards = await fetchCardsWith(params);
      upsertCards(cards);

      const cached = findByIds(cards.map((card) => card.id));
      const extraIds = new Set(cards.filter(isExtraDeckCard).map((card) => card.id));

      return {
        main: cached.filter((card) => !extraIds.has(card.ygoprodeckId)),
        extra: cached.filter((card) => extraIds.has(card.ygoprodeckId)),
      };
    },

    async syncCardById(id: number): Promise<CardCatalogCard | undefined> {
      const [card] = await fetchCards("id", String(id));
      if (!card) {
        return undefined;
      }
      // Keep Extra Deck cards — themes need them for the extra pool.
      upsertCards([card]);
      return findByIds([card.id])[0];
    },

    async syncCardByName(name: string) {
      const [card] = await fetchCards("name", name);
      if (!card || isExtraDeckCard(card)) {
        return undefined;
      }

      upsertCards([card]);
      return findByIds([card.id])[0];
    },

    /**
     * Cards whose name matches typed text, best match first (see rankCardsByName). The card database only
     * matches the exact text and answers HTTP 400 for no match, so "blue eyes" would miss "Blue-Eyes":
     * when the text finds nothing, its longest word is looked up and the names that have every word are kept.
     * A full passcode finds that card. Extra Deck monsters are left out unless `includeExtra` is set.
     */
    async syncCardsByFuzzyName(name: string, options: { includeExtra?: boolean; limit?: number } = {}) {
      const text = name.trim();
      const words = foldCardText(text).split(" ").filter(Boolean);
      if (words.length === 0) {
        return [];
      }

      // A lost connection is a real failure; a 400 means the database knows no such card.
      const lookup = async (params: Record<string, string>) => {
        try {
          return await fetchCardsWith(params);
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("YGOPRODeck request failed")) {
            return [];
          }
          throw error;
        }
      };

      let cards: YgoprodeckCard[] = /^\d{6,10}$/.test(text) ? await lookup({ id: String(Number(text)) }) : [];
      if (cards.length === 0) {
        cards = await lookup({ fname: text });
      }
      if (cards.length === 0) {
        const probe = [...words].sort((a, b) => b.length - a.length)[0]!;
        if (probe !== text.toLowerCase()) {
          const probed = await lookup({ fname: probe });
          cards = probed.filter((card) => {
            const folded = foldCardText(card.name);
            return words.every((word) => folded.includes(word));
          });
        }
      }

      const usable = options.includeExtra ? cards : cards.filter((card) => !isExtraDeckCard(card));
      upsertCards(usable);
      const ranked = rankCardsByName(findByIds(usable.map((card) => card.id)), text);
      return ranked.slice(0, options.limit ?? 24);
    },

    listSets(query?: string): Array<{ setName: string; setCode: string; cardCount: number }> {
      const hasQuery = query && query.trim().length > 0;

      const sql = hasQuery
        ? `select set_name, set_code, card_count from card_sets where lower(set_name) like lower(?) order by set_name limit 25`
        : `select set_name, set_code, card_count from card_sets order by set_name limit 25`;

      const rows = hasQuery ? db.prepare(sql).all(`%${query.trim()}%`) : db.prepare(sql).all();

      return (rows as Array<{ set_name: string; set_code: string; card_count: number }>).map((row) => ({
        setName: row.set_name,
        setCode: row.set_code ?? "",
        cardCount: row.card_count ?? 0,
      }));
    },

    async syncSets(): Promise<string[]> {
      const response = await fetchImpl(YGOPRODECK_CARDSETS_URL);

      if (!response.ok) {
        throw new Error("YGOPRODeck cardsets request failed");
      }

      const payload = (await response.json()) as YgoprodeckSetInfo[];
      const syncedAt = new Date().toISOString();

      const insert = db.prepare(
        `insert or replace into card_sets (set_name, set_code, card_count, synced_at) values (?, ?, ?, ?)`
      );

      db.transaction(() => {
        for (const set of payload) {
          insert.run(set.set_name, set.set_code, set.num_of_cards, syncedAt);
        }
      })();

      return payload.map((s) => s.set_name);
    },

    async listArchetypes(query?: string): Promise<string[]> {
      const cachedCount = (
        db.prepare("select count(*) as n from archetypes").get() as { n: number }
      ).n;

      if (cachedCount === 0) {
        const response = await withTimeout(YGOPRODECK_ARCHETYPES_URL);
        if (!response.ok) {
          throw new Error("YGOPRODeck archetypes request failed");
        }
        const payload = (await response.json()) as Array<{ archetype_name: string }>;
        const syncedAt = new Date().toISOString();
        const insert = db.prepare(
          "insert or replace into archetypes (name, synced_at) values (?, ?)",
        );
        db.transaction(() => {
          for (const { archetype_name } of payload) {
            insert.run(archetype_name, syncedAt);
          }
        })();
      }

      const hasQuery = query && query.trim().length > 0;
      const rows = hasQuery
        ? db
            .prepare("select name from archetypes where lower(name) like lower(?) order by name")
            .all(`%${query.trim()}%`)
        : db.prepare("select name from archetypes order by name").all();

      return (rows as Array<{ name: string }>).map((row) => row.name);
    },

    findByIds,

    async getSetPreview(setName: string): Promise<{ name: string; cardCount: number; cached: boolean; sampleCards: CardCatalogCard[] }> {
      const setRow = db.prepare("select card_count from card_sets where set_name = ?").get(setName) as { card_count: number } | undefined;

      const sampleRows = db.prepare(`
        select * from card_catalog
        where ygoprodeck_id in (
          select cc.ygoprodeck_id
          from card_catalog cc, json_each(cc.card_sets_json) as je
          where je.value->>'set_name' = ?
          limit 6
        )
      `).all(setName) as any[];

      if (sampleRows.length > 0 && setRow?.card_count) {
        return {
          name: setName,
          cardCount: setRow.card_count,
          cached: true,
          sampleCards: sampleRows.map(mapCard),
        };
      }

      const fetched = await fetchCards("cardset", setName);
      if (fetched.length === 0) {
        return { name: setName, cardCount: 0, cached: false, sampleCards: [] };
      }

      const nonExtraDeck = fetched.filter((c) => !isExtraDeckCard(c));
      const toCache = nonExtraDeck.length > 0 ? nonExtraDeck : fetched;
      upsertCards(toCache);

      const sample = toCache.slice(0, 6).map((c) => {
        const [image] = c.card_images;
        return {
          ygoprodeckId: c.id,
          name: c.name,
          type: c.type,
          frameType: c.frameType,
          effectText: c.desc ?? "",
          atk: c.atk,
          def: c.def,
          attribute: c.attribute,
          level: c.level,
          imageUrl: image?.image_url ?? "",
          imageUrlSmall: image?.image_url_small ?? "",
          cardSets: (c.card_sets ?? []).map((cs: any) => cs.set_name ?? cs),
          cachedAt: new Date().toISOString(),
        } as CardCatalogCard;
      });

      return {
        name: setName,
        cardCount: fetched.length,
        cached: false,
        sampleCards: sample,
      };
    },
  };
}

export type CardCatalogService = ReturnType<typeof createCardCatalogService>;
