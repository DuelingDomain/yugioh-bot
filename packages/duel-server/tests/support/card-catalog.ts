import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { engineDataDirectory } from "../engine-data-dir.js";

/** A card named by exact printed name, or by passcode. */
export type CardRef = string | number;

export interface CatalogCard {
  code: number;
  name: string;
  type: number;
  level: number;
  attack: number;
  defense: number;
}

const TYPE_TOKEN = 0x4000;

interface Catalog {
  byName: Map<string, CatalogCard[]>;
  byCode: Map<number, CatalogCard>;
  all: CatalogCard[];
}

const catalogs = new Map<string, Catalog>();

function load(dir: string): Catalog {
  const cached = catalogs.get(dir);
  if (cached) return cached;
  const path = join(dir, "cards.cdb");
  if (!existsSync(path)) throw new Error(`cards.cdb not found in ${dir}. Set DUEL_DATA_DIR to a duel engine data directory.`);
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare(
        "SELECT d.id AS code, t.name AS name, d.type AS type, d.level AS level, d.atk AS attack, d.def AS defense " +
          "FROM datas d JOIN texts t USING(id) WHERE d.alias=0 AND (d.ot&3)!=0 ORDER BY d.id",
      )
      .all() as CatalogCard[];
    const byName = new Map<string, CatalogCard[]>();
    const byCode = new Map<number, CatalogCard>();
    for (const row of rows) {
      byCode.set(row.code, row);
      const list = byName.get(row.name) ?? [];
      list.push(row);
      byName.set(row.name, list);
    }
    const catalog = { byName, byCode, all: rows };
    catalogs.set(dir, catalog);
    return catalog;
  } finally {
    db.close();
  }
}

function suggestions(catalog: Catalog, name: string): string[] {
  const needle = name.toLowerCase();
  const hits = catalog.all.filter((card) => card.name.toLowerCase().includes(needle));
  return hits.slice(0, 8).map((card) => `${card.name} (${card.code})`);
}

/** Resolve a name or code to a passcode. Fails fast on unknown or ambiguous names. */
export function resolveCard(ref: CardRef, dir: string = engineDataDirectory): number {
  return describeCard(ref, dir).code;
}

export function describeCard(ref: CardRef, dir: string = engineDataDirectory): CatalogCard {
  const catalog = load(dir);
  if (typeof ref === "number") {
    const card = catalog.byCode.get(ref);
    if (!card) throw new Error(`Unknown card code ${ref} (not a main passcode in cards.cdb)`);
    return card;
  }
  const exact = catalog.byName.get(ref);
  if (!exact || exact.length === 0) {
    const close = suggestions(catalog, ref);
    throw new Error(
      `Unknown card name "${ref}". Names must match cards.cdb exactly.` +
        (close.length > 0 ? ` Close matches: ${close.join("; ")}` : " No close matches."),
    );
  }
  if (exact.length > 1) {
    throw new Error(`Ambiguous card name "${ref}". Use a code: ${exact.map((card) => card.code).join(", ")}`);
  }
  return exact[0];
}

/** Name for a code, for messages. Falls back to the code. */
export function cardLabel(code: number | undefined, dir: string = engineDataDirectory): string {
  if (code == null) return "(hidden)";
  const card = load(dir).byCode.get(code);
  return card ? `${card.name} (${code})` : String(code);
}

export function searchCatalog(query: string, limit = 25, dir: string = engineDataDirectory): CatalogCard[] {
  const needle = query.toLowerCase();
  return load(dir).all.filter((card) => card.name.toLowerCase().includes(needle)).slice(0, limit);
}

export function isExtraDeckCard(card: CatalogCard): boolean {
  return (card.type & TYPE_TOKEN) === 0 && (card.type & (0x40 | 0x2000 | 0x800000 | 0x4000000)) !== 0;
}
