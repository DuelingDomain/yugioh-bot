import { defaultDuelSettings, type DuelBestOf, type DuelMode } from "@yugidraft/shared/duels";
import type { DuelSeriesSummary, Match, TournamentDetail } from "./types";

/** The basic duel rules an organizer can set for a tournament. */
export interface DuelRulesValue {
  bestOf: DuelBestOf;
  mode: DuelMode;
  banlist: string;
  turnSeconds: number;
}

const TURN_SECONDS_CHOICES = [0, 60, 120, 180, 240, 300, 600];

export function defaultDuelRulesValue(): DuelRulesValue {
  const settings = defaultDuelSettings("normal");
  return { bestOf: 3, mode: "normal", banlist: settings.banlist, turnSeconds: settings.turnSeconds };
}

/** Turn time options; a stored value that is not in the list stays selectable. */
export function turnSecondsChoices(current: number): Array<{ value: number; label: string }> {
  const values = TURN_SECONDS_CHOICES.includes(current) ? TURN_SECONDS_CHOICES : [...TURN_SECONDS_CHOICES, current].sort((a, b) => a - b);
  return values.map((value) => ({
    value,
    label: value === 0 ? "No turn timer" : value % 60 === 0 ? `${value / 60} ${value === 60 ? "minute" : "minutes"} per turn` : `${value} seconds per turn`,
  }));
}

/** Changing the mode also moves the banlist to that mode's default, like the duel creator. */
export function withMode(value: DuelRulesValue, mode: DuelMode): DuelRulesValue {
  if (mode === value.mode) return value;
  return { ...value, mode, banlist: defaultDuelSettings(mode).banlist };
}

/** The form value for a tournament; missing data falls back to the defaults. */
export function rulesValueFromTournament(tournament: Pick<TournamentDetail, "bestOf" | "duelRules">): DuelRulesValue {
  const base = defaultDuelRulesValue();
  const rules = tournament.duelRules;
  return {
    bestOf: rules?.bestOf ?? tournament.bestOf ?? base.bestOf,
    mode: rules?.mode ?? base.mode,
    banlist: rules?.settings?.banlist ?? base.banlist,
    turnSeconds: rules?.settings?.turnSeconds ?? base.turnSeconds,
  };
}

/** Body fields for `POST /api/tournaments` and `PATCH /api/tournaments/<slug>`. */
export function buildRulesPayload(value: DuelRulesValue) {
  return {
    bestOf: value.bestOf,
    duelRules: {
      mode: value.mode,
      masterRule: 5 as const,
      settings: { banlist: value.banlist, turnSeconds: value.turnSeconds },
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
