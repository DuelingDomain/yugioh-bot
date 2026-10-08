import type { DuelDeck, DuelMode, SavedDeck } from "@yugidraft/shared/duels";
import { MAX_NAME_LENGTH, cutName, importForLibrary } from "../decks/model";

function sameCodes(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.every((code, index) => code === right[index]);
}

/** True when both decks hold the same cards in Main, Extra and Side (order does not matter) and the same Deck Master. */
export function sameDeckCards(a: DuelDeck, b: DuelDeck): boolean {
  return a.deckMaster === b.deckMaster
    && sameCodes(a.main, b.main)
    && sameCodes(a.extra, b.extra)
    && sameCodes(a.side, b.side);
}

/** The saved deck of this format that holds exactly these cards, if the player has one. */
export function findSavedDuplicate(saved: SavedDeck[], mode: DuelMode, deck: DuelDeck): SavedDeck | undefined {
  return saved.find((entry) => entry.mode === mode && sameDeckCards(entry.deck, deck));
}

/** The name for a pasted deck: "Imported deck" plus the local date and time. */
export function pastedDeckName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `Imported deck ${date} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** Adds " (2)", " (3)" and so on to a name until no saved deck uses it. The cut never leaves a space before the suffix. */
export function uniqueDeckName(base: string, used: string[]): string {
  const taken = new Set(used.map((name) => name.toLowerCase()));
  const start = cutName(base);
  if (!taken.has(start.toLowerCase())) return start;
  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})`;
    const name = `${cutName(base, MAX_NAME_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

export type ImportSave = { ok: true; mode: DuelMode; deck: DuelDeck } | { ok: false };

/**
 * The deck to save for an import, in the shape Manage decks saves: a #deckmaster section makes it a Domain
 * deck whatever the room is, and in Domain a lone Side card becomes the Deck Master. A list with more than one
 * Side card cannot be a Domain deck, so it is not saved. Count and banlist problems do not stop a save.
 */
export function prepareImportSave(raw: DuelDeck, roomMode: DuelMode): ImportSave {
  const mode: DuelMode = raw.deckMaster != null ? "domain" : roomMode;
  const deck = importForLibrary(raw, mode).deck;
  if (mode === "domain" && deck.side.length > 1) return { ok: false };
  return { ok: true, mode, deck };
}
