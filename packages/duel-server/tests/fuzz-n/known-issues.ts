import type { NFailure } from "./driver.js";

/**
 * Known failure classes of the N-seat fuzz: a class that is a real defect with a named owner task.
 * A run prints a known class apart from a new failure, and only a new failure makes the run exit 1
 * (`--strict` makes known ones fail too). Remove an entry when its owner task has landed and the class no longer shows.
 *
 * Plain data, no side effects: other tools (the triage issue registry) may import `KNOWN_ISSUES` read-only.
 */
export interface KnownIssueContext {
  format: string;
  /** Tag of the core build (B2, T3, ...), or its file name. */
  coreTag: string;
}

export interface KnownIssue {
  /** Stable signature of the class. Appears in failure files and in the run table. */
  sig: string;
  /** The task (or worker) that fixes the class. */
  owner: string;
  title: string;
  match(failure: NFailure, context: KnownIssueContext): boolean;
}

/** Cores whose tree already has T3's fix: T3 itself, the phase 2 merge (P2M) and trees built on it (D1). */
const HAS_T3_FIX = /^(T3|P2M|D1)(\b|[-_.])/;

export const KNOWN_ISSUES: readonly KnownIssue[] = [
  {
    sig: "b2-seat1-end-turn-hang",
    owner: "T3 (response cursor and turn hand-off)",
    title: "B2 and later cores until T3 lands: with more than two duelists, ocgcore never returns when seat 1 ends its turn (wasm loop inside duelProcess).",
    match: (failure, context) =>
      !HAS_T3_FIX.test(context.coreTag) &&
      failure.invariant === "hang" &&
      (failure.detail as { kind?: string } | undefined)?.kind === "wall-clock" &&
      failure.pending?.kind === "answer" &&
      failure.pending.seat === 1,
  },
  {
    sig: "tag-create-memory-oob",
    owner: "T3 (Tag seat setup; assumed, confirm)",
    title: "Tag duel: the core traps with 'memory access out of bounds' while it creates the duel (seed dependent, step 0).",
    match: (failure, context) =>
      context.format === "tag" &&
      failure.invariant === "engine-throw" &&
      /create: RuntimeError: memory access out of bounds/.test(failure.message),
  },
  {
    sig: "lua-1-tp-nil",
    owner: "F1 (phase 3 Lua fold of 1-tp)",
    title: "More than two duelists: a card script computes `1-tp` (for example Nibiru c27204311.lua:38) and gets no duelist for tp 2 or 3, so Lua reads nil.",
    match: (failure, context) =>
      context.format !== "1v1" &&
      failure.invariant === "engine-throw" &&
      /\.lua"\]:\d+: attempt to (compare|perform arithmetic on|index)\b.*\bnil\b/.test(failure.message),
  },
];

export function knownIssueFor(failure: NFailure, context: KnownIssueContext): KnownIssue | null {
  return KNOWN_ISSUES.find((issue) => issue.match(failure, context)) ?? null;
}
