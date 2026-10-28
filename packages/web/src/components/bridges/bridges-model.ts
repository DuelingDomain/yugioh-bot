import type { BridgeScope, DeepStep, ShownBridge } from "./bridges-api";

/** A list shows this many bridges. */
export const BRIDGES_SHOWN = 4;
/** How often a running search is asked for its progress. */
export const DEEP_POLL_MS = 1000;
/** Poll answers that fail in a row before the search shows an error. The job itself keeps running on the host. */
export const DEEP_POLL_FAILURES = 3;

export const DEEP_STEPS: readonly { id: Exclude<DeepStep, "done">; label: string }[] = [
  { id: "candidates", label: "Finding candidates" },
  { id: "checking", label: "Checking cards" },
  { id: "rating", label: "Rating" },
];

export function scopeKey(scope: BridgeScope): string {
  return JSON.stringify([scope.source.toLowerCase(), scope.target?.toLowerCase() ?? "", scope.format, scope.format === "genesys" ? scope.genesysRemaining ?? -1 : -1]);
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

/** Every distinct card of the bridges, in the order they are shown. */
export function bridgeCodes(bridges: readonly ShownBridge[], perBridge = 4): number[] {
  return [...new Set(bridges.flatMap((bridge) => bridge.cards.slice(0, perBridge)))];
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
