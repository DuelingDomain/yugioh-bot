import { DEFAULT_GENESYS_POINT_CAP, defaultDuelSettings, NO_BANLIST_ID, type DuelBestOf, type DuelMode, type GenesysSettings } from "@yugidraft/shared/duels";
import { parseGenesysCap } from "../duel/genesys";
import { turnTimerLabel } from "../duel/turn-timer";
import type { DuelSeriesSummary, Match, TournamentDetail } from "./types";

/** The basic duel rules an organizer can set for a tournament. */
export interface DuelRulesValue {
  bestOf: DuelBestOf;
  mode: DuelMode;
  banlist: string;
  turnSeconds: number;
  /** Genesys format with its point cap; null is an ordinary tournament. Genesys has no banlist, so the banlist is "none". */
  genesys: GenesysSettings | null;
  /** What the point cap field shows while the organizer types; absent means the number of `genesys`. */
  capText?: string;
}

const TURN_SECONDS_CHOICES = [0, 60, 120, 180, 240, 300, 600];

export function defaultDuelRulesValue(): DuelRulesValue {
  const settings = defaultDuelSettings("normal");
  return { bestOf: 3, mode: "normal", banlist: settings.banlist, turnSeconds: settings.turnSeconds, genesys: null };
}

/** Turn time options; a stored value that is not in the list stays selectable. */
export function turnSecondsChoices(current: number): Array<{ value: number; label: string }> {
  const values = TURN_SECONDS_CHOICES.includes(current) ? TURN_SECONDS_CHOICES : [...TURN_SECONDS_CHOICES, current].sort((a, b) => a - b);
  return values.map((value) => ({
    value,
    label: turnTimerLabel(value),
  }));
}

/** Changing the mode also moves the banlist to that mode's default, like the duel creator. Genesys keeps "none". */
export function withMode(value: DuelRulesValue, mode: DuelMode): DuelRulesValue {
  if (mode === value.mode) return value;
  return { ...value, mode, banlist: value.genesys ? NO_BANLIST_ID : defaultDuelSettings(mode).banlist };
}

/** Turns Genesys on (default cap, no banlist) or off (the mode's default banlist again). */
export function withGenesys(value: DuelRulesValue, on: boolean): DuelRulesValue {
  if (on === (value.genesys != null)) return value;
  const { capText: _capText, ...rest } = value;
  return on
    ? { ...rest, banlist: NO_BANLIST_ID, genesys: { pointCap: DEFAULT_GENESYS_POINT_CAP } }
    : { ...rest, banlist: defaultDuelSettings(value.mode).banlist, genesys: null };
}

/** Types into the point cap field; a number that is not valid yet is kept as text and blocks saving. */
export function withGenesysCapText(value: DuelRulesValue, text: string): DuelRulesValue {
  const cap = parseGenesysCap(text);
  return cap.ok ? { ...value, genesys: { pointCap: cap.value }, capText: text } : { ...value, capText: text };
}

/** Why the rules cannot be saved yet, or null. Only the point cap field can be wrong. */
export function duelRulesProblem(value: DuelRulesValue): string | null {
  if (!value.genesys || value.capText == null) return null;
  const cap = parseGenesysCap(value.capText);
  return cap.ok ? null : cap.message;
}

/** The form value for a tournament; missing data falls back to the defaults. */
export function rulesValueFromTournament(tournament: Pick<TournamentDetail, "bestOf" | "duelRules">): DuelRulesValue {
  const base = defaultDuelRulesValue();
  const rules = tournament.duelRules;
  const genesys = rules?.settings?.genesys ?? null;
  return {
    bestOf: rules?.bestOf ?? tournament.bestOf ?? base.bestOf,
    mode: rules?.mode ?? base.mode,
    banlist: genesys ? NO_BANLIST_ID : (rules?.settings?.banlist ?? base.banlist),
    turnSeconds: rules?.settings?.turnSeconds ?? base.turnSeconds,
    genesys,
  };
}

/**
 * Body fields for `POST /api/tournaments` and `PATCH /api/tournaments/<slug>`. The settings carry `genesys` only when
 * the format is on, so an ordinary tournament sends the same body as before.
 */
export function buildRulesPayload(value: DuelRulesValue) {
  const settings = value.genesys
    ? { banlist: NO_BANLIST_ID, turnSeconds: value.turnSeconds, genesys: { pointCap: value.genesys.pointCap } }
    : { banlist: value.banlist, turnSeconds: value.turnSeconds };
  return {
    bestOf: value.bestOf,
    duelRules: {
      mode: value.mode,
      masterRule: 5 as const,
      settings,
    },
  };
}

/** A draft tournament keeps fixed rules (no banlist, pool decks only); only Best of can change. */
export function isDraftTournament(tournament: Pick<TournamentDetail, "draftId">): boolean {
  return tournament.draftId != null;
}

/** The rules lock once any slot has a series (the first tournament game started). */
export function rulesLocked(matches: Array<Pick<Match, "series">>): boolean {
  return matches.some((match) => match.series != null);
}

export type OpenDuelSeries = DuelSeriesSummary & { status: "active" | "between_games" };

export function isSeriesOpen(series: DuelSeriesSummary | null | undefined): series is OpenDuelSeries {
  return series != null && (series.status === "active" || series.status === "between_games");
}

/** Series wins in the order of the match card: [player one, player two]. */
export function seriesScore(series: DuelSeriesSummary, match: Pick<Match, "playerOneId">): [number, number] {
  return series.playerIds[0] === match.playerOneId ? [series.wins[0], series.wins[1]] : [series.wins[1], series.wins[0]];
}

/** Text for the game score of a series, or null when the series has nothing to show. */
export function seriesScoreLabel(series: DuelSeriesSummary | null | undefined, match: Pick<Match, "playerOneId" | "status">): string | null {
  if (!series) return null;
  const [one, two] = seriesScore(series, match);
  if (isSeriesOpen(series)) {
    const prefix = series.status === "between_games" ? "Between games" : `Game ${series.gameNumber}`;
    return `${prefix} · ${one}–${two}`;
  }
  if (series.status === "completed" && match.status === "completed") return `Final · ${one}–${two}`;
  return null;
}

/** Message for a failed Start duel call; a missing deck points the player at My deck. */
export function startDuelErrorText(status: number, message: string): string {
  if (status === 409 && /deck/i.test(message)) {
    return `${message.replace(/[.\s]+$/, "")}. Register your deck in My deck, then try again.`;
  }
  return message;
}
