import { DEFAULT_NAME, cutName } from "./model";
import {
  IMPORT_MAX_BODY_BYTES,
  IMPORT_MAX_DECKS,
  IMPORT_MAX_SOURCE_BYTES,
  type BulkImportRow,
  type ImportMode,
  type ImportPreviewRow,
  type ImportSource,
} from "./import-api";

export const MODE_CHOICES = [
  { value: "standard" as const, label: "Standard" },
  { value: "domain" as const, label: "Domain" },
] satisfies ReadonlyArray<{ value: ImportMode; label: string }>;

export function importModeLabel(mode: ImportMode): string {
  return mode === "domain" ? "Domain" : "Standard";
}

/**
 * One preview row as the person edits it: the server's row plus the name they typed, the checkbox, the mode
 * it is saved as, and why the last import of it failed (if it did).
 */
export type PreviewItem = {
  row: ImportPreviewRow;
  name: string;
  selected: boolean;
  mode: ImportMode;
  failure: string | null;
};

export type SourceBatch = { sources: ImportSource[]; notes: string[] };

async function readFile(file: File): Promise<string> {
  return typeof file.text === "function" ? file.text() : new Response(file).text();
}

/** Room the batch prefix and the mode add to each source when the body is built. */
const SOURCE_OVERHEAD_BYTES = 32;

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * How many decks the server will make of this text. Once a ydke:// line is present, every nonblank line is one
 * deck. Otherwise the text is one YDK list.
 */
export function deckCount(text: string): number {
  const lines = text.split(/\r\n|\r|\n/).map((line) => line.trim()).filter(Boolean);
  return lines.some((line) => line.toLowerCase().startsWith("ydke://")) ? lines.length : 1;
}

/** The size of one source inside the JSON body, with room for what is added later. */
function bodyBytes(source: ImportSource): number {
  return byteLength(JSON.stringify(source)) + SOURCE_OVERHEAD_BYTES;
}

/**
 * Reads the picked files into preview sources. The limits are the server's: decks after the split, not files,
 * and the JSON body, not the file sizes. A file over a limit is left out with a note, and the rest still go.
 */
export async function readSources(files: File[]): Promise<SourceBatch> {
  const sources: ImportSource[] = [];
  const notes: string[] = [];
  let decks = 0;
  let total = 0;
  for (const [index, file] of files.entries()) {
    if (file.size > IMPORT_MAX_SOURCE_BYTES) {
      notes.push(`${file.name} is too large to be a deck file. The limit is ${IMPORT_MAX_SOURCE_BYTES / 1024} KiB.`);
      continue;
    }
    const source: ImportSource = { id: `f${index}`, name: file.name, text: await readFile(file) };
    const count = deckCount(source.text);
    if (decks + count > IMPORT_MAX_DECKS) {
      notes.push(`${file.name} was left out. One import can hold ${IMPORT_MAX_DECKS} decks at most.`);
      continue;
    }
    const size = bodyBytes(source);
    if (total + size > IMPORT_MAX_BODY_BYTES) {
      notes.push(`${file.name} was left out. One import can hold ${IMPORT_MAX_BODY_BYTES / 1024 / 1024} MiB of files at most.`);
      continue;
    }
    decks += count;
    total += size;
    sources.push(source);
  }
  return { sources, notes };
}

/** Pasted text is one source. The server splits it into one deck per ydke:// line. */
export function pasteSource(text: string): SourceBatch {
  const trimmed = text.trim();
  if (byteLength(trimmed) > IMPORT_MAX_SOURCE_BYTES) {
    return { sources: [], notes: [`That text is too long. The limit is ${IMPORT_MAX_SOURCE_BYTES / 1024} KiB.`] };
  }
  const count = deckCount(trimmed);
  if (count > IMPORT_MAX_DECKS) {
    return { sources: [], notes: [`That text has ${count} decks. One import can hold ${IMPORT_MAX_DECKS} at most. Remove some lines.`] };
  }
  return { sources: [{ id: "paste", name: "Pasted deck", text: trimmed }], notes: [] };
}

