import type Database from "better-sqlite3";
import { fetchCardResource } from "@yugidraft/shared/services";
import type { CatalogSetStatus } from "@yugidraft/shared/types";
import type { CachedCardSet, GapCatalogCard } from "./card-data-gap.js";
const DAY = 86_400_000;

/** Dated, already released TCG sets in the last 12 calendar months (UTC). */
export function recentTcgSets(sets: readonly CatalogSetStatus[], now: number): CatalogSetStatus[] {
  const cutoff = new Date(now); cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  const from = cutoff.toISOString().slice(0, 10), through = new Date(now).toISOString().slice(0, 10);
  return sets.filter(set => set.releaseDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(set.releaseDate)
    && Number.isFinite(Date.parse(set.releaseDate)) && new Date(set.releaseDate).toISOString().slice(0, 10) === set.releaseDate
    && set.releaseDate >= from && set.releaseDate <= through)
    .sort((a, b) => b.releaseDate!.localeCompare(a.releaseDate!) || a.name.localeCompare(b.name));
}

function compactCards(value: unknown, setName: string): GapCatalogCard[] {
  if (!Array.isArray(value)) throw new Error("Invalid set card list");
  return value.map(raw => {
    if (!raw || typeof raw !== "object") throw new Error("Invalid set card");
    const card = raw as Record<string, unknown>;
    const frameType = card.frameType ?? card.frame_type;
    if (!Number.isSafeInteger(card.id) || Number(card.id) <= 0 || typeof card.name !== "string"
      || typeof card.type !== "string" || typeof frameType !== "string") throw new Error("Invalid set card identity");
    const printings = card.cardSets ?? card.card_sets ?? [];
    const images = card.artworkIds ?? (Array.isArray(card.card_images) ? card.card_images.map(image => image?.id ?? card.id) : []);
    if (!Array.isArray(printings) || printings.some(p => !p || typeof p.set_name !== "string" || (p.set_code != null && typeof p.set_code !== "string"))
      || !Array.isArray(images) || images.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error("Invalid set card families");
    return { id: card.id as number, name: card.name, type: card.type, frameType,
      cardSets: printings.filter(p => p.set_name === setName).map(p => ({ set_name: p.set_name, ...(p.set_code == null ? {} : { set_code: p.set_code }) })),
      artworkIds: [...new Set(images as number[])] };
  });
}

/** Per-set durable cache independent of card_catalog. Fetching shares the card/image request budget. */
export function createRecentCardSetCache(db: Database.Database, options: {
  fetch?: typeof globalThis.fetch; now?: () => number;
} = {}) {
  const fetch = options.fetch ?? globalThis.fetch, now = options.now ?? Date.now;
  const pending = new Map<string, Promise<void>>(), retryAt = new Map<string, number>();
  const invalid = new Set<string>();
  const shutdown = new AbortController();
  let stopped = false;
  const get = db.prepare("select fetched_at, cards_json from card_data_set_cache where set_name = ?");
  const getFetchedAt = db.prepare("select fetched_at from card_data_set_cache where set_name = ?");
  const save = db.prepare(`insert into card_data_set_cache (set_name,fetched_at,cards_json) values (?,?,?)
    on conflict(set_name) do update set fetched_at=excluded.fetched_at, cards_json=excluded.cards_json`);
  function cached(set: CatalogSetStatus): CachedCardSet {
    const row = get.get(set.name) as { fetched_at: string; cards_json: string } | undefined;
    if (row && Number.isFinite(Date.parse(row.fetched_at))) {
      try {
        const cards = compactCards(JSON.parse(row.cards_json), set.name);
        invalid.delete(set.name);
        return { ...set, cards, checkedAt: row.fetched_at };
      } catch { invalid.add(set.name); /* Repair invalid cache data on the next refresh. */ }
    }
    return { ...set, cards: null, checkedAt: null };
  }
  function refreshSet(set: CatalogSetStatus): Promise<void> {
    if (stopped) return Promise.resolve();
    const existing = pending.get(set.name);
    if (existing) return existing;
    const row = getFetchedAt.get(set.name) as { fetched_at: string } | undefined, clock = now();
    const interval = Date.parse(`${set.releaseDate}T00:00:00Z`) < clock - 60 * DAY ? 7 * DAY : DAY;
    if (row && !invalid.has(set.name) && Date.parse(row.fetched_at) > clock - interval) return Promise.resolve();
    if ((retryAt.get(set.name) ?? 0) > clock) return Promise.resolve();
    const work = (async () => {
      try {
        const url = new URL("https://db.ygoprodeck.com/api/v7/cardinfo.php"); url.searchParams.set("cardset", set.name);
        const cards = await fetchCardResource(url, (input, init) => {
          // A request can still be waiting for the shared budget at shutdown.
          shutdown.signal.throwIfAborted();
          return fetch(input, { ...init, signal: AbortSignal.any([shutdown.signal, init!.signal!]) });
        }, async response => {
          const payload = await response.json() as { data?: unknown; error?: unknown };
          return compactCards(payload.data == null && typeof payload.error === "string" ? [] : payload.data, set.name);
        }, [400]);
        if (!stopped) save.run(set.name, new Date(now()).toISOString(), JSON.stringify(cards));
        invalid.delete(set.name);
        retryAt.delete(set.name);
      } catch {
        // Keep the last successful set; a cold miss stays unknown. Shared queue
        // cooldowns also apply to subsequent card/image requests in this process.
        if (!stopped) retryAt.set(set.name, now() + 5 * 60_000);
      } finally { pending.delete(set.name); }
    })();
    pending.set(set.name, work);
    return work;
  }
  async function refresh(sets: readonly CatalogSetStatus[]): Promise<void> {
    for (const set of recentTcgSets(sets, now())) {
      if (stopped) break;
      await refreshSet(set);
    }
  }
  return {
    read(sets: readonly CatalogSetStatus[]): CachedCardSet[] {
      const rows = recentTcgSets(sets, now()).map(cached);
      void refresh(sets);
      return rows;
    },
    refresh,
    async close(): Promise<void> { stopped = true; shutdown.abort(); },
  };
}
