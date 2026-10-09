/** Row model for the drafts list (/drafts). Pure, so it is easy to test. */
import { effectiveDraftNumbers, mainDraftPicksPerPlayer } from "@yugidraft/shared/types";
import type { ListStatusCounts } from "@yugidraft/shared/services";
import type { StageStep } from "@/components/sheet";
import { formatPickSeconds } from "../pick-time";

export interface DraftListConfig {
  mode: "booster" | "theme";
  packsPerPlayer: number;
  packSize: number;
  pickSeconds: number;
  cardsPerPlayer: number;
  extraDeckEnabled: boolean;
  extraDeckSize: number;
}

/**
 * The setup a row knows about. The page parses the whole of config_json, so its rows carry every field.
 * Older rows appended from `/api/drafts` can know only the mode, so the other fields can be missing, and the
 * row then leaves out whatever it would have to guess (the pack total, the pick time).
 */
export type DraftListSetup = Pick<DraftListConfig, "mode"> & Partial<Omit<DraftListConfig, "mode">>;

/** What the page reads from the drafts table (config_json already parsed with `parseDraftConfig`). */
export interface DraftListItem {
  id: number;
  name: string;
  status: string;
  webSlug?: string;
  playerCount: number;
  /** drafts.current_wave_number, one-based: the pack (cube) or the global round (theme). */
  wave: number;
  /** drafts.current_pick_step, one-based pick inside the pack. */
  pick: number;
  createdAt?: string;
  endedAt?: string;
  config: DraftListSetup;
}

export interface DraftGroups {
  live: DraftListItem[];
  waiting: DraftListItem[];
  /** Completed and cancelled, newest first by ended_at ?? created_at. */
  finished: DraftListItem[];
}

// The same fallbacks the draft service applies to a saved setup.
const DEFAULTS: DraftListConfig = {
  mode: "booster",
  packsPerPlayer: 5,
  packSize: 8,
  pickSeconds: 45,
  cardsPerPlayer: 40,
  extraDeckEnabled: true,
  extraDeckSize: 15,
};

function posInt(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}

export function parseDraftConfig(json: string | null | undefined, status = "pending"): DraftListConfig {
  let raw: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(json ?? "{}");
    if (parsed && typeof parsed === "object") raw = parsed as Record<string, unknown>;
  } catch {
    // malformed config_json: use defaults
  }
  const config: DraftListConfig = {
    mode: raw.mode === "theme" ? "theme" : "booster",
    packsPerPlayer: posInt(raw.packsPerPlayer, DEFAULTS.packsPerPlayer),
    packSize: posInt(raw.packSize, DEFAULTS.packSize),
    pickSeconds: posInt(raw.pickSeconds, DEFAULTS.pickSeconds),
    cardsPerPlayer: posInt(raw.cardsPerPlayer, DEFAULTS.cardsPerPlayer),
    extraDeckEnabled: typeof raw.extraDeckEnabled === "boolean" ? raw.extraDeckEnabled : raw.mode === "theme",
    extraDeckSize: posInt(raw.extraDeckSize, DEFAULTS.extraDeckSize),
  };
  return { ...config, ...effectiveDraftNumbers(config, status !== "pending") };
}

/** One draft as `/api/drafts` returns it (the setup is left out; dates are UTC ISO strings). */
export interface DraftApiItem {
  id: number;
  name: string;
  status: string;
  mode?: "booster" | "theme";
  config?: DraftListConfig;
  webSlug?: string;
  currentPackRound: number;
  currentPickStep: number;
  playerCount: number;
  createdAt?: string;
  endedAt?: string;
}

/**
 * The one adapter from an API row to a page row. The API names the stage `currentPackRound` and
 * `currentPickStep` (the page: `wave`, `pick`); its UTC dates already parse with `parseDbDate`.
 * New payloads carry effective setup; older payloads still work with only the mode.
 */
export function draftFromApi(item: DraftApiItem): DraftListItem {
  return {
    id: item.id,
    name: item.name,
    status: item.status,
    webSlug: item.webSlug ?? undefined,
    wave: item.currentPackRound,
    pick: item.currentPickStep,
    playerCount: item.playerCount,
    createdAt: item.createdAt ?? undefined,
    endedAt: item.endedAt ?? undefined,
    config: item.config ?? { mode: item.mode === "theme" ? "theme" : "booster" },
  };
}

export function kindLabel(config: Pick<DraftListConfig, "mode">): string {
  return config.mode === "theme" ? "Theme draft" : "Cube draft";
}

