import type { BridgeScope, DeepStep, ShownBridge } from "@/lib/bridges-api";

/** How often a running search is asked for its progress. */
export const DEEP_POLL_MS = 1000;
/** Poll answers that fail in a row before the search shows an error. The job itself keeps running on the host. */
export const DEEP_POLL_FAILURES = 3;

export const DEEP_STEPS: readonly { id: Exclude<DeepStep, "done">; label: string }[] = [
  { id: "candidates", label: "Finding candidates" },
  { id: "checking", label: "Checking cards" },
  { id: "rating", label: "Rating" },
];

/**
 * What a deep search does on the host: the set of engines (in any order) and the format, or one source with its target.
 * The deck and the points are not part of it, so a deck edit never loses a running search.
 */
export function deepWorkKey(scope: BridgeScope): string {
  if (scope.engines && scope.engines.length > 0) return JSON.stringify(["multi", scope.engines.map((name) => name.toLowerCase()).sort(), scope.format]);
  return JSON.stringify([scope.source.toLowerCase(), scope.target?.toLowerCase() ?? "", scope.format]);
}

/** The order-free text of a deck's cards. */
export function deckSignature(deck: { main: readonly number[]; extra: readonly number[]; deckMaster?: number } | undefined): string {
  if (!deck) return "";
  const sorted = (codes: readonly number[]) => [...codes].sort((a, b) => a - b).join(",");
  return `${sorted(deck.main)}|${sorted(deck.extra)}|${deck.deckMaster ?? 0}`;
}

/**
 * What the results of a deep search are measured against: the cards the deck holds and the points left. The host
 * keeps this per player, so the same search shows other "cards to add" for another deck.
 */
export function deepContextKey(scope: BridgeScope): string {
  return JSON.stringify([deckSignature(scope.deck), scope.format === "genesys" ? scope.genesysRemaining ?? -1 : -1]);
}

export function stepIndex(step: DeepStep): number {
  const index = DEEP_STEPS.findIndex((entry) => entry.id === step);
  return index < 0 ? DEEP_STEPS.length : index;
}

/** "45 s" or "1 min 5 s", for a countdown. */
export function countdownText(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return whole < 60 ? `${whole} s` : `${Math.floor(whole / 60)} min ${whole % 60} s`;
}

export function secondsLeft(until: number | null, now: number): number {
  return until == null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}

/**
 * A package the deck already holds is not a recommendation: it goes below the recommended rows, in the order it came.
 * Rows without the flag (an answer without deck context) count as recommended.
 */
export function actionableFirst<T extends { alreadyInDeck?: boolean }>(rows: readonly T[]): T[] {
  return [...rows.filter((row) => !row.alreadyInDeck), ...rows.filter((row) => row.alreadyInDeck)];
}

/**
 * Every distinct card of the bridges, in the order they are shown. All of them are loaded, not the first few: the
 * line names its cards, not their codes, so a name is found by its loaded card and may sit anywhere in the list.
 */
export function bridgeCodes(bridges: readonly ShownBridge[]): number[] {
  return [...new Set(bridges.flatMap((bridge) => bridge.cards))];
}

/** The printed evidence of a bridge card: the first reason that names it. */
export function evidenceFor(bridge: ShownBridge, code: number): string {
  for (const reason of bridge.reasons) {
    const at = reason.cards.indexOf(code);
    if (at >= 0) return reason.evidence[at] || reason.description;
  }
  return "";
}

/** One short sentence for the "why" under a card of the details list. */
export function roleFor(bridge: ShownBridge, code: number): string {
  for (const reason of bridge.reasons) if (reason.cards.includes(code)) return reason.description;
  return "";
}

// Browser storage holds only per-viewer conveniences. Every call can throw (private window, blocked data), so none is trusted.
export function readStore(kind: "session" | "local", key: string): string | null {
  try { return (kind === "session" ? window.sessionStorage : window.localStorage).getItem(key); } catch { return null; }
}
export function writeStore(kind: "session" | "local", key: string, value: string | null): void {
  try {
    const store = kind === "session" ? window.sessionStorage : window.localStorage;
    if (value == null) store.removeItem(key); else store.setItem(key, value);
  } catch { /* Not saved. The page works without it. */ }
}

const REPORTED_KEY = "bridges:reported";
const REPORTED_MAX = 300;

export function reportedBridges(): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(readStore("local", REPORTED_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch { return new Set(); }
}
export function rememberReported(evidenceHash: string): void {
  const next = [...[...reportedBridges()].filter((item) => item !== evidenceHash), evidenceHash].slice(-REPORTED_MAX);
  writeStore("local", REPORTED_KEY, JSON.stringify(next));
}
