import { DEFAULT_NAME, cutName } from "./model";
import {
  IMPORT_MAX_BODY_BYTES,
  IMPORT_MAX_DECKS,
  IMPORT_MAX_SOURCE_BYTES,
  type BulkImportRow,
  type ImportPreviewRow,
  type ImportSource,
} from "./import-api";

/** One preview row as the person edits it: the server's row plus the name they typed and the checkbox. */
export type PreviewItem = { row: ImportPreviewRow; name: string; selected: boolean };

export type SourceBatch = { sources: ImportSource[]; notes: string[] };

async function readFile(file: File): Promise<string> {
  return typeof file.text === "function" ? file.text() : new Response(file).text();
}

/**
 * Reads the picked files into preview sources. A file past the per-file limit is left out with a note, and so
 * is every file past the deck count or the total size limit. The rest still go to the server.
 */
export async function readSources(files: File[]): Promise<SourceBatch> {
  const sources: ImportSource[] = [];
  const notes: string[] = [];
  let total = 0;
  for (const [index, file] of files.entries()) {
    if (sources.length >= IMPORT_MAX_DECKS) {
      notes.push(`Only the first ${IMPORT_MAX_DECKS} files are used. ${files.length - index} more were left out.`);
      break;
    }
    if (file.size > IMPORT_MAX_SOURCE_BYTES) {
      notes.push(`${file.name} is too large to be a deck file. The limit is ${IMPORT_MAX_SOURCE_BYTES / 1024} KiB.`);
      continue;
    }
    if (total + file.size > IMPORT_MAX_BODY_BYTES) {
      notes.push(`${file.name} was left out. One import can hold ${IMPORT_MAX_BODY_BYTES / 1024 / 1024} MiB of files at most.`);
      continue;
    }
    total += file.size;
    sources.push({ id: `f${index}`, name: file.name, text: await readFile(file) });
  }
  return { sources, notes };
}

/** Pasted text is one source. The server splits it into one deck per ydke:// line. */
export function pasteSource(text: string): SourceBatch {
  const trimmed = text.trim();
  if (new TextEncoder().encode(trimmed).length > IMPORT_MAX_SOURCE_BYTES) {
    return { sources: [], notes: [`That text is too long. The limit is ${IMPORT_MAX_SOURCE_BYTES / 1024} KiB.`] };
  }
  return { sources: [{ id: "paste", name: "Pasted deck", text: trimmed }], notes: [] };
}

/** A row with an error cannot be imported. */
export function hasErrors(row: ImportPreviewRow): boolean {
  return row.errors.length > 0;
}

/** Rows with errors start unchecked, and so do duplicates. Everything else starts checked. */
export function toItems(rows: ImportPreviewRow[]): PreviewItem[] {
  return rows.map((row) => ({ row, name: row.name, selected: !hasErrors(row) && !row.duplicateOf }));
}

export function selectedItems(items: PreviewItem[]): PreviewItem[] {
  return items.filter((item) => item.selected && !hasErrors(item.row));
}

/** What the bulk call sends: only the checked rows, with the names as edited. */
export function toBulkRows(items: PreviewItem[]): BulkImportRow[] {
  return selectedItems(items).map((item) => ({ name: cutName(item.name.trim()) || DEFAULT_NAME, deck: item.row.deck }));
}

/** "Duplicate of <name>": a saved deck by its name, an earlier row by the name it has now. */
export function duplicateLabel(item: PreviewItem, items: PreviewItem[]): string | null {
  const duplicate = item.row.duplicateOf;
  if (!duplicate) return null;
  if (duplicate.kind === "saved") return `Duplicate of ${duplicate.name}`;
  const earlier = items.find((other) => other.row.rowId === duplicate.rowId);
  return `Duplicate of ${earlier?.name.trim() || duplicate.name || "an earlier deck"}`;
}