export function playersLabel(count: number): string {
  return `${count} ${count === 1 ? "player" : "players"}`;
}

export function pickLabel(seconds: number | undefined): string | null {
  return seconds !== undefined && seconds > 0 ? `${formatPickSeconds(seconds)} a pick` : null;
}

export function draftHref(d: Pick<DraftListItem, "webSlug">): string | null {
  return d.webSlug ? `/draft/${d.webSlug}` : null;
}

function stamp(d: DraftListItem): number {
  const t = parseDbDate(d.endedAt ?? d.createdAt);
  return t ? t.getTime() : 0;
}

export function groupDrafts(items: DraftListItem[]): DraftGroups {
  return {
    live: items.filter((d) => d.status === "active"),
    waiting: items.filter((d) => d.status === "pending"),
    finished: items
      .filter((d) => d.status === "completed" || d.status === "cancelled")
      .sort((a, b) => stamp(b) - stamp(a)),
  };
}

/** The header line after "Drafts you're in": "1 live", "2 waiting to start", "6 finished". Zero counts are left out. */
export function listSummaryParts(groups: DraftGroups): string[] {
  return listSummaryPartsFromCounts({ active: groups.live.length, pending: groups.waiting.length, completed: groups.finished.length, cancelled: 0 });
}

/** Uses full-list counts when the page's rows are paginated. */
export function listSummaryPartsFromCounts(counts: ListStatusCounts): string[] {
  const parts: string[] = [];
  if (counts.active) parts.push(`${counts.active} live`);
  if (counts.pending) parts.push(`${counts.pending} waiting to start`);
  const finished = counts.completed + counts.cancelled;
  if (finished) parts.push(`${finished} finished`);
  return parts;
}

export interface LiveStages {
  /** Lobby is done; the draft is now; deck building is next. A theme draft with an Extra deck has a stage for it. */
  steps: StageStep[];
  /** Where the draft is, as one quiet line: "Pack 2 of 3, pick 4" or "Round 41 of 55, Extra deck". */
  caption: string;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

export function liveStages(d: DraftListItem): LiveStages {
  const c = d.config;
  const wave = Math.max(d.wave, 1);
  const lobbyToBuild = (draftLabel: string): StageStep[] => [
    { label: "Lobby", state: "done" },
    { label: draftLabel, state: "now" },
    { label: "Build deck", state: "next" },
  ];
  if (c.mode === "theme") {
    if (c.cardsPerPlayer === undefined || c.extraDeckEnabled === undefined || c.extraDeckSize === undefined) {
      // A row without its setup cannot tell main deck from Extra deck, or name the last round.
      return { steps: lobbyToBuild("Draft"), caption: `Round ${wave}` };
    }
    const withExtra = c.extraDeckEnabled && c.extraDeckSize > 0;
    const main = mainDraftPicksPerPlayer(c);
    const total = Math.max(main + (withExtra ? c.extraDeckSize : 0), 1);
    const round = clamp(d.wave, 1, total);
    const inExtra = withExtra && round > main;
    const steps: StageStep[] = [
      { label: "Lobby", state: "done" },
      { label: "Main deck", state: inExtra ? "done" : "now" },
      ...(withExtra ? [{ label: "Extra deck", state: inExtra ? ("now" as const) : ("next" as const) }] : []),
      { label: "Build deck", state: "next" },
    ];
    return { steps, caption: `Round ${round} of ${total}, ${inExtra ? "Extra deck" : "main deck"}` };
  }
  const pick = Math.max(d.pick, 1);
  if (c.packsPerPlayer === undefined) return { steps: lobbyToBuild("Draft"), caption: `Pack ${wave}, pick ${pick}` };
  const packs = Math.max(c.packsPerPlayer, 1);
  return { steps: lobbyToBuild("Draft"), caption: `Pack ${clamp(d.wave, 1, packs)} of ${packs}, pick ${pick}` };
}

/** SQLite stores "YYYY-MM-DD HH:MM:SS" (UTC); the draft service writes ISO strings. Both parse here. */
export function parseDbDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Thu, Oct 1" with `weekday`, "Sep 28" without. UTC, so server and browser agree. */
export function formatDay(value: string | null | undefined, weekday = false): string | null {
  const d = parseDbDate(value);
  if (!d) return null;
  return d.toLocaleDateString("en-US", {
    ...(weekday ? { weekday: "short" as const } : {}),
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export const FINISHED_PREVIEW = 10;
