import type { BridgeDeck, BridgeEnginesRequest, DetectedEngine } from "@/lib/bridges-api";
import type { BridgeFormat } from "./bridges-api";

/** A set holds one to four engines. */
export const MAX_ENGINES = 4;
/** The most card ids the host takes in one deck. */
const MAX_DECK_IDS = 91;

/** What the player changed on top of the engines the host found. */
export type EngineEdits = { added: string[]; removed: string[] };
export const NO_EDITS: EngineEdits = { added: [], removed: [] };

/** The same names, in any order. */
export const sameNames = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((name) => b.includes(name));

/** The deck as the host wants it: Main and Extra only (Side never counts), a Deck Master only in Domain. Capped, so a long list is not refused. */
export function bridgeDeck(deck: { main: readonly number[]; extra: readonly number[] }, deckMaster: number | null | undefined): BridgeDeck {
  const master = deckMaster != null ? 1 : 0;
  const main = deck.main.slice(0, MAX_DECK_IDS - master);
  const extra = deck.extra.slice(0, MAX_DECK_IDS - master - main.length);
  return { main: [...main], extra: [...extra], ...(master ? { deckMaster: deckMaster! } : {}) };
}

/** One key for a request. The order of the cards does not matter. */
export function enginesKey(query: BridgeEnginesRequest): { deck: string; rest: string } {
  const sorted = (codes: readonly number[]) => [...codes].sort((a, b) => a - b).join(",");
  const deck = query.deck ? `${sorted(query.deck.main)}|${sorted(query.deck.extra)}|${query.deck.deckMaster ?? 0}` : "";
  return { deck, rest: JSON.stringify([query.format, query.engines ?? null, query.deck ? null : query.genesysRemaining ?? null]) };
}

/**
 * The engines of a deck with the player's edits on top. Removed engines go, added ones join at the end, and the set
 * never passes four.
 */
export function applyEdits(found: readonly string[], edits: EngineEdits): string[] {
  const removed = new Set(edits.removed);
  const kept = found.filter((name) => !removed.has(name));
  return [...new Set([...kept, ...edits.added])].slice(0, MAX_ENGINES);
}

/** The groups the deck holds that are not in the set: "Also in deck". */
export function lightEngines(detected: readonly DetectedEngine[] | undefined, set: readonly string[]): DetectedEngine[] {
  const have = new Set(set);
  return (detected ?? []).filter((engine) => !have.has(engine.name));
}

export function toggleEngine(edits: EngineEdits, found: readonly string[], name: string, on: boolean): EngineEdits {
  const inFound = found.includes(name);
  const without = (list: string[]) => list.filter((item) => item !== name);
  if (on) return inFound ? { ...edits, removed: without(edits.removed) } : { ...edits, added: [...without(edits.added), name] };
  return inFound ? { ...edits, removed: [...without(edits.removed), name] } : { ...edits, added: without(edits.added) };
}

export const hasEdits = (edits: EngineEdits) => edits.added.length > 0 || edits.removed.length > 0;

/** The format of the host for the editor's mode. */
export const bridgeFormat = (genesys: boolean): BridgeFormat => (genesys ? "genesys" : "advanced");
