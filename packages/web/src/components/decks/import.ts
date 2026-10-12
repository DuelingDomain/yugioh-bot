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

/**
 * TODO(deck-extra-fix): placeholder. The backend import will say which cards it moved out of the Extra Deck;
 * set this to the real field name (and read it from the right object) when that lands.
 */
export const MOVED_CARDS_FIELD = "movedToMain";

/**
 * The note an import shows when the backend moved cards to the Main Deck because they are not Extra Deck
 * monsters. The field may hold a count or a list of card names. Returns null when nothing moved.
 */
export function movedCardsNote(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const field = (result as Record<string, unknown>)[MOVED_CARDS_FIELD];
  const count = Array.isArray(field) ? field.length : typeof field === "number" ? field : 0;
  if (!Number.isFinite(count) || count < 1) return null;
  const names = Array.isArray(field) ? field.filter((name): name is string => typeof name === "string" && name !== "").slice(0, 3) : [];
  const which = names.length > 0 ? ` (${names.join(", ")}${count > names.length ? ", …" : ""})` : "";
  return `${count} ${count === 1 ? "card was" : "cards were"} moved to the Main Deck${which}. Only Fusion, Synchro, Xyz and Link monsters go in the Extra Deck.`;
}
