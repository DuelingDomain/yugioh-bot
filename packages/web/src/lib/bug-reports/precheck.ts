import type { BugReport } from "@yugidraft/shared/services";
import { issueTitle, redactText } from "../bug-report";
import type { DuplicateCandidate } from "./similarity";

export const PRECHECK_LIMIT = { max: 30, windowMs: 10 * 60_000 } as const;
export const DUPLICATE_CHECK_LIMIT = { max: 10, windowMs: 10 * 60_000 } as const;
/** A report from the same duel counts as "the same moment" when it is on the same turn or this recent. */
export const SAME_DUEL_WINDOW_MS = 10 * 60_000;

type SlotResult = { ok: true } | { ok: false; retryAfterSeconds: number };
type Slots = Map<string, number[]>;

function take(slots: Slots, key: string, limit: { max: number; windowMs: number }, now: number): SlotResult {
  const recent = (slots.get(key) ?? []).filter((at) => now - at < limit.windowMs);
  if (recent.length >= limit.max) {
    slots.set(key, recent);
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0]! + limit.windowMs - now) / 1000)) };
  }
  recent.push(now);
  slots.set(key, recent);
  return { ok: true };
}

const hits: Slots = new Map();
const duplicateHits: Slots = new Map();

/** In-memory limit of pre-checks per player (30 in 10 minutes). The report route has its own, stricter, saved limit. */
export function takePrecheckSlot(key: string, now = Date.now()): SlotResult {
  return take(hits, key, PRECHECK_LIMIT, now);
}

/**
 * In-memory limit of `duplicateOf` target checks per player (10 in 10 minutes). Each check asks GitHub about one issue,
 * and a refused one (409) is never saved, so the saved report limit cannot stop a player from using up the token's quota.
 */
export function takeDuplicateCheckSlot(key: string, now = Date.now()): SlotResult {
  return take(duplicateHits, key, DUPLICATE_CHECK_LIMIT, now);
}

export function resetPrecheckLimit(): void {
  hits.clear();
  duplicateHits.clear();
}

/** True when another player's report was made on the same turn of this duel, or in the last 10 minutes. */
export function isSameDuelMoment(row: BugReport, current: { turn?: number }, now = Date.now()): boolean {
  const rowTurn = (row.context as { turn?: unknown } | null)?.turn;
  if (typeof rowTurn === "number" && current.turn !== undefined && rowTurn === current.turn) return true;
  return now - Date.parse(row.createdAt) <= SAME_DUEL_WINDOW_MS;
}

/**
 * A saved report that owns an issue, as a duplicate candidate. Used when GitHub cannot be read. The title is built
 * the way the public issue title was, and the reporter's id, name and the guild id are removed from it.
 */
export function candidateFromRow(row: BugReport, issueUrl: string, redact: readonly string[]): DuplicateCandidate {
  const context = (row.context ?? {}) as Parameters<typeof issueTitle>[1];
  const title = redactText(issueTitle(row.description, context), redact);
  return {
    number: row.githubIssueNumber!,
    url: issueUrl,
    title,
    text: redactText(`${title} ${row.description.slice(0, 500)}`, redact),
    ...(context.format ? { format: context.format } : {}),
  };
}
