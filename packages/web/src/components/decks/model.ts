import { cardLimit, cardTypeRank, type DeckCardInfo, type DuelCardInfo, type DuelDeck, type DuelMode } from "@yugidraft/shared/duels";
import {
  TYPE_FUSION,
  TYPE_LINK,
  TYPE_MONSTER,
  TYPE_SPELL,
  TYPE_SYNCHRO,
  TYPE_TRAP,
  TYPE_XYZ,
} from "@/components/duel/constants";
import { applyDomainMaster, selectDomainMaster, serializeYdk, type DeckMasterSelection } from "@/components/duel/ydk";

export const EMPTY_DECK: DuelDeck = { main: [], extra: [], side: [] };
export const DEFAULT_NAME = "Untitled deck";
export const MAX_NAME_LENGTH = 100;

/** Cuts a name to at most `max` characters of the length the API counts, never inside a surrogate pair, without trailing spaces. */
export function cutName(name: string, max = MAX_NAME_LENGTH): string {
  let out = "";
  for (const char of name) {
    if (out.length + char.length > max) break;
    out += char;
  }
  return out.trimEnd();
}
export const EXTRA_TYPE_MASK = TYPE_FUSION | TYPE_SYNCHRO | TYPE_XYZ | TYPE_LINK;

export type DeckSection = "main" | "extra" | "side";
/** `index` is the copy that was chosen, when the choice came from one tile of a deck section. */
export type SelectedStack = { section: DeckSection; code: number; index?: number };


export function cloneDeck(deck: DuelDeck): DuelDeck {
  const next: DuelDeck = {
    main: [...deck.main],
    extra: [...deck.extra],
    side: [...deck.side],
  };
  if (deck.deckMaster != null) next.deckMaster = deck.deckMaster;
  return next;
}

export function allCodes(deck: DuelDeck): number[] {
  const codes = [...deck.main, ...deck.extra, ...deck.side];
  if (deck.deckMaster != null) codes.push(deck.deckMaster);
  return codes;
}

export function uniqueCodes(codes: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const code of codes) {
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

export function isExtraMonster(card: DuelCardInfo): boolean {
  return (card.type & TYPE_MONSTER) !== 0 && (card.type & EXTRA_TYPE_MASK) !== 0;
}

export function defaultAddSection(card: DuelCardInfo): "main" | "extra" {
  return isExtraMonster(card) ? "extra" : "main";
}


export function addCode(deck: DuelDeck, section: DeckSection, code: number): DuelDeck {
  return { ...deck, [section]: [...deck[section], code] };
}

export function removeOne(
  deck: DuelDeck,
  section: DeckSection,
  code: number,
): { deck: DuelDeck; removedIndex: number } {
  const index = deck[section].lastIndexOf(code);
  if (index < 0) return { deck, removedIndex: -1 };
  const next = deck[section].slice();
  next.splice(index, 1);
  return { deck: { ...deck, [section]: next }, removedIndex: index };
}

export function removeAt(deck: DuelDeck, section: DeckSection, index: number): DuelDeck {
  if (index < 0 || index >= deck[section].length) return deck;
  const next = deck[section].slice();
  next.splice(index, 1);
  return { ...deck, [section]: next };
}

export function moveOne(deck: DuelDeck, from: DeckSection, to: DeckSection, code: number): DuelDeck {
  if (from === to) return deck;
  const removed = removeOne(deck, from, code);
  if (removed.removedIndex < 0) return deck;
  return addCode(removed.deck, to, code);
}

export function shiftMasterOrigin(
  origin: DeckMasterSelection["masterOrigin"],
  section: DeckSection,
  removedIndex: number,
): DeckMasterSelection["masterOrigin"] {
  if (!origin || origin.section !== section || removedIndex < 0) return origin;
  if (removedIndex < origin.index) return { ...origin, index: origin.index - 1 };
  return origin;
}

export function importForLibrary(raw: DuelDeck, mode: DuelMode): DeckMasterSelection {
  if (mode === "domain" && raw.deckMaster == null && raw.side.length === 1) {
    return {
      deck: applyDomainMaster(raw),
      masterOrigin: { section: "side", index: 0 },
    };
  }
  return { deck: cloneDeck(raw), masterOrigin: null };
}

export function snapshotOf(name: string, mode: DuelMode, deck: DuelDeck): string {
  return JSON.stringify({ name, mode, deck });
}

export function isNewDeckDirty(name: string, mode: DuelMode, deck: DuelDeck): boolean {
  return name.trim() !== DEFAULT_NAME
    || mode !== "normal"
    || deck.main.length > 0
    || deck.extra.length > 0
    || deck.side.length > 0
    || deck.deckMaster != null;
}

export function modeLabel(mode: DuelMode): string {
  return mode === "domain" ? "Domain" : "Standard";
}

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}


