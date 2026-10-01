"use client";

import Link from "next/link";
import type { DuelRoom, DuelSeriesSummary } from "@yugidraft/shared/duels";
import { SeriesNextControls } from "./series-next";
import {
  isBetweenGames, isSeriesOpen, nextGameTarget, seriesGameLabel, seriesKindLabel, seriesLengthLabel, seriesScoreText,
} from "./series-model";
import styles from "./series.module.css";

/** True when the series is worth a badge row: a Best of 3, a tournament game or a ranked game. */
export function isNotableSeries(series: DuelSeriesSummary | null | undefined): series is DuelSeriesSummary {
  return series != null && (series.bestOf === 3 || series.tournamentId != null || series.ranked);
}

/**
 * Badges for a series: length, score (Best of 3), ranked or tournament, game number.
 * The tournament badge links to the tournament page.
 */
export function SeriesBadges({ series, showGame = false, hideScore = false, plain = false }: {
  series: DuelSeriesSummary;
  showGame?: boolean;
  hideScore?: boolean;
  /** No links: for rows that are links themselves. */
  plain?: boolean;
}) {
  const tournament = series.tournamentId != null;
  return (
    <span className={styles.badges}>
      <span className={styles.badge} data-tone="accent">{seriesLengthLabel(series)}</span>
      {!hideScore && (series.bestOf === 3 || series.wins[0] + series.wins[1] > 0) ? (
        <span className={styles.badge} data-tone="score" aria-label={`Series score ${seriesScoreText(series)}`}>{seriesScoreText(series)}</span>
      ) : null}
      {tournament && series.tournamentSlug && !plain ? (
        <Link href={`/tournament/${series.tournamentSlug}`} className={styles.badge} data-tone="gold">Tournament</Link>
      ) : tournament || series.ranked ? (
        <span className={styles.badge} data-tone="gold">{seriesKindLabel(series)}</span>
      ) : null}
      {showGame && isSeriesOpen(series) ? <span className={styles.badge}>Game {series.gameNumber}</span> : null}
    </span>
  );
}

/**
 * "Game 2 of 3 · 1–0" for the top-right of the duel room header. Nothing for a single game, so the
 * header stays as it was. The score counts the viewer's wins first.
 */
export function SeriesGameLabel({ room }: { room: Pick<DuelRoom, "session" | "mySeat" | "series"> }) {
  const label = seriesGameLabel(room);
  if (!label) return null;
  return (
    <span className={styles.gameLabel} title={label.title} data-testid="series-game-label">
      <b>{label.game}</b><i aria-hidden>·</i><span aria-label={`Match score ${label.score}`}>{label.score}</span>
    </span>
  );
}

/**
 * A thin strip under the room header for the side deck window (countdown, Ready, Side deck) and
 * for a spectator who can follow the series to its next game. Nothing else shows in the strip so
 * the board keeps its height during a game.
 */
export function SeriesBanner({ room, slug, onChanged, onNavigate, onOpenSide }: {
  room: DuelRoom;
  slug: string;
  onChanged: () => void;
  onNavigate: (slug: string) => void;
  onOpenSide: () => void;
}) {
  const series = room.series;
  if (!series) return null;
  const between = isBetweenGames(room, slug);
  const follow = !between && isSeriesOpen(series) && series.currentDuelSlug && series.currentDuelSlug !== slug
    && nextGameTarget(room, slug) == null ? series.currentDuelSlug : null;
  if (!between && !follow) return null;
  return (
    <div className={styles.strip} data-testid="series-strip">
      <div className={styles.stripMain}>
        <SeriesBadges series={series} showGame />
      </div>
      {between ? (
        <SeriesNextControls room={room} slug={slug} tone="sheet" onChanged={onChanged} onNavigate={onNavigate} onOpenSide={onOpenSide} />
      ) : follow ? (
        <span className={styles.stripNext}>
          A later game is being played.
          <Link href={`/duels/${follow}`} className={styles.stripLink}>Go to game {series.gameNumber}</Link>
        </span>
      ) : null}
    </div>
  );
}
