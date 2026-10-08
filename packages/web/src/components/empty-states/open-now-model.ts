/** What the empty states show from `GET /api/lobby/open`. Pure, so it is easy to test. */
import { EMPTY_OPEN_NOW, type OpenNow } from "@/lib/open-now";

/** The most join rows one list shows. The API sends at most 5 of each kind. */
export const OPEN_ROWS_MAX = 5;
/** More seats than this and the row says "N joined" instead of drawing them. */
const SEAT_STRIP_MAX = 12;

/** Where each empty state sends people. */
export const OPEN_ROUTES = {
  challenge: "/duels/new?challenge=1",
  watch: "/duels",
  newTournament: "/tournaments/new",
  newDraft: "/drafts/new",
  newDeck: "/decks/new",
  tournaments: "/tournaments",
} as const;

export type OpenRow = {
  key: string;
  kind: "tournament" | "draft";
  name: string;
  href: string;
  /** Short facts under the name, in order. */
  meta: string[];
  /** Taken and total seats, when the draft has a known size. */
  seats: { taken: number; total: number } | null;
  /** The button label. The list decides which row's button is primary. */
  action: string;
};

export type OpenWatch = { label: string; href: string; hint: string };

export type OpenRows = {
  /** Tournaments and drafts to join, newest first. */
  join: OpenRow[];
  /** Duels in progress, as one row. */
  watch: OpenWatch | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Checks an API answer and returns it as `OpenNow`, or null when any part has the wrong shape. */
export function parseOpenNow(value: unknown): OpenNow | null {
  if (!isRecord(value) || !Array.isArray(value.tournaments) || !Array.isArray(value.drafts) || !isCount(value.duelsInProgress)) return null;
  const tournaments: OpenNow["tournaments"] = [];
  for (const item of value.tournaments) {
    if (!isRecord(item) || typeof item.slug !== "string" || !item.slug || typeof item.name !== "string" || typeof item.format !== "string"
      || !isCount(item.joinedCount) || typeof item.viewerJoined !== "boolean") return null;
    tournaments.push({ slug: item.slug, name: item.name, format: item.format, joinedCount: item.joinedCount, viewerJoined: item.viewerJoined });
  }
  const drafts: OpenNow["drafts"] = [];
  for (const item of value.drafts) {
    if (!isRecord(item) || typeof item.slug !== "string" || !item.slug || typeof item.name !== "string" || typeof item.mode !== "string"
      || !isCount(item.seatsTaken) || !(item.seatCount === null || isCount(item.seatCount)) || typeof item.viewerJoined !== "boolean") return null;
    drafts.push({ slug: item.slug, name: item.name, mode: item.mode, seatsTaken: item.seatsTaken, seatCount: item.seatCount, viewerJoined: item.viewerJoined });
  }
  return { tournaments, drafts, duelsInProgress: Math.floor(value.duelsInProgress) };
}

export function tournamentFormat(format: string): string {
  if (format === "round_robin") return "Round robin";
  if (format === "single_elim" || format === "single_elimination") return "Single elimination";
  const words = format.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Tournament";
}

export function draftKind(mode: string): string {
  return mode === "theme" ? "Theme draft" : "Cube draft";
}

export function seatsLabel(taken: number, total: number | null): string {
  return total === null ? `${taken} joined` : `${taken} of ${total} seats`;
}

export type OpenKind = "tournaments" | "drafts";

/**
 * Rows for one page. `kinds` says which join rows the page may show (the Tournaments page has none
 * of its own to show, so it passes only drafts). Rows the viewer already joined belong on the "Your"
 * lists, so they are left out.
 */
export function openNowRows(data: OpenNow, kinds: ReadonlyArray<OpenKind> = ["tournaments", "drafts"]): OpenRows {
  const join: OpenRow[] = [];
  if (kinds.includes("tournaments")) {
    for (const t of data.tournaments) {
      if (t.viewerJoined) continue;
      join.push({
        key: `t-${t.slug}`,
        kind: "tournament",
        name: t.name,
        href: `/tournament/${t.slug}`,
        meta: [tournamentFormat(t.format), `${t.joinedCount} joined`],
        seats: null,
        action: "Join tournament",
      });
    }
  }
  if (kinds.includes("drafts")) {
    for (const d of data.drafts) {
      if (d.viewerJoined) continue;
      const strip = d.seatCount !== null && d.seatCount > 0 && d.seatCount <= SEAT_STRIP_MAX;
      join.push({
        key: `d-${d.slug}`,
        kind: "draft",
        name: d.name,
        href: `/draft/${d.slug}`,
        meta: [draftKind(d.mode), seatsLabel(d.seatsTaken, d.seatCount)],
        seats: strip ? { taken: Math.min(d.seatsTaken, d.seatCount!), total: d.seatCount! } : null,
        action: "Join draft",
      });
    }
  }
  const duels = data.duelsInProgress;
  return {
    join: join.slice(0, OPEN_ROWS_MAX),
    watch: duels > 0
      ? { label: duels === 1 ? "1 duel in progress" : `${duels} duels in progress`, href: OPEN_ROUTES.watch, hint: "Open the lobby to watch" }
      : null,
  };
}

/** Something to show: a row to join or a duel to watch. */
export function hasOpenRows(rows: OpenRows): boolean {
  return rows.join.length > 0 || rows.watch !== null;
}

export { EMPTY_OPEN_NOW };
