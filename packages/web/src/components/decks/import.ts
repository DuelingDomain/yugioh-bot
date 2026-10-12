import type { DuelDeck, DuelMode } from "@yugidraft/shared/duels";
import { prepareDeckTextImport } from "./api";
import { DEFAULT_NAME, cutName, importForLibrary } from "./model";

/** A YDK is a short text list; a bigger file is not a deck. */
export const MAX_IMPORT_FILE_BYTES = 256 * 1024;

export interface PreparedDeckImport {
  name: string;
  mode: DuelMode;
  deck: DuelDeck;
  messages: string[];
}

export function deckNameFromFile(fileName: string): string {
  const base = fileName
    .replace(/\.(ydk|txt)$/i, "")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cutName(base) || DEFAULT_NAME;
}

/** Resolve and route each import by catalog type before building a saved-deck body. */
export async function prepareDeckImport(text: string, fileName: string, mode: DuelMode): Promise<PreparedDeckImport> {
  const prepared = await prepareDeckTextImport(text, mode);
  return {
    name: deckNameFromFile(fileName),
    mode: prepared.mode,
    deck: importForLibrary(prepared.deck, prepared.mode).deck,
    messages: prepared.messages,
  };
}
