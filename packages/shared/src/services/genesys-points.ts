import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { canonicalCardCode, type CardIdentityCatalog } from "../duels/pool.js";
import type { GenesysPointsList } from "../duels/genesys.js";
import { CardDataError } from "./card-fetch.js";

export const GENESYS_POINTS_SOURCE_URL = "https://db.ygoprodeck.com/api/v7/cardinfo.php?format=genesys&misc=yes";
export const GENESYS_LIST_EFFECTIVE_DATE = "2026-10-05";
// SHA-256 of Konami's 750 [name, nonzero points] pairs, sorted by name.
const VERIFIED_POINTS_HASH = "e2f9c29e9589771fd6f613c4b9d617ce86529f1d5aed548e97c7ed19d490977b";
const BASELINE_CARD_COUNT = 14_615;
const VERIFIED_CARD_COUNT_RATIO = 0.995;
/** Read-only official-table checks must decode a bounded smaller dump before its revision is known. */
export const GENESYS_VERIFIED_MINIMUM_CARDS = Math.ceil(BASELINE_CARD_COUNT * VERIFIED_CARD_COUNT_RATIO);
const OFFICIAL_NAMES: Record<string, string> = {
  "Stellarnova Bonds": "Stellarnova Binding",
  "Exstellarknight Constellar Ptolemy Ω7": "Exstellarknight Constellar Ptolemy O7",
};

export interface GenesysPointsCard {
  id: number;
  name: string;
  points: number;
  artworkIds: number[];
}

export interface GenesysPointsResponse {
  cards: GenesysPointsCard[];
  revision: string;
}

export interface GenesysPointsSnapshot extends GenesysPointsResponse {
  effectiveDate: string;
}

export interface GenesysSnapshotOptions {
  effectiveDate?: string;
  expectedRevision?: string;
  minimumCards?: number;
  previousList?: Pick<GenesysPointsList, "revision" | "effectiveDate"> | null;
}

export function genesysOfficialCardName(name: string): string { return Object.hasOwn(OFFICIAL_NAMES, name) ? OFFICIAL_NAMES[name] : name; }

function invalid(reason: string): never {
  const error = new CardDataError();
  error.message = `Invalid Genesys points snapshot: ${reason}. Previous points were preserved.`;
  throw error;
}

/** Only an unpaginated TCG dump with misc data can establish known zeroes. */
export function parseGenesysPointsResponse(payload: unknown, minimumCards = BASELINE_CARD_COUNT): GenesysPointsResponse {
  const value = payload as { data?: unknown; meta?: { next_page?: unknown; total_rows?: number; pages_remaining?: number } } | null;
  if (!Array.isArray(value?.data) || value.data.length < minimumCards) invalid("incomplete card list");
  if (value.meta?.next_page || (value.meta?.pages_remaining ?? 0) > 0
    || (value.meta?.total_rows ?? 0) > value.data.length) invalid("paginated response");
  const ids = new Set<number>();
  const cards: GenesysPointsCard[] = value.data.map((raw: any) => {
    if (!raw || !Number.isSafeInteger(raw.id) || raw.id <= 0 || ids.has(raw.id)
      || typeof raw.name !== "string" || !raw.name.trim()
      || !Array.isArray(raw.misc_info) || raw.misc_info.length !== 1
      || !raw.misc_info[0] || typeof raw.misc_info[0] !== "object" || Array.isArray(raw.misc_info[0])
      || !Array.isArray(raw.card_images) || raw.card_images.length === 0) invalid("invalid card or missing misc data");
    ids.add(raw.id);
    const misc = raw.misc_info[0];
    const points = Object.hasOwn(misc, "genesys_points") ? misc.genesys_points : 0;
    if (!Number.isSafeInteger(points) || points < 0) invalid(`invalid points for ${raw.name}`);
    const artworkIds = raw.card_images.map((image: any) => {
      const id = image?.id ?? raw.id;
      if (!Number.isSafeInteger(id) || id <= 0) invalid(`invalid artwork for ${raw.name}`);
      return id as number;
    });
    return { id: raw.id, name: raw.name, points, artworkIds };
  });
  if (cards.filter(card => card.points > 0).length < 500) invalid("incomplete points column");
  const contents = cards.filter(card => card.points > 0).map(card => [genesysOfficialCardName(card.name), card.points] as const)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (new Set(contents.map(([name]) => name)).size !== contents.length) invalid("duplicate pointed card name");
  const hash = createHash("sha256").update(JSON.stringify(contents)).digest("hex");
  return { cards, revision: `tcg-sha256-${hash}` };
}

/** Authorize the mapping separately from decoding, so read-only checks can report differences. */
export function parseGenesysPointsSnapshot(payload: unknown, options: GenesysSnapshotOptions = {}): GenesysPointsSnapshot {
  const minimumCards = Math.max(BASELINE_CARD_COUNT, options.minimumCards ?? 0);
  // An exact operator approval can account for small catalog merges/deletions.
  // Decode within the allowance first, then require that the computed mapping matches.
  const snapshot = parseGenesysPointsResponse(payload, options.expectedRevision
    ? Math.ceil(minimumCards * VERIFIED_CARD_COUNT_RATIO) : minimumCards);
  if (options.expectedRevision && options.expectedRevision !== snapshot.revision) {
    invalid("unverified points mapping does not match GENESYS_LIST_REVISION");
  }
  const previouslyVerified = snapshot.revision === options.previousList?.revision;
  const effectiveDate = options.effectiveDate
    ?? (previouslyVerified ? options.previousList!.effectiveDate : GENESYS_LIST_EFFECTIVE_DATE);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || !Number.isFinite(Date.parse(effectiveDate))
    || new Date(effectiveDate).toISOString().slice(0, 10) !== effectiveDate) invalid("invalid list effective date");
  // A lost points field and a real list change are indistinguishable in this API.
  // Only publish an unfamiliar mapping after an operator checks the new official
  // table and supplies its exact revision and newer effective date. Ordinary cron ticks
  // keep the verified list on any such change instead of guessing zeroes.
  const verifiedBaseline = snapshot.revision === `tcg-sha256-${VERIFIED_POINTS_HASH}`;
  if ((!verifiedBaseline && !previouslyVerified
    && (effectiveDate <= GENESYS_LIST_EFFECTIVE_DATE || options.expectedRevision !== snapshot.revision))
    || (options.previousList && (effectiveDate < options.previousList.effectiveDate
      || (!previouslyVerified && effectiveDate <= options.previousList.effectiveDate)))) {
    invalid("unverified points mapping; compare the new Konami table and set GENESYS_LIST_EFFECTIVE_DATE and GENESYS_LIST_REVISION");
  }
  return { ...snapshot, effectiveDate };
}

