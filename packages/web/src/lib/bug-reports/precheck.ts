import type { BugReport } from "@yugidraft/shared/services";
import { issueTitle, redactText } from "../bug-report";
import type { DuplicateCandidate } from "./similarity";

export const PRECHECK_LIMIT = { max: 30, windowMs: 10 * 60_000 } as const;
/** A report from the same duel counts as "the same moment" when it is on the same turn or this recent. */
export const SAME_DUEL_WINDOW_MS = 10 * 60_000;

const hits = new Map<string, number[]>();

/** In-memory limit of pre-checks per player (30 in 10 minutes). The report route has its own, stricter, saved limit. */
export function takePrecheckSlot(key: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const recent = (hits.get(key) ?? []).filter((at) => now - at < PRECHECK_LIMIT.windowMs);
  if (recent.length >= PRECHECK_LIMIT.max) {
    hits.set(key, recent);
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0]! + PRECHECK_LIMIT.windowMs - now) / 1000)) };
  }
  recent.push(now);
  hits.set(key, recent);
  return { ok: true };
}

export function resetPrecheckLimit(): void {
  hits.clear();
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
