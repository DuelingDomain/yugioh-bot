// Leak scan: did a player's browser receive the code of a card that this seat may not know?
// This file has no Playwright import, so `node --test` can check it (see tests-unit/).
//
// How it works
// - The truth comes from the engine. `replay-journal.ts --json` replays the duel journal and prints, per viewer
//   (each seat and the spectator), every card code that appeared anywhere in that viewer's own engine view
//   during the whole duel (`known`), the step where each code first appeared (`knownStep`), and the card codes of
//   every seat's decks (`decks`).
// - A code is SECRET for a viewer when it is in a deck of ANOTHER seat and is not in the viewer's `known` set.
//   The engine never sent such a code to that viewer, so it must not reach the viewer's browser.
// - A code that became public later (a card played face-up) is secret until then: the browser must not have
//   received it before `knownSince`, the time of the journal answer after which the engine view first held it,
//   minus `SINCE_TOLERANCE_MS` (journal times have a resolution of one second).
// - The recorder keeps every number of 5 to 10 digits that arrives in a WebSocket frame or in the room JSON
//   (`NumberCapture`). Frames are scanned whole, not the clipped text in evidence-<key>.json.
// - Leak = a secret code that the browser received.
//
// Limits (on purpose, so a failure is never a false alarm about a legal reveal)
// - The clock of the journal has a resolution of 1 s, so a leak that is less than 2 s before the reveal is not reported.
// - Deck Master codes are public by design and are not secret.
// - `myDeck` and `deckMaster` keys of the room JSON are removed before the scan: the page shows your own deck list.
// - A card that appears by name only (no code) is not found. The engine fuzz test (tests/fuzz/invariants.ts) checks names.

export type Viewer = number | "spectator";

export interface LeakTruth {
  /** Card codes of each seat's decks (main, extra, side). Index is the seat. */
  decks: number[][];
  /** Deck Master codes (public by design). */
  deckMasters?: number[];
  /** Codes seen in a viewer's engine view during the whole duel. Keys: "0".."3" and "spectator". */
  known: Record<string, number[]>;
  /** Per viewer, per code: epoch ms before which the viewer must not hold the code. Missing = use `known` (always public). */
  knownSince?: Record<string, Record<string, number>>;
}

export const SINCE_TOLERANCE_MS = 2000;

/**
 * Turns the replay output (`knownStep`: first step of each code) into times, using the journal answer times.
 * Step n means "after the n-th answer", so its time is the time of answer n (index n-1). Step 0 has no limit.
 */
export function knownSinceFromSteps(knownStep: Record<string, Record<string, number>>, answerTimes: number[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [viewer, codes] of Object.entries(knownStep)) {
    out[viewer] = {};
    for (const [code, step] of Object.entries(codes)) {
      const time = step <= 0 ? -Infinity : (answerTimes[step - 1] ?? answerTimes.at(-1) ?? 0) - SINCE_TOLERANCE_MS;
      out[viewer][code] = time;
    }
  }
  return out;
}

export interface NumberHit {
  source: "ws" | "room" | "http";
  at: string;
  ms: number;
  /** Text around the first match. */
  context: string;
  count: number;
}

const CODE = /(?<![\d.])\d{5,10}(?![\d])/g;
const CONTEXT = 70;
const MAX_NUMBERS = 20_000;

/** Removes keys that legally show the viewer's own deck. */
export function stripOwnDeck(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripOwnDeck);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === "myDeck" || key === "deckMaster") continue;
      out[key] = stripOwnDeck(item);
    }
    return out;
  }
  return value;
}

/** All numbers of 5 to 10 digits in a text, each with the text around its first place. */
export function scanNumbers(text: string): Array<{ code: number; context: string }> {
  const found: Array<{ code: number; context: string }> = [];
  for (const match of text.matchAll(CODE)) {
    const code = Number(match[0]);
    const start = Math.max(0, (match.index ?? 0) - CONTEXT);
    found.push({ code, context: text.slice(start, (match.index ?? 0) + match[0].length + CONTEXT).replace(/\s+/g, " ") });
  }
  return found;
}

/** Every number a player received. Memory stays small: one entry per distinct number. */
export class NumberCapture {
  readonly hits = new Map<number, NumberHit>();
  add(text: string, source: NumberHit["source"], at: string, ms: number): void {
    for (const { code, context } of scanNumbers(text)) {
      const old = this.hits.get(code);
      if (old) old.count += 1;
      else if (this.hits.size < MAX_NUMBERS) this.hits.set(code, { source, at, ms, context, count: 1 });
    }
  }
  addRoom(body: unknown, at: string, ms: number): void {
    this.add(JSON.stringify(stripOwnDeck(body)), "room", at, ms);
  }
}

/** Codes of other seats' decks that the viewer never held at any time of the duel. */
export function secretCodes(truth: LeakTruth, viewer: Viewer): Set<number> {
  const known = new Set(truth.known[String(viewer)] ?? []);
  const masters = new Set(truth.deckMasters ?? []);
  const secret = new Set<number>();
  truth.decks.forEach((codes, seat) => {
    if (viewer === seat) return;
    for (const code of codes) if (!known.has(code) && !masters.has(code)) secret.add(code);
  });
  return secret;
}

export interface Leak {
  player: string;
  viewer: Viewer;
  code: number;
  source: NumberHit["source"];
  at: string;
  ms: number;
  count: number;
  context: string;
  /** The seats whose decks hold this code. */
  ownerSeats: number[];
  /** ISO time from which the viewer may hold the code, or null when the code was never public to it. */
  publicFrom: string | null;
}

export function findLeaks(player: string, viewer: Viewer, capture: NumberCapture, truth: LeakTruth): Leak[] {
  const masters = new Set(truth.deckMasters ?? []);
  const known = new Set(truth.known[String(viewer)] ?? []);
  const since = truth.knownSince?.[String(viewer)] ?? {};
  const leaks: Leak[] = [];
  for (const [code, hit] of capture.hits) {
    if (masters.has(code)) continue;
    const ownerSeats = truth.decks.flatMap((codes, seat) => (seat !== viewer && codes.includes(code) ? [seat] : []));
    if (ownerSeats.length === 0) continue;
    const neverPublic = !known.has(code);
    const from = since[String(code)];
    const early = !neverPublic && from !== undefined && Date.parse(hit.at) < from;
    if (!neverPublic && !early) continue;
    leaks.push({ player, viewer, code, source: hit.source, at: hit.at, ms: hit.ms, count: hit.count, context: hit.context, ownerSeats, publicFrom: neverPublic || from === undefined ? null : new Date(from + SINCE_TOLERANCE_MS).toISOString() });
  }
  return leaks.sort((a, b) => a.ms - b.ms);
}

export function leakMessage(leak: Leak): string {
  return `Hidden card leak: ${leak.player} (${leak.viewer === "spectator" ? "spectator" : `seat ${leak.viewer}`}) received code ${leak.code}, which is in the deck of seat ${leak.ownerSeats.join(", ")} and ${leak.publicFrom ? `became public to this viewer only at ${leak.publicFrom}` : "was never public to this viewer"}. First seen in ${leak.source} at +${leak.ms} ms: ...${leak.context}...`;
}