/** Caller caches source cards inside this transaction, so newly released cards get points too. */
export function publishGenesysPointsSnapshot(db: Database.Database, snapshot: GenesysPointsSnapshot, options: {
  cacheCards: () => void;
  canonicalId: (code: number) => number;
  expectedRevision?: string;
}): GenesysPointsList {
  return db.transaction(() => {
    // Another process may have published while this request was in flight.
    const active = createGenesysPointsReader(db);
    const previous = active.list();
    if (previous && (snapshot.effectiveDate < previous.effectiveDate
      || (snapshot.revision !== previous.revision && snapshot.effectiveDate <= previous.effectiveDate))) {
      invalid("unverified points mapping would replace a newer list");
    }
    const minimumCards = Math.ceil(active.cardCount() * (options.expectedRevision === snapshot.revision ? VERIFIED_CARD_COUNT_RATIO : 1));
    if (snapshot.cards.length < minimumCards) invalid("incomplete card list");
    options.cacheCards();
    const points = new Map<number, number>();
    for (const card of snapshot.cards) {
      for (const code of [card.id, ...card.artworkIds]) {
        const canonical = options.canonicalId(code);
        if (points.has(canonical) && points.get(canonical) !== card.points) invalid("conflicting artwork points");
        points.set(canonical, card.points);
      }
    }
    const update = db.prepare("update card_catalog set genesys_points = ?, genesys_revision = ? where ygoprodeck_id = ?");
    const rows = db.prepare("select ygoprodeck_id from card_catalog").all() as { ygoprodeck_id: number }[];
    for (const row of rows) {
      const value = points.get(options.canonicalId(row.ygoprodeck_id));
      // Missing identities become unknown, including rows left over from older lists.
      update.run(value ?? null, value === undefined ? null : snapshot.revision, row.ygoprodeck_id);
    }
    const list: GenesysPointsList = { revision: snapshot.revision, effectiveDate: snapshot.effectiveDate,
      sourceUrl: GENESYS_POINTS_SOURCE_URL, syncedAt: new Date().toISOString() };
    db.prepare(`insert into genesys_points_meta (id, revision, effective_date, source_url, synced_at)
      values (1, ?, ?, ?, ?) on conflict(id) do update set revision = excluded.revision,
      effective_date = excluded.effective_date, source_url = excluded.source_url, synced_at = excluded.synced_at`)
      .run(list.revision, list.effectiveDate, list.sourceUrl, list.syncedAt);
    return list;
  })();
}

/** Uses the application DB, never cards.cdb. No process cache survives a list change. */
export function createGenesysPointsReader(db: Database.Database) {
  const metadata = db.prepare(`select revision, effective_date as effectiveDate,
    source_url as sourceUrl, synced_at as syncedAt from genesys_points_meta where id = 1`);
  const lookup = db.prepare(`select c.genesys_points as points from card_catalog c
    join genesys_points_meta m on m.id = 1 and c.genesys_revision = m.revision
    where c.ygoprodeck_id = coalesce((select card_id from card_artworks where artwork_id = ?), ?)`);
  const sourceCount = db.prepare(`select count(distinct coalesce(a.card_id, c.ygoprodeck_id)) as count
    from card_catalog c join genesys_points_meta m on m.id = 1 and c.genesys_revision = m.revision
    left join card_artworks a on a.artwork_id = c.ygoprodeck_id`);
  const current = db.prepare(`select c.ygoprodeck_id as code, c.genesys_points as points
    from card_catalog c join genesys_points_meta m on m.id = 1 and c.genesys_revision = m.revision`);
  return {
    list(): GenesysPointsList | null {
      return (metadata.get() as GenesysPointsList | undefined) ?? null;
    },
    cardCount(): number { return (sourceCount.get() as { count: number }).count; },
    points(codes: readonly number[], identity?: CardIdentityCatalog): Map<number, number | null> {
      return db.transaction(() => new Map(codes.map(code => {
        const canonical = identity ? canonicalCardCode(code, identity) : code;
        const row = lookup.get(canonical, canonical) as { points: number | null } | undefined;
        return [code, row?.points ?? null] as const;
      })))();
    },
    /** Engine identity/type data stays authoritative; only current points are attached. */
    attach<T extends { name: string; type: number; alias?: number }>(cards: ReadonlyMap<number, T>): Map<number, T & { genesysPoints: number | null }> {
      const rows = current.all() as { code: number; points: number | null }[];
      const points = new Map(rows.map(row => [row.code, row.points]));
      return new Map([...cards].map(([code, card]) => [code, { ...card,
        genesysPoints: points.get(canonicalCardCode(code, cards)) ?? null }]));
    },
  };
}

export type GenesysPointsReader = ReturnType<typeof createGenesysPointsReader>;
