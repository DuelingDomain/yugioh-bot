import type Database from "better-sqlite3";
import type { Card } from "../types/index.js";
import { foldCardText } from "../duels/card-query.js";
import { canonicalCardCode, type CardIdentityCatalog } from "../duels/pool.js";
import { loadArtworkIdentityCatalog, mainArtworkId, type CardArtwork } from "./card-artworks.js";
import { fetchCardResource, isCardFetchError } from "./card-fetch.js";

type CardSet = {
  set_name: string;
};

type ArtworkRow = {
  card_id: number;
  artwork_id: number;
  image_url: string;
  image_url_small: string;
  image_url_cropped: string | null;
  is_main: number;
  source: "api" | "engine";
};

function mergeCardSets(...groups: CardSet[][]): CardSet[] {
  return [...new Map(groups.flat().map((set) => [set.set_name, set])).values()];
}

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
    id?: number;
    image_url: string;
    image_url_small: string;
    image_url_cropped?: string;
  }>;
  card_sets?: CardSet[];
};

type FetchLike = (
  input: string | URL | globalThis.Request,
  init?: globalThis.RequestInit,
) => Promise<Pick<Response, "ok" | "json"> & Partial<Pick<Response, "status">>>;

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
    canonicalCardId: row.card_id ?? row.ygoprodeck_id,
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
    imageUrlCropped: row.image_url_cropped ?? undefined,
    cardSets: JSON.parse(row.card_sets_json),
    cachedAt: row.cached_at,
    archetype: row.archetype ?? undefined,
  };
}

