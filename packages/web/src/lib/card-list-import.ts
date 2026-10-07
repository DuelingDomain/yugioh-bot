/**
 * Shared bits of the "import a card list" screens: reading a file, and the words for what an import did.
 * The server reads names, passcodes, YDK text and ydke links (docs/api/cube-list-import.md).
 */

import { YDK_MAX_CHARS } from "./ydk-file";

/** What the file picker offers. */
export const LIST_FILE_ACCEPT = ".txt,.ydk,text/plain";

export interface ListCorrection {
  from: string;
  to: string;
}

/** What an import could not take at face value. Both lists are unique and in input order. */
export interface ListDiagnostics {
  /** Lines that were not imported: unknown names and passcodes, and section titles. */
  unknown: string[];
  /** Names that were close to a card and were matched to it. */
  corrected: ListCorrection[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Reads a chosen file as text. Rejects with a message fit to show. */
export function readListFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      const text = String(reader.result ?? "");
      if (text.length > YDK_MAX_CHARS) {
        reject(new Error("That file is too large. The limit is 64 Ki characters."));
      } else if (text.trim() === "") {
        reject(new Error("That file is empty."));
      } else {
        resolve(text);
      }
    };
    reader.readAsText(file);
  });
}

/** Lines that are not blank. Shown beside a loaded file's name. */
export function lineCount(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim() !== "").length;
}

export function loadedFileLine(name: string, text: string): string {
  return `${name}, ${plural(lineCount(text), "line")}`;
}

/** "Skipped 3 lines that are not card names". A section title lands here, so it must not read as an error. */
export function skippedHeading(n: number): string {
  return n === 1 ? "Skipped 1 line that is not a card name" : `Skipped ${n} lines that are not card names`;
}

/** "Corrected 2 names" */
export function correctedHeading(n: number): string {
  return `Corrected ${plural(n, "name")}`;
}

/** "Added 12 cards, 31 copies." One word for a list where each card has one copy. */
export function listAddedLine(added: number, copies: number): string {
  const cards = plural(added, "card");
  return copies === added ? `Added ${cards}.` : `Added ${cards}, ${plural(copies, "copy", "copies")}.`;
}

/** A refusal with a message fit to show. `retryAfter` is the seconds the server asked us to wait (503 with Retry-After). */
export class ListImportError extends Error {
  constructor(
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/** Reads a refused response: the server's message, and how long it asked us to wait. */
export async function listImportErrorFrom(res: Response, fallback: string): Promise<ListImportError> {
  const data = (await res.json().catch(() => ({}))) as { error?: unknown };
  const message = typeof data.error === "string" && data.error ? data.error : fallback;
  const seconds = Number(res.headers.get("Retry-After"));
  return new ListImportError(message, Number.isFinite(seconds) && seconds > 0 ? seconds : undefined);
}

/** The sentence when nothing in the list was a card. */
export const NOTHING_FOUND = "No cards found in that list.";
