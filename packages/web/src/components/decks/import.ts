import { DEFAULT_NAME, cutName } from "./model";

/** A YDK is a short text list; a bigger file is not a deck. */
export const MAX_IMPORT_FILE_BYTES = 256 * 1024;

export function deckNameFromFile(fileName: string): string {
  const base = fileName
    .replace(/\.(ydk|txt)$/i, "")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cutName(base) || DEFAULT_NAME;
}
