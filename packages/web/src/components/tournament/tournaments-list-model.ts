/** Grouping and labels for the tournaments list (/tournaments). Pure, so it is easy to test. */

export interface TournamentListItem {
  id: number;
  name: string;
  format: string;
  status: string;
  participantCount: number;
  webSlug?: string;
}

export interface TournamentGroups {
  running: TournamentListItem[];
  open: TournamentListItem[];
  finished: TournamentListItem[];
}

/**
 * Splits rows into running (active), open (pending) and finished (completed).
 * Each group keeps the order of the input, which the page query already sorts newest first.
 * Anything else (cancelled, unknown) stays off the list.
 */
export function groupTournaments(items: TournamentListItem[]): TournamentGroups {
  return {
    running: items.filter((t) => t.status === "active"),
    open: items.filter((t) => t.status === "pending"),
    finished: items.filter((t) => t.status === "completed"),
  };
}

export function tournamentHref(t: Pick<TournamentListItem, "id" | "webSlug">): string {
  return `/tournament/${t.webSlug ?? t.id}`;
}

export function formatLabel(format: string): string {
  if (format === "round_robin") return "Round robin";
  if (format === "single_elim") return "Single elimination";
  return format;
}

export function playersLabel(count: number): string {
  return `${count} ${count === 1 ? "player" : "players"}`;
}

/** The header line: "2 in progress, 1 open to join, 14 finished". Zero counts are left out. */
export function listSummaryParts(groups: TournamentGroups): string[] {
  const parts: string[] = [];
  if (groups.running.length) parts.push(`${groups.running.length} in progress`);
  if (groups.open.length) parts.push(`${groups.open.length} open to join`);
  if (groups.finished.length) parts.push(`${groups.finished.length} finished`);
  return parts;
}

export const FINISHED_PREVIEW = 5;
