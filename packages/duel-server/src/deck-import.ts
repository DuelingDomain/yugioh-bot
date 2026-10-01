import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import type { DuelDeck } from "@yugidraft/shared/duels";
import { createCardCatalogService } from "@yugidraft/shared/services";
import { DeckLegalityError } from "./deck-legality.js";

type FetchLike = (
  input: string | URL | globalThis.Request,
  init?: globalThis.RequestInit,
) => Promise<Pick<Response, "ok" | "json">>;

type NormalizeImportedDeckOptions = {
  fetch?: FetchLike;
  keepUnresolved?: boolean;
};

type EngineRow = {
  id: number;
  ot: number;
  alias: number;
  type: number;
  name: string;
};

type EngineIndex = {
  mtime: number;
  byId: Map<number, EngineRow>;
  byName: Map<string, EngineRow[]>;
};

const TYPE_TOKEN = 0x4000;
const TYPE_MAXIMUM = 0x8000;
const TYPE_SKILL = 0x8000000;
const TYPE_ACTION = 0x10000000;
const TYPE_PLUS = 0x20000000;
const TYPE_MINUS = 0x40000000;
const TYPE_ARMOR = 0x80000000;
const UNPLAYABLE_TYPES = TYPE_TOKEN | TYPE_SKILL | TYPE_ACTION | TYPE_MAXIMUM | TYPE_PLUS | TYPE_MINUS | TYPE_ARMOR;

const OT_OCG = 0x1;
const OT_TCG = 0x2;
const OT_ILLEGAL = 0x8;
const OT_VIDEO_GAME = 0x10;
const OT_CUSTOM = 0x20;
const OT_RUSH = 0x200;
const OT_HIDDEN = 0x1000;

const engineIndexes = new Map<string, EngineIndex>();

function fail(message: string): never {
  throw new DeckLegalityError(message);
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function isPlayable(card: EngineRow): boolean {
  if ((card.type & UNPLAYABLE_TYPES) !== 0) return false;
  if ((card.ot & (OT_OCG | OT_TCG)) === 0) return false;
  if ((card.ot & OT_RUSH) !== 0) return false;
  if ((card.ot & (OT_ILLEGAL | OT_VIDEO_GAME | OT_CUSTOM | OT_HIDDEN)) !== 0) return false;
  return true;
}

function loadEngineIndex(dataDirectory: string): EngineIndex {
  const root = resolve(dataDirectory);
  const cdbPath = join(root, "cards.cdb");
  if (!existsSync(cdbPath)) fail(`Cannot read engine card database at ${cdbPath}`);
  const mtime = statSync(cdbPath).mtimeMs;
  const cached = engineIndexes.get(root);
  if (cached && cached.mtime === mtime) return cached;

  const cdb = new Database(cdbPath, { readonly: true, fileMustExist: true });
  const byId = new Map<number, EngineRow>();
  const byName = new Map<string, EngineRow[]>();
  try {
    const rows = cdb
      .prepare<[], EngineRow>(
        "SELECT datas.id, datas.ot, datas.alias, datas.type, texts.name FROM datas JOIN texts USING (id)",
      )
      .all();
    for (const row of rows) {
      const entry: EngineRow = {
        id: Number(row.id),
        ot: Number(row.ot),
        alias: Number(row.alias),
        type: Number(row.type),
        name: row.name ?? "",
      };
      byId.set(entry.id, entry);
      const key = normalizeName(entry.name);
      if (!key) continue;
      const group = byName.get(key);
      if (group) group.push(entry);
      else byName.set(key, [entry]);
    }
  } finally {
    cdb.close();
  }

  const index: EngineIndex = { mtime, byId, byName };
  engineIndexes.set(root, index);
  return index;
}

function requireCardId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    fail(`Unknown card ${String(value)}`);
  }
  return value;
}

function requireCardIds(value: unknown): number[] {
  if (!Array.isArray(value)) fail("Deck must include main, extra, and side arrays");
  const ids: number[] = [];
  for (const entry of value) {
    ids.push(requireCardId(entry));
  }
  return ids;
}