export function cardLabel(code: number, catalog: ReadonlyMap<number, DuelCardInfo | DeckCardInfo>): string {
  return catalog.get(code)?.name ?? `Passcode ${code}`;
}

export function deckYdkText(deck: DuelDeck): string {
  return serializeYdk(deck);
}

export function downloadYdkFile(name: string, deck: DuelDeck): void {
  const blob = new Blob([deckYdkText(deck)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safe = name.trim().replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "deck";
  link.href = url;
  link.download = `${safe}.ydk`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function guidanceNotes(mode: DuelMode, deck: DuelDeck): string[] {
  const notes: string[] = [];
  if (mode === "domain") {
    if (deck.main.length !== 60) notes.push(`Main is ${deck.main.length}; Domain tables want exactly 60.`);
    if (deck.extra.length > 15) notes.push(`Extra is ${deck.extra.length}; tables usually cap Extra at 15.`);
    if (deck.deckMaster == null) notes.push("No Deck Master yet. Domain tables require one before you can ready.");
    if (deck.side.length > 0) {
      notes.push(`Side still has ${deck.side.length} card${deck.side.length === 1 ? "" : "s"}. Competitive Domain has no side deck; they stay here until you move or remove them.`);
    }
  } else {
    if (deck.main.length < 40 || deck.main.length > 60) notes.push(`Main is ${deck.main.length}; Standard tables want 40–60.`);
    if (deck.extra.length > 15) notes.push(`Extra is ${deck.extra.length}; tables usually cap Extra at 15.`);
    if (deck.side.length > 15) notes.push(`Side is ${deck.side.length}; tables usually cap Side at 15.`);
    if (deck.deckMaster != null) {
      notes.push("A Deck Master is stored on this save so switching back to Domain does not drop it. Standard tables ignore it.");
    }
  }
  return notes;
}

export type CardCatalog = ReadonlyMap<number, DuelCardInfo | DeckCardInfo>;
export type BanlistLimits = Readonly<Record<number, 0 | 1 | 2>>;

/** Other arts the card has besides its own; 0 when the card is unknown or has one art. */
export function altArtCount(code: number, catalog: CardCatalog): number {
  return (catalog.get(code) as DeckCardInfo | undefined)?.altArtCount ?? 0;
}

/** Same-name cards (alternate artworks) share one copy count. */
export function copyKey(code: number, catalog: CardCatalog): string {
  const name = catalog.get(code)?.name;
  return name ? `name:${name}` : `code:${code}`;
}

export function copyCounts(deck: DuelDeck, catalog: CardCatalog): Map<string, number> {
  const counts = new Map<string, number>();
  for (const code of allCodes(deck)) {
    const key = copyKey(code, catalog);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Copies allowed by the banlist (3 when it does not list the card). */
export function copyLimit(code: number, catalog: CardCatalog, limits: BanlistLimits | null): 0 | 1 | 2 | 3 {
  if (!limits) return 3;
  const card = catalog.get(code);
  const alias = card && "alias" in card ? card.alias : 0;
  return cardLimit(limits, { code, alias });
}

export interface CopyProblem {
  key: string;
  name: string;
  count: number;
  max: number;
}

/**
 * Cards with more copies than the banlist (or the 3-copy rule) allows. `singleton` is the Domain rule: one
 * copy of each card across the deck, alternate arts included, and the Deck Master counts as that copy.
 */
export function copyProblems(deck: DuelDeck, catalog: CardCatalog, limits: BanlistLimits | null, singleton = false): CopyProblem[] {
  const counts = copyCounts(deck, catalog);
  const groups = new Map<string, { code: number; max: number }>();
  for (const code of uniqueCodes(allCodes(deck))) {
    const key = copyKey(code, catalog);
    const max = Math.min(groups.get(key)?.max ?? 3, copyLimit(code, catalog, limits), singleton ? 1 : 3);
    groups.set(key, { code: groups.get(key)?.code ?? code, max });
  }
  const problems: CopyProblem[] = [];
  for (const [key, group] of groups) {
    const count = counts.get(key) ?? 0;
    if (count > group.max) problems.push({ key, name: cardLabel(group.code, catalog), count, max: group.max });
  }
  return problems;
}

export interface BreakdownPart {
  key: string;
  label: string;
  count: number;
}

const MAIN_PARTS = [
  { key: "monster", label: "Monster", bit: TYPE_MONSTER },
  { key: "spell", label: "Spell", bit: TYPE_SPELL },
  { key: "trap", label: "Trap", bit: TYPE_TRAP },
] as const;

const EXTRA_PARTS = [
  { key: "fusion", label: "Fusion", bit: TYPE_FUSION },
  { key: "synchro", label: "Synchro", bit: TYPE_SYNCHRO },
  { key: "xyz", label: "Xyz", bit: TYPE_XYZ },
  { key: "link", label: "Link", bit: TYPE_LINK },
] as const;

/** Per-type counts for a section header: Monster/Spell/Trap, or Fusion/Synchro/Xyz/Link for the Extra Deck. */
export function sectionBreakdown(section: DeckSection, codes: readonly number[], catalog: CardCatalog): BreakdownPart[] {
  const parts = section === "extra" ? EXTRA_PARTS : MAIN_PARTS;
  const counts = parts.map((part) => ({ key: part.key, label: part.label, count: 0 }));
  for (const code of codes) {
    const type = catalog.get(code)?.type;
    if (type == null) continue;
    // Link before Xyz, Xyz before Synchro: a card counts once, in its first matching part (from the end).
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      if (type & parts[index]!.bit) {
        counts[index]!.count += 1;
        break;
      }
    }
  }
  return counts.filter((part) => part.count > 0);
}

function sortCodes(codes: readonly number[], catalog: CardCatalog): number[] {
  return codes
    .map((code, index) => ({ code, index, card: catalog.get(code) }))
    .sort((a, b) => {
      if (!a.card || !b.card) return a.card ? -1 : b.card ? 1 : a.index - b.index;
      return cardTypeRank(a.card.type) - cardTypeRank(b.card.type)
        || b.card.level - a.card.level
        || a.card.name.localeCompare(b.card.name, "en")
        || a.code - b.code;
    })
    .map((entry) => entry.code);
}

/** Groups each section by card type, then Level, then name. Unknown passcodes go last. */
export function sortDeck(selection: DeckMasterSelection, catalog: CardCatalog): DeckMasterSelection {
  const { deck, masterOrigin } = selection;
  const next: DuelDeck = {
    ...deck,
    main: sortCodes(deck.main, catalog),
    extra: sortCodes(deck.extra, catalog),
    side: sortCodes(deck.side, catalog),
  };
  const same = (["main", "extra", "side"] as const).every((section) => next[section].every((code, index) => code === deck[section][index]));
  if (same) return selection;
  // Positions change, so a replaced Deck Master goes back to the end of its section.
  const origin = masterOrigin ? { section: masterOrigin.section, index: next[masterOrigin.section].length } : null;
  return { deck: next, masterOrigin: origin };
}

/** Draws a test hand from a shuffled copy of the Main Deck. */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = items.slice();
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [out[index], out[swap]] = [out[swap]!, out[index]!];
  }
  return out;
}

function withoutMaster(deck: DuelDeck): DuelDeck {
  return { main: deck.main, extra: deck.extra, side: deck.side };
}

/** Where a dragged or clicked card comes from: the card list, the Deck Master slot, or one copy in a section. */
export type CardSource = { code: number; from: "list" | "master" | DeckSection; index?: number };

function sourceIndex(deck: DuelDeck, source: CardSource & { from: DeckSection }): number {
  const { from, index, code } = source;
  if (index != null && deck[from][index] === code) return index;
  return deck[from].lastIndexOf(code);
}

/**
 * Puts one copy into a section at a position (the end when `at` is missing). A copy from a section
 * moves; a Deck Master that is dragged out stops being the master.
 */
export function placeCardAt(selection: DeckMasterSelection, source: CardSource, to: DeckSection, at?: number): { selection: DeckMasterSelection; index: number } {
  let { deck, masterOrigin } = selection;
  let target = at;
  if (source.from === "master") {
    if (deck.deckMaster !== source.code) return { selection, index: -1 };
    deck = withoutMaster(deck);
    masterOrigin = null;
  } else if (source.from !== "list") {
    const from = source.from;
    const index = sourceIndex(deck, { ...source, from });
    if (index < 0) return { selection, index: -1 };
    const landing = target ?? deck[to].length;
    if (from === to && (landing === index || landing === index + 1)) return { selection, index };
    deck = removeAt(deck, from, index);
    masterOrigin = shiftMasterOrigin(masterOrigin, from, index);
    if (from === to && target != null && target > index) target -= 1;
  }
  const list = deck[to];
  const position = target == null ? list.length : Math.min(Math.max(0, target), list.length);
  deck = { ...deck, [to]: [...list.slice(0, position), source.code, ...list.slice(position)] };
  if (masterOrigin && masterOrigin.section === to && position <= masterOrigin.index) {
    masterOrigin = { ...masterOrigin, index: masterOrigin.index + 1 };
  }
  return { selection: { deck, masterOrigin }, index: position };
}

export function placeCard(selection: DeckMasterSelection, source: CardSource, to: DeckSection, at?: number): DeckMasterSelection {
  return placeCardAt(selection, source, to, at).selection;
}

/** Takes one copy out of the deck. A Deck Master removed this way does not go back to its section. */
export function removeCard(selection: DeckMasterSelection, source: CardSource): DeckMasterSelection {
  const { deck, masterOrigin } = selection;
  if (source.from === "list") return selection;
  if (source.from === "master") {
    return deck.deckMaster === source.code ? { deck: withoutMaster(deck), masterOrigin: null } : selection;
  }
  const index = sourceIndex(deck, { ...source, from: source.from });
  if (index < 0) return selection;
  return { deck: removeAt(deck, source.from, index), masterOrigin: shiftMasterOrigin(masterOrigin, source.from, index) };
}

/** Makes a card the Deck Master, taking the copy from `section` when the deck has one there. */
export function chooseMaster(selection: DeckMasterSelection, code: number, section?: DeckSection): DeckMasterSelection {
  if (selection.deck.deckMaster === code) return selection;
  if (!section) return selectDomainMaster(selection, code);
  const cleared = selectDomainMaster(selection, undefined);
  const index = cleared.deck[section].indexOf(code);
  if (index < 0) return selectDomainMaster(selection, code);
  return {
    deck: { ...removeAt(cleared.deck, section, index), deckMaster: code },
    masterOrigin: { section, index },
  };
}

export function clearSection(selection: DeckMasterSelection, section: DeckSection): DeckMasterSelection {
  return { deck: { ...selection.deck, [section]: [] }, masterOrigin: selection.masterOrigin };
}