/**
 * Gives every source of one pick a batch prefix and the chosen mode. The server builds row ids from source ids,
 * so the prefix keeps row ids unique when a later pick is added to the rows already on screen.
 */
export function tagSources(sources: ImportSource[], batch: number, mode: ImportMode): ImportSource[] {
  return sources.map((source) => ({ ...source, id: `b${batch}-${source.id}`, mode }));
}

const IMPORTED_NAME = /^Imported deck (\d+)$/;

function importedNumber(name: string): number {
  const match = IMPORTED_NAME.exec(name.trim());
  return match ? Number(match[1]) : 0;
}

/** The highest "Imported deck N" number among the rows on screen (their server name or their edited name). */
export function highestImportedNumber(items: PreviewItem[]): number {
  return items.reduce((top, item) => Math.max(top, importedNumber(item.row.name), importedNumber(item.name)), 0);
}

/**
 * The server numbers the unnamed YDKE decks from 1 in every call. Counting on from `base` keeps the names in
 * one list apart. The row name changes too, because the name box is labeled by it.
 */
export function renumberImported(rows: ImportPreviewRow[], base: number): { rows: ImportPreviewRow[]; top: number } {
  let top = base;
  const renamed = rows.map((row) => {
    const n = importedNumber(row.name);
    if (n === 0) return row;
    top = Math.max(top, base + n);
    return { ...row, name: `Imported deck ${base + n}` };
  });
  return { rows: renamed, top };
}

/** The server caps the issues of a row and ends the list with one "more_issues" entry. It is not an issue. */
export const MORE_ISSUES = "more_issues";

export function realIssues<T extends { code: string }>(issues: T[]): T[] {
  return issues.filter((issue) => issue.code !== MORE_ISSUES);
}

/** How many issues the server left out of a row, for the "and N more" line. */
export function omittedCount(row: ImportPreviewRow): number {
  return [...row.errors, ...row.warnings]
    .filter((issue) => issue.code === MORE_ISSUES)
    .reduce((total, issue) => total + (issue.count ?? Number(/\d+/.exec(issue.message)?.[0] ?? 0)), 0);
}

/** A card check that stopped at the server's lookup limit. A new check of the same deck can pass. */
export function isLookupLimited(row: ImportPreviewRow): boolean {
  return row.errors.some((issue) => issue.code === "lookup_limited");
}

/** A row with an error cannot be imported. */
export function hasErrors(row: ImportPreviewRow): boolean {
  return realIssues(row.errors).length > 0;
}

/** Rows with errors start unchecked, and so do duplicates. Everything else starts checked. */
export function toItems(rows: ImportPreviewRow[], requested: ImportMode): PreviewItem[] {
  return rows.map((row) => ({
    row,
    name: row.name,
    selected: !hasErrors(row) && !row.duplicateOf,
    mode: row.mode ?? requested,
    failure: null,
  }));
}

export function selectedItems(items: PreviewItem[]): PreviewItem[] {
  return items.filter((item) => item.selected && !hasErrors(item.row));
}

/** What the bulk call sends: only the checked rows, with the names as edited. */
export function toBulkRows(items: PreviewItem[]): BulkImportRow[] {
  return selectedItems(items).map((item) => ({
    name: cutName(item.name.trim()) || DEFAULT_NAME,
    deck: item.row.deck,
    mode: item.mode,
  }));
}

/** "Duplicate of <name>": a saved deck by its name, an earlier row by the name it has now. */
export function duplicateLabel(item: PreviewItem, items: PreviewItem[]): string | null {
  const duplicate = item.row.duplicateOf;
  if (!duplicate) return null;
  if (duplicate.kind === "saved") return `Duplicate of ${duplicate.name}`;
  const earlier = items.find((other) => other.row.rowId === duplicate.rowId);
  return `Duplicate of ${earlier?.name.trim() || duplicate.name || "an earlier deck"}`;
}