function canonicalForName(index: EngineIndex, name: string, sourceId: number): number {
  const matches = index.byName.get(normalizeName(name)) ?? [];
  const playable = matches.filter(isPlayable);
  const canonical = playable.filter((card) => card.alias === 0);
  if (canonical.length === 1) return canonical[0].id;
  if (canonical.length > 1) fail(`Ambiguous card ${sourceId} (${name})`);

  const aliasTargets = new Set<number>();
  for (const card of playable) {
    if (card.alias !== 0) aliasTargets.add(card.alias);
  }
  if (aliasTargets.size === 1) {
    const [targetId] = aliasTargets;
    const target = targetId === undefined ? undefined : index.byId.get(targetId);
    if (target && isPlayable(target)) return target.id;
  }
  if (aliasTargets.size > 1) fail(`Ambiguous card ${sourceId} (${name})`);
  fail(`Unknown card ${sourceId} (${name})`);
}

/** Maps ids the engine card database lacks to engine passcodes, through the synced catalog and card names. */
async function resolveMissingIds(
  index: EngineIndex,
  allIds: number[],
  db: Database.Database,
  options: NormalizeImportedDeckOptions,
): Promise<Map<number, number>> {
  const missing: number[] = [];
  const seenMissing = new Set<number>();
  for (const id of allIds) {
    if (index.byId.has(id) || seenMissing.has(id)) continue;
    seenMissing.add(id);
    missing.push(id);
  }

  const resolved = new Map<number, number>();
  if (missing.length > 0) {
    const catalog = createCardCatalogService(db, { fetch: options.fetch });
    const cached = catalog.findByIds(missing);
    const nameByInputId = new Map<number, string>();
    for (const card of cached) nameByInputId.set(card.ygoprodeckId, card.name);
    for (const id of missing) {
      if (nameByInputId.has(id)) continue;
      const card = await catalog.syncCardById(id);
      if (card) nameByInputId.set(id, card.name);
    }
    for (const id of missing) {
      const name = nameByInputId.get(id);
      if (!name) {
        if (options.keepUnresolved) continue;
        fail(`Unknown card ${id}`);
      }
      try {
        resolved.set(id, canonicalForName(index, name, id));
      } catch (error) {
        if (options.keepUnresolved && error instanceof DeckLegalityError) continue;
        throw error;
      }
    }
  }
  return resolved;
}

export async function normalizeImportedDeck(
  deck: DuelDeck,
  dataDirectory: string,
  db: Database.Database,
  options: NormalizeImportedDeckOptions = {},
): Promise<DuelDeck> {
  if (deck == null || typeof deck !== "object") fail("Deck must include main, extra, and side arrays");
  const main = requireCardIds(deck.main);
  const extra = requireCardIds(deck.extra);
  const side = requireCardIds(deck.side);
  const deckMaster = deck.deckMaster === undefined ? undefined : requireCardId(deck.deckMaster);

  const index = loadEngineIndex(dataDirectory);
  const allIds = deckMaster === undefined ? [...main, ...extra, ...side] : [...main, ...extra, ...side, deckMaster];
  const resolved = await resolveMissingIds(index, allIds, db, options);

  const remap = (id: number): number => resolved.get(id) ?? id;
  const normalized: DuelDeck = {
    main: main.map(remap),
    extra: extra.map(remap),
    side: side.map(remap),
  };
  if (deckMaster !== undefined) normalized.deckMaster = remap(deckMaster);
  return normalized;
}

/** Engine passcode for each input id, resolved like `normalizeImportedDeck`; an id that cannot be resolved maps to null. */
export async function normalizeCardCodes(
  codes: number[],
  dataDirectory: string,
  db: Database.Database,
  options: Pick<NormalizeImportedDeckOptions, "fetch"> = {},
): Promise<Map<number, number | null>> {
  const ids = requireCardIds(codes);
  const index = loadEngineIndex(dataDirectory);
  const resolved = await resolveMissingIds(index, ids, db, { ...options, keepUnresolved: true });
  const result = new Map<number, number | null>();
  for (const id of ids) {
    result.set(id, index.byId.has(id) ? id : (resolved.get(id) ?? null));
  }
  return result;
}