export function createCardCatalogService(
  db: Database.Database,
  options: { fetch?: FetchLike; identityCatalog?: CardIdentityCatalog } = {},
) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  let identity = options.identityCatalog;
  const engineIdentity = () => identity ??= loadArtworkIdentityCatalog();
  const mainId = (card: YgoprodeckCard): number => {
    const proven = mainArtworkId(card, engineIdentity());
    if (proven !== undefined) return proven;
    const previous = new Set<number>();
    for (const id of [card.id, ...card.card_images.map((art) => art.id ?? card.id)]) {
      const art = artworkById.get(id) as ArtworkRow | undefined;
      if (art) previous.add(art.card_id);
    }
    return previous.size === 1 ? [...previous][0] : Math.min(card.id, ...card.card_images.map((art) => art.id ?? card.id));
  };

  const fetchCardsWith = (params: Record<string, string>, ) => {
    const url = new URL(YGOPRODECK_API_URL);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return fetchCardResource(url, fetchImpl, async (response) => {
      if (response.status === 400) return [];
      const payload = await response.json() as { data?: YgoprodeckCard[] };
      if (!Array.isArray(payload.data) || payload.data.some((card) =>
        !Number.isSafeInteger(card.id) || card.id <= 0 || typeof card.name !== "string" || typeof card.type !== "string"
        || typeof card.frameType !== "string" || !Array.isArray(card.card_images)
        || [card.atk, card.def, card.level].some((value) => value != null && !Number.isFinite(value))
        || [card.desc, card.attribute, card.archetype].some((value) => value != null && typeof value !== "string")
        || (card.card_sets != null && (!Array.isArray(card.card_sets) || card.card_sets.some((set) => typeof set.set_name !== "string")))
        || card.card_images.some((image) => typeof image.image_url !== "string" || typeof image.image_url_small !== "string"
          || (image.id != null && (!Number.isSafeInteger(image.id) || image.id <= 0))))) {
        throw new Error("Invalid card response");
      }
      return payload.data;
    }, [400]);
  };

  const fetchCards = (searchParam: "cardset" | "id" | "name" | "fname", value: string) =>
    fetchCardsWith({ [searchParam]: value });

  // Passcode responses can contain only the requested image. Exact-name
  // responses include the released alternatives; retain both sets of images.
  const enrichArtworkFamilies = async (cards: YgoprodeckCard[]): Promise<YgoprodeckCard[]> => {
    const enriched: YgoprodeckCard[] = [];
    for (const card of cards) {
      // Extra artwork discovery is optional. Keep the usable ID response if
      // the API is offline or rate limited; a later bulk sync can fill it.
      let named: YgoprodeckCard | undefined;
      try {
        named = (await fetchCardsWith({ name: card.name }))
          .find((candidate) => normalizeName(candidate.name) === normalizeName(card.name) && candidate.type === card.type);
      } catch {
        enriched.push(card);
        continue;
      }
      const images = new Map((named?.card_images ?? []).map((image) => [image.id ?? named!.id, image]));
      for (const image of card.card_images) {
        const artworkId = image.id ?? card.id;
        const previous = images.get(artworkId);
        images.set(artworkId, { ...previous, ...image, image_url_cropped: image.image_url_cropped ?? previous?.image_url_cropped });
      }
      enriched.push({ ...(named ?? card), card_images: [...images.values()],
        card_sets: mergeCardSets(card.card_sets ?? [], named?.card_sets ?? []) });
    }
    return enriched;
  };
  const fetchArtworkFamily = async (id: number) => {
    const cards = await fetchCardsWith({ id: String(id) });
    if (cards.length > 0) return enrichArtworkFamilies(cards);
    // Engine-only IDs can have images but no API ID result. Use their validated
    // original's printed name only after the ID endpoint reports no match.
    const engine = engineIdentity();
    if (canonicalCardCode(id, engine) !== id) return fetchCardsWith({ name: engine.get(id)!.name });
    return [];
  };

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

  const upsertArtwork = db.prepare(`insert into card_artworks
    (card_id, artwork_id, image_url, image_url_small, image_url_cropped, is_main) values (?, ?, ?, ?, ?, ?)
    on conflict(artwork_id) do update set card_id = excluded.card_id, image_url = excluded.image_url,
      image_url_small = excluded.image_url_small, image_url_cropped = excluded.image_url_cropped,
      is_main = excluded.is_main, source = 'api'`);
  const artworkById = db.prepare("select * from card_artworks where artwork_id = ?");
  const artworksByCard = db.prepare("select * from card_artworks where card_id = ? order by is_main desc, artwork_id");

  const upsertCards = db.transaction((cards: YgoprodeckCard[]) => {
    const cachedAt = new Date().toISOString();

    for (const card of cards) {
      if (card.card_images.length === 0) continue;
      const cardId = mainId(card);
      const images = new Map(card.card_images.map((image) => [image.id ?? card.id, image]));
      // A narrower response must not remove previously discovered artworks.
      const previousParents = new Set<number>([cardId]);
      for (const id of [card.id, ...images.keys()]) {
        const existing = artworkById.get(id) as { card_id: number } | undefined;
        if (existing) previousParents.add(existing.card_id);
      }
      const known = [...previousParents].flatMap((id) => artworksByCard.all(id)) as ArtworkRow[];
      for (const image of known) {
        if (image.source === "engine") continue;
        if (!images.has(image.artwork_id)) images.set(image.artwork_id, { id: image.artwork_id,
          image_url: image.image_url, image_url_small: image.image_url_small, image_url_cropped: image.image_url_cropped ?? undefined });
        else if (!images.get(image.artwork_id)?.image_url_cropped && image.image_url_cropped) {
          images.get(image.artwork_id)!.image_url_cropped = image.image_url_cropped;
        }
      }
      if (!images.has(cardId)) images.set(cardId, { id: cardId,
        image_url: `https://images.ygoprodeck.com/images/cards/${cardId}.jpg`,
        image_url_small: `https://images.ygoprodeck.com/images/cards_small/${cardId}.jpg`,
        image_url_cropped: `https://images.ygoprodeck.com/images/cards_cropped/${cardId}.jpg` });

      const oldSets = [...images.keys()].flatMap((id) => {
        const row = db.prepare("select card_sets_json from card_catalog where ygoprodeck_id = ?").get(id) as { card_sets_json: string } | undefined;
        return row ? JSON.parse(row.card_sets_json) as CardSet[] : [];
      });
      const cardSets = JSON.stringify(mergeCardSets(oldSets, card.card_sets ?? []));

      for (const [artworkId, image] of images) upsertCard.run(
        artworkId,
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
        cardSets,
        cachedAt,
        card.archetype ?? null,
      );
      // All foreign-key targets exist before artwork mappings are inserted.
      for (const parent of previousParents) db.prepare("update card_artworks set is_main = 0 where card_id = ?").run(parent);
      for (const [artworkId, image] of images) upsertArtwork.run(cardId, artworkId, image.image_url,
        image.image_url_small, image.image_url_cropped ?? null, Number(artworkId === cardId));
    }
  });

  const findByIds = (ids: number[]): CardCatalogCard[] => {
    if (ids.length === 0) {
      return [];
    }

    const lookupIds = [...new Set(ids.flatMap((id) => [id, canonicalId(id)]))];
    const rows = db
      .prepare(
        `
          select * from card_catalog
          where ygoprodeck_id in (${lookupIds.map(() => "?").join(", ")})
        `,
      )
      .all(...lookupIds);
    const cardsById = new Map(rows.map((row: any) => [row.ygoprodeck_id, mapCard(row)]));

    return ids.map((id): CardCatalogCard | undefined => {
      const resolved = canonicalId(id);
      const original = cardsById.get(resolved) ?? cardsById.get(id);
      if (!original) return undefined;
      const artwork = artworkById.get(id) as ArtworkRow | undefined;
      const specific = cardsById.get(id);
      return { ...original, ygoprodeckId: id, canonicalCardId: resolved,
        imageUrl: artwork?.image_url ?? specific?.imageUrl ?? `https://images.ygoprodeck.com/images/cards/${id}.jpg`,
        imageUrlSmall: artwork?.image_url_small ?? specific?.imageUrlSmall ?? `https://images.ygoprodeck.com/images/cards_small/${id}.jpg`,
        imageUrlCropped: artwork?.image_url_cropped ?? undefined };
    }).filter((card): card is CardCatalogCard => card !== undefined);
  };

  const canonicalId = (id: number): number => {
    const artwork = artworkById.get(id) as { card_id: number } | undefined;
    return artwork?.card_id ?? canonicalCardCode(id, engineIdentity());
  };

  const catalogRowById = db.prepare("select * from card_catalog where ygoprodeck_id = ?");
  const hasCatalogRow = (id: number): boolean => !!catalogRowById.get(id);
  const hasArtworks = (id: number): boolean => hasCatalogRow(id) && !!artworkById.get(canonicalId(id));

  // Persist explicitly requested engine artwork IDs before cubes/drafts write
  // foreign keys. Keep these out of the available-art list until API metadata
  // supplies their image record. The image route can still try their own URL.
  const ensureEngineArtwork = (id: number) => {
    if (artworkById.get(id)) return;
    const originalId = canonicalCardCode(id, engineIdentity());
    if (originalId === id) return;
    const row = catalogRowById.get(originalId) as any;
    if (!row) return;
    if (!artworkById.get(originalId)) {
      db.prepare(`insert into card_artworks (card_id,artwork_id,image_url,image_url_small,is_main,source)
        values (?, ?, ?, ?, 1, 'engine')`).run(originalId, originalId, row.image_url, row.image_url_small);
    }
    upsertCard.run(id, row.name, row.type, row.frame_type, row.effect_text, row.atk, row.def,
      row.attribute, row.level, `https://images.ygoprodeck.com/images/cards/${id}.jpg`,
      `https://images.ygoprodeck.com/images/cards_small/${id}.jpg`, row.card_sets_json, row.cached_at, row.archetype);
    db.prepare(`insert into card_artworks (card_id,artwork_id,image_url,image_url_small,image_url_cropped,is_main,source)
      values (?, ?, ?, ?, null, 0, 'engine')`).run(originalId, id,
        `https://images.ygoprodeck.com/images/cards/${id}.jpg`, `https://images.ygoprodeck.com/images/cards_small/${id}.jpg`);
  };
  const ensureLegacyEngineArtwork = (id: number) => {
    const original = canonicalCardCode(id, engineIdentity());
    if (!artworkById.get(original)) ensureEngineArtwork(id);
  };

  const listArtworks = (id: number): CardArtwork[] => {
    const rows = artworksByCard.all(canonicalId(id)) as ArtworkRow[];
    return rows.filter((row) => row.source === "api").map((row) => ({ cardId: row.card_id, artworkId: row.artwork_id, imageUrl: row.image_url,
      imageUrlSmall: row.image_url_small, imageUrlCropped: row.image_url_cropped ?? undefined, isMain: row.is_main === 1 }));
  };

  const cachedCards = (matches: (card: CardCatalogCard) => boolean) => {
    const rows = db.prepare("select ygoprodeck_id from card_catalog").all() as Array<{ ygoprodeck_id: number }>;
    const cards = findByIds(rows.map((row) => row.ygoprodeck_id)).filter(matches);
    const originals = new Map<number, CardCatalogCard>();
    for (const card of cards) {
      const id = card.canonicalCardId ?? card.ygoprodeckId;
      if (!originals.has(id) || card.ygoprodeckId === id) originals.set(id, card);
    }
    return [...originals.values()];
  };
  const useCache = async <T>(fetch: () => Promise<T>, cached: () => T, usable: (value: T) => boolean): Promise<T> => {
    try { return await fetch(); }
    catch (error) {
      if (!isCardFetchError(error)) throw error;
      const value = cached();
      if (!usable(value)) throw error;
      return value;
    }
  };

  return {
    async syncDraftPool(input: SyncDraftPoolInput) {
      const distinctCustomIds = [...new Set(input.customCardIds ?? [])];
      for (const id of distinctCustomIds) ensureLegacyEngineArtwork(id);
      const cachedIds: number[] = [];
      const load = async (fetch: () => Promise<YgoprodeckCard[]>, cached: () => CardCatalogCard[],
        usable = (cards: CardCatalogCard[]) => cards.length > 0) => {
        try { return await fetch(); }
        catch (error) {
          if (!isCardFetchError(error)) throw error;
          const cards = cached();
          if (!usable(cards)) throw error;
          cachedIds.push(...cards.map((card) => card.ygoprodeckId));
          return [];
        }
      };
      // Existing rows need no artwork fetch. Bulk set sync fills legacy artwork rows later.
      const jobs = [
        ...input.setNames.map((name) => load(() => fetchCards("cardset", name),
          () => cachedCards((card) => card.cardSets.some((set) => set.set_name === name)),
          (cards) => {
            const set = db.prepare("select card_count from card_sets where set_name = ?").get(name) as { card_count: number | null } | undefined;
            return set?.card_count != null && set.card_count > 0 && cards.length >= set.card_count;
          })),
        ...distinctCustomIds.filter((id) => !hasCatalogRow(id)).map((id) => load(() => fetchArtworkFamily(id), () => {
          ensureEngineArtwork(id);
          return findByIds([id]);
        })),
        ...input.includeNames.map((name) => load(() => fetchCards("name", name),
          () => cachedCards((card) => normalizeName(card.name) === normalizeName(name)))),
      ];
      // Retain successful responses even if another lookup fails. All promises have handlers.
      const results = await Promise.allSettled(jobs);
      const excludedNames = new Set(input.excludeNames.map(normalizeName));
      const seenIds = new Set<number>();
      const cardsToCache: YgoprodeckCard[] = [];

      for (const card of results.flatMap((result) => result.status === "fulfilled" ? result.value : [])) {
        if (excludedNames.has(normalizeName(card.name))) {
          continue;
        }

        // Cache Extra Deck artwork metadata too, but leave it out of the
        // automatic main pool returned to the draft.
        cardsToCache.push(card);
        if (!isExtraDeckCard(card)) seenIds.add(mainId(card));
      }

      upsertCards(cardsToCache);
      for (const id of distinctCustomIds) ensureEngineArtwork(id);

      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      const cached = findByIds(cachedIds).filter((card) => !isExtraDeckFrame(card) && !excludedNames.has(normalizeName(card.name)));
      return [...findByIds([...seenIds]), ...cached];
    },

    async syncByArchetype(
      archetype: string,
      opts: { banlist?: string } = {},
    ): Promise<{ main: CardCatalogCard[]; extra: CardCatalogCard[] }> {
      const params: Record<string, string> = { archetype };
      if (opts.banlist) {
        params.banlist = opts.banlist;
      }

      const cached = await useCache(async () => {
        const cards = await fetchCardsWith(params);
        upsertCards(cards);
        return findByIds([...new Set(cards.map(mainId))]);
      }, () => cachedCards((card) => normalizeName(card.archetype ?? "") === normalizeName(archetype)), (cards) => cards.length > 0);
      const extraIds = new Set(cached.filter(isExtraDeckFrame).map((card) => card.ygoprodeckId));

      return {
        main: cached.filter((card) => !extraIds.has(card.ygoprodeckId)),
        extra: cached.filter((card) => extraIds.has(card.ygoprodeckId)),
      };
    },

    async syncCardById(id: number): Promise<CardCatalogCard | undefined> {
      ensureLegacyEngineArtwork(id);
      if (hasCatalogRow(id)) {
        ensureEngineArtwork(id);
        return findByIds([id])[0];
      }
      let cards: YgoprodeckCard[];
      try { cards = await fetchArtworkFamily(id); }
      catch (error) {
        if (!isCardFetchError(error)) throw error;
        const cached = findByIds([id])[0];
        if (!cached) throw error;
        ensureEngineArtwork(id);
        return cached;
      }
      const [card] = cards;
      if (!card) {
        ensureEngineArtwork(id);
        return hasCatalogRow(id) ? findByIds([id])[0] : undefined;
      }
      // Keep Extra Deck cards — themes need them for the extra pool.
      upsertCards([card]);
      ensureEngineArtwork(id);
      return findByIds([id])[0] ?? findByIds([mainId(card)])[0];
    },

    async syncCardByName(name: string) {
      let cards: YgoprodeckCard[];
      try { cards = await fetchCards("name", name); }
      catch (error) {
        if (!isCardFetchError(error)) throw error;
        const cached = cachedCards((card) => normalizeName(card.name) === normalizeName(name) && !isExtraDeckFrame(card))[0];
        if (!cached) throw error;
        return cached;
      }
      const [card] = cards;
      if (!card || isExtraDeckCard(card)) {
        return undefined;
      }

      upsertCards([card]);
      return findByIds([mainId(card)])[0];
    },

    /**
     * Cards whose name matches typed text, best match first (see rankCardsByName). The card database only
     * matches the exact text and answers HTTP 400 for no match, so "blue eyes" would miss "Blue-Eyes":
     * when the text finds nothing, try up to two distinct words of at least three characters, longest unchanged words first,
     * and keep names that have every folded word. Never repeat the folded full text as a probe.
     * A full passcode finds that card. Extra Deck monsters are left out unless `includeExtra` is set.
     */
    async syncCardsByFuzzyName(name: string, options: { includeExtra?: boolean; limit?: number } = {}) {
      const text = name.trim();
      const phrase = foldCardText(text);
      const words = phrase.split(" ").filter(Boolean);
      if (words.length === 0) {
        return [];
      }

      // Only HTTP 400 means no match; other HTTP failures and lost connections must reach the caller.
      let cards: YgoprodeckCard[] = [];
      try {
        const lookup = (params: Record<string, string>) => fetchCardsWith(params);

        const numericId = /^\d{6,10}$/.test(text) ? Number(text) : undefined;
        const engine = numericId !== undefined ? engineIdentity() : undefined;
        const engineAlt = numericId !== undefined && engine !== undefined && canonicalCardCode(numericId, engine) !== numericId;
        cards = numericId !== undefined ? await lookup({ id: String(numericId) }) : [];
        if (cards.length > 0) cards = await enrichArtworkFamilies(cards);
        else if (engineAlt) cards = await lookup({ name: engine!.get(numericId!)!.name });
        if (cards.length === 0) {
          cards = await lookup({ fname: text });
        }
        if (cards.length === 0) {
          const unchangedWords = new Set(text.toLowerCase().split(/\s+/).filter((word) => foldCardText(word) === word));
          const probes = [...new Set(words)]
            .filter((word) => word.length >= 3 && word !== phrase)
            .sort((a, b) => Number(unchangedWords.has(b)) - Number(unchangedWords.has(a)) || b.length - a.length)
            .slice(0, 2);
          for (const probe of probes) {
            const probed = await lookup({ fname: probe });
            cards = probed.filter((card) => {
              const folded = foldCardText(card.name);
              return words.every((word) => folded.includes(word));
            });
            if (cards.length > 0) {
              break;
            }
          }
        }

      } catch (error) {
        if (!isCardFetchError(error)) throw error;
        const cached = /^\d{6,10}$/.test(text) ? findByIds([Number(text)])
          : cachedCards((card) => words.every((word) => foldCardText(card.name).includes(word)));
        const usable = options.includeExtra ? cached : cached.filter((card) => !isExtraDeckFrame(card));
        if (usable.length === 0) throw error;
        return rankCardsByName(usable, text).slice(0, options.limit ?? 24);
      }
      const usable = options.includeExtra ? cards : cards.filter((card) => !isExtraDeckCard(card));
      upsertCards(usable);
      const ranked = rankCardsByName(findByIds([...new Set(usable.map(mainId))]), text);
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
      let payload: YgoprodeckSetInfo[];
      try {
        payload = await fetchCardResource(YGOPRODECK_CARDSETS_URL, fetchImpl, async (response) => {
          const data = await response.json() as YgoprodeckSetInfo[];
          if (!Array.isArray(data) || data.some((set) => typeof set.set_name !== "string" || typeof set.set_code !== "string" || !Number.isFinite(set.num_of_cards))) throw new Error("Invalid sets");
          return data;
        });
      } catch (error) {
        if (!isCardFetchError(error)) throw error;
        const rows = db.prepare("select set_name from card_sets order by set_name").all() as Array<{ set_name: string }>;
        if (!rows.length) throw error;
        return rows.map((row) => row.set_name);
      }
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
        const payload = await fetchCardResource(YGOPRODECK_ARCHETYPES_URL, fetchImpl, async (response) => {
          const data = await response.json() as Array<{ archetype_name: string }>;
          if (!Array.isArray(data) || data.some((item) => typeof item.archetype_name !== "string")) throw new Error("Invalid archetypes");
          return data;
        });
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
    canonicalId,
    hasArtworks,
    hasCatalogRow,
    listArtworks,

    async getSetPreview(setName: string): Promise<{ name: string; cardCount: number; cached: boolean; sampleCards: CardCatalogCard[] }> {
      const setRow = db.prepare("select card_count from card_sets where set_name = ?").get(setName) as { card_count: number } | undefined;

      const sampleRows = db.prepare(`
        select * from card_catalog
        where ygoprodeck_id in (
          select cc.ygoprodeck_id
          from card_catalog cc, json_each(cc.card_sets_json) as je
          where je.value->>'set_name' = ?
            and (not exists (select 1 from card_artworks a where a.artwork_id = cc.ygoprodeck_id)
              or exists (select 1 from card_artworks a where a.artwork_id = cc.ygoprodeck_id and a.is_main = 1))
          limit 6
        )
      `).all(setName) as any[];

      if (sampleRows.length > 0 && setRow?.card_count) {
        return {
          name: setName,
          cardCount: setRow.card_count,
          cached: true,
          sampleCards: findByIds(sampleRows.map((row) => row.ygoprodeck_id)),
        };
      }

      let fetched: YgoprodeckCard[];
      try { fetched = await fetchCards("cardset", setName); }
      catch (error) {
        if (!isCardFetchError(error) || sampleRows.length === 0) throw error;
        return { name: setName, cardCount: setRow?.card_count ?? sampleRows.length, cached: true,
          sampleCards: findByIds(sampleRows.map((row) => row.ygoprodeck_id)) };
      }
      if (fetched.length === 0) {
        return { name: setName, cardCount: 0, cached: false, sampleCards: [] };
      }

      const nonExtraDeck = fetched.filter((c) => !isExtraDeckCard(c));
      const toCache = nonExtraDeck.length > 0 ? nonExtraDeck : fetched;
      upsertCards(toCache);

      const sample = findByIds([...new Set(toCache.map(mainId))].slice(0, 6));

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
