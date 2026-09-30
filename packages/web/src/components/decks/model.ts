import type { DuelCardInfo, DuelDeck, DuelMode } from "@yugidraft/shared/duels";
import { TYPE_FUSION, TYPE_LINK, TYPE_MONSTER, TYPE_SYNCHRO, TYPE_XYZ } from "@/components/duel/constants";
import { applyDomainMaster, serializeYdk, type DeckMasterSelection } from "@/components/duel/ydk";

export const EMPTY_DECK: DuelDeck = { main: [], extra: [], side: [] };
export const DEFAULT_NAME = "Untitled deck";
export const MAX_NAME_LENGTH = 100;
export const EXTRA_TYPE_MASK = TYPE_FUSION | TYPE_SYNCHRO | TYPE_XYZ | TYPE_LINK;

export type DeckSection = "main" | "extra" | "side";
export type SelectedStack = { section: DeckSection; code: number };


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


export function cardLabel(code: number, catalog: ReadonlyMap<number, DuelCardInfo>): string {
  return catalog.get(code)?.name ?? `Passcode ${code}`;
}

export function downloadYdkFile(name: string, deck: DuelDeck): void {
  const blob = new Blob([serializeYdk(deck)], { type: "text/plain;charset=utf-8" });
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
      notes.push(`Side still has ${deck.side.length} card${deck.side.length === 1 ? "" : "s"}. Competitive Domain has no Side Deck; they stay here until you move or remove them.`);
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
