import type { DuelDeck, DuelMode } from "@yugidraft/shared/duels";
import { parseDeckText } from "@/components/duel/ydk";
import { DEFAULT_NAME, allCodes, cutName, importForLibrary } from "./model";

/** A YDK is a short text list; a bigger file is not a deck. */
export const MAX_IMPORT_FILE_BYTES = 256 * 1024;

export interface PreparedDeckImport {
  name: string;
  mode: DuelMode;
  deck: DuelDeck;
}

export function deckNameFromFile(fileName: string): string {
  const base = fileName
    .replace(/\.(ydk|txt)$/i, "")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cutName(base) || DEFAULT_NAME;
}

/**
 * Turns one YDK (or ydke:// link) file into a saved-deck body. A #deckmaster section marks a Domain
 * list whatever mode was picked; for Domain, a lone Side card becomes the Deck Master.
 */
export function prepareDeckImport(text: string, fileName: string, mode: DuelMode): PreparedDeckImport {
  const raw = parseDeckText(text);
  if (allCodes(raw).length === 0) {
    throw new Error("No cards found. Is this a YDK file?");
  }
  const importMode: DuelMode = raw.deckMaster != null ? "domain" : mode;
  return {
    name: deckNameFromFile(fileName),
    mode: importMode,
    deck: importForLibrary(raw, importMode).deck,
  };
}
