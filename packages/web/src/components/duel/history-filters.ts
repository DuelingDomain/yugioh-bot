import { isDuelFormat, type DuelFormat, type DuelHistoryScope } from "@yugidraft/shared/duels";

/**
 * Match history filters. `from` and `to` hold the local `datetime-local` text of the inputs
 * ("2026-10-10T21:42"); they become ISO instants only when the API query is built.
 */
export interface HistoryFilters {
  from: string;
  to: string;
  /** Empty means any format. */
  format: DuelFormat | "";
  /** Empty means any status. */
  status: HistoryStatus | "";
  /** Duel name or player name. */
  q: string;
  /** Card name. */
  card: string;
}

export type HistoryStatus = "completed" | "interrupted" | "cancelled";

const HISTORY_STATUSES: readonly string[] = ["completed", "interrupted", "cancelled"];

export const EMPTY_HISTORY_FILTERS: HistoryFilters = { from: "", to: "", format: "", status: "", q: "", card: "" };

export type HistoryPreset = "today" | "yesterday" | "week";

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function read(source: ParamSource, key: string): string {
  const value = source instanceof URLSearchParams ? source.get(key) : source[key];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/** Accepts only the text a `datetime-local` input can hold ("2026-10-10T21:42"). Anything else means no filter. */
function validLocalDate(text: string): string {
  return LOCAL_DATE.test(text) && !Number.isNaN(new Date(text).getTime()) ? text : "";
}

/** Reads the scope and filters from page search params. Unknown or bad values fall back to "no filter". */
export function parseHistoryParams(source: ParamSource): { scope: DuelHistoryScope; filters: HistoryFilters } {
  const format = read(source, "format");
  const status = read(source, "status");
  return {
    scope: read(source, "scope") === "all" ? "all" : "mine",
    filters: {
      from: validLocalDate(read(source, "from")),
      to: validLocalDate(read(source, "to")),
      format: isDuelFormat(format) ? format : "",
      status: HISTORY_STATUSES.includes(status) ? (status as HistoryStatus) : "",
      q: read(source, "q").trim(),
      card: read(source, "card").trim(),
    },
  };
}

export function hasHistoryFilters(filters: HistoryFilters): boolean {
  return Object.values(filters).some((value) => value !== "");
}

/** Ends the typed minute at its last millisecond so "to 21:42" includes duels that ended at 21:42:30. */
function toIsoEnd(local: string): string | null {
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? null : new Date(date.getTime() + 59_999).toISOString();
}

function toIsoStart(local: string): string | null {
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Query string of `GET /api/duels` for Match history. The key order is stable so SWR keys match. */
export function historyQuery(scope: DuelHistoryScope, filters: HistoryFilters = EMPTY_HISTORY_FILTERS, cursor?: string | null): string {
  const query = new URLSearchParams({ archived: "1", scope });
  const from = filters.from ? toIsoStart(filters.from) : null;
  const to = filters.to ? toIsoEnd(filters.to) : null;
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  if (filters.format) query.set("format", filters.format);
  // The server applies the status filter only for an admin on All, so Mine never sends it.
  if (filters.status && scope === "all") query.set("status", filters.status);
  if (filters.q.trim()) query.set("q", filters.q.trim());
  if (filters.card.trim()) query.set("card", filters.card.trim());
  if (cursor) query.set("cursor", cursor);
  return query.toString();
}

/** Page URL search for the lobby, so a filtered list can be bookmarked. Live view has no params. */
export function lobbySearch(history: boolean, scope: DuelHistoryScope, filters: HistoryFilters): string {
  if (!history) return "";
  const query = new URLSearchParams({ view: "history" });
  if (scope === "all") query.set("scope", "all");
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);
  if (filters.format) query.set("format", filters.format);
  if (filters.status && scope === "all") query.set("status", filters.status);
  if (filters.q.trim()) query.set("q", filters.q.trim());
  if (filters.card.trim()) query.set("card", filters.card.trim());
  return `?${query.toString()}`;
}

const LOBBY_PARAMS = ["view", "scope", "from", "to", "format", "status", "q", "card"];

/**
 * The page search after the lobby writes its own params: other params of the page (such as a future `?invite=`)
 * stay as they are, and the Live view removes only the params the lobby owns.
 */
export function mergeLobbySearch(current: string, history: boolean, scope: DuelHistoryScope, filters: HistoryFilters): string {
  const next = new URLSearchParams(lobbySearch(history, scope, filters));
  for (const [key, value] of new URLSearchParams(current)) {
    if (!LOBBY_PARAMS.includes(key)) next.append(key, value);
  }
  const text = next.toString();
  return text ? `?${text}` : "";
}

const HISTORY_SEARCH_STORAGE = "duels.history-search";

/**
 * Remembers the last Match history search so the replay page can link back to the same filters.
 * The signed-in user is stored with it: another user in the same tab must not get this search.
 */
export function rememberHistorySearch(search: string, viewerId?: number | string): void {
  try {
    window.sessionStorage.setItem(HISTORY_SEARCH_STORAGE, JSON.stringify({ viewer: String(viewerId ?? ""), search }));
  } catch {
    // Storage can be blocked; the link then goes to the plain Match history.
  }
}

/** Link to Match history with the filters the user last used. Bad stored text falls back to the plain view. */
export function savedHistoryHref(viewerId?: number | string): string {
  try {
    const stored = window.sessionStorage.getItem(HISTORY_SEARCH_STORAGE);
    if (!stored) return "/duels?view=history";
    const saved: unknown = JSON.parse(stored);
    if (typeof saved !== "object" || saved === null) return "/duels?view=history";
    const { viewer, search } = saved as { viewer?: unknown; search?: unknown };
    // A search saved by another user, or a bad value, is ignored.
    if (typeof search !== "string" || viewer !== String(viewerId ?? "")) return "/duels?view=history";
    const { scope, filters } = parseHistoryParams(new URLSearchParams(search));
    return `/duels${lobbySearch(true, scope, filters)}`;
  } catch {
    return "/duels?view=history";
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `datetime-local` text of a date in local time. */
export function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The from/to range of a quick chip. Today and Last 7 days stay open at the end. */
export function presetRange(preset: HistoryPreset, now: Date = new Date()): Pick<HistoryFilters, "from" | "to"> {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === "today") return { from: toLocalInput(startOfToday), to: "" };
  if (preset === "yesterday") {
    // Build the date from its parts: setDate on a gap day (no local midnight) would keep the 01:00 hour.
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return { from: toLocalInput(start), to: toLocalInput(new Date(startOfToday.getTime() - 60_000)) };
  }
  const start = new Date(now);
  start.setDate(start.getDate() - 7);
  return { from: toLocalInput(start), to: "" };
}
