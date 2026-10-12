import { DeckRequestError, parseBody } from "./api";

/*
 * Bulk deck import, as the API contract in data/briefs/deck-bulk-import-plan.md defines it.
 * The server owns parsing, card resolution and duplicate checks; the browser only sends text.
 */

/** Limits the server enforces. The browser checks them first so a bad pick does not cost a round trip. */
export const IMPORT_MAX_DECKS = 50;
export const IMPORT_MAX_SOURCE_BYTES = 64 * 1024;
export const IMPORT_MAX_BODY_BYTES = 1024 * 1024;

/** The deck format a row is saved as. The server names them "standard" and "domain". */
export type ImportMode = "standard" | "domain";

export type ImportSource = { id: string; name: string; text: string; mode?: ImportMode };

export type ImportDeck = { main: number[]; extra: number[]; side: number[]; deckMaster: number | null };

export type ImportError = { code: string; message: string; passcode?: number };
export type ImportWarning = { code: string; message: string; from?: number; to?: number };

export type ImportDuplicate =
  | { kind: "saved"; deckId: number; name: string }
  | { kind: "row"; rowId: string; name?: string };

export type ImportPreviewRow = {
  rowId: string;
  sourceId: string;
  name: string;
  deck: ImportDeck;
  counts: { main: number; extra: number; side: number };
  errors: ImportError[];
  warnings: ImportWarning[];
  mode?: ImportMode;
  duplicateOf?: ImportDuplicate | null;
};

export type ImportPreview = { maxDecks: number; rows: ImportPreviewRow[] };

export type BulkImportRow = { name: string; deck: ImportDeck; mode?: ImportMode };

export type BulkImportResult = {
  created: Array<{ id: number; name: string }>;
  failed: Array<{ index: number; errors: ImportError[] }>;
};

function limitMessage(error: unknown): never {
  if (error instanceof DeckRequestError) {
    if (error.status === 413) {
      throw new DeckRequestError(
        error.message.startsWith("Request failed")
          ? "That is too much to import at once. Pick fewer or smaller files."
          : error.message,
        413,
      );
    }
    throw error;
  }
  if (error instanceof DOMException && error.name === "AbortError") throw error;
  throw new DeckRequestError("Could not reach the server. Check your connection and try again.", 0);
}

async function postJson<T>(url: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  try {
    return await parseBody<T>(await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    }));
  } catch (error: unknown) {
    return limitMessage(error);
  }
}

export async function previewDeckImport(sources: ImportSource[], signal?: AbortSignal): Promise<ImportPreview> {
  const body = await postJson<Partial<ImportPreview>>("/api/decks/import/preview", { sources }, signal);
  if (!Array.isArray(body.rows)) throw new DeckRequestError("The server returned an invalid preview.", 502);
  return { maxDecks: typeof body.maxDecks === "number" ? body.maxDecks : IMPORT_MAX_DECKS, rows: body.rows };
}

export async function bulkImportDecks(rows: BulkImportRow[], signal?: AbortSignal): Promise<BulkImportResult> {
  const body = await postJson<Partial<BulkImportResult>>("/api/decks/import/bulk", { rows }, signal);
  if (!Array.isArray(body.created) || !Array.isArray(body.failed)) {
    throw new DeckRequestError("The server returned an invalid import result.", 502);
  }
  return { created: body.created, failed: body.failed };
}
