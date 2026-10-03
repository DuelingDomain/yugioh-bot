"use client";

import type { CSSProperties } from "react";
import { ringColour } from "@/components/sheet";
import type { Match, TournamentDetail } from "../types";
import { bestOfFor, gameWins } from "./floor-model";
import styles from "./floor.module.css";

const BEAM = "rgb(var(--beam))";

/** Game wins as [player one, player two]. A table nobody has played yet is 0 to 0; a hand-reported one has no game score. */
export function scoreOf(match: Match): [number, number] | null {
  const wins = gameWins(match);
  if (wins) return wins;
  if (match.status === "completed" || match.status === "pending_approval" || match.status === "pending") return null;
  return [0, 0];
}

function colourOf(playerId: number | null, viewerId: number | null): string {
  return playerId !== null && playerId === viewerId ? BEAM : ringColour(playerId ?? 0);
}

/**
 * One row of dots for a best-of series: the first player's wins, then the other's, then hollow dots up to
 * the length of the series. `firstId` is the player whose games show first (the viewer on their own field).
 */
export function GameDots({ match, tournament, firstId, viewerId, size = "md" }: {
  match: Match;
  tournament: Pick<TournamentDetail, "bestOf">;
  firstId: number;
  viewerId: number | null;
  size?: "sm" | "md";
}) {
  const wins = scoreOf(match);
  if (!wins) return null;
  const firstIsOne = match.playerOneId === firstId;
  const a = firstIsOne ? wins[0] : wins[1];
  const b = firstIsOne ? wins[1] : wins[0];
  const secondId = firstIsOne ? match.playerTwoId : match.playerOneId;
  const count = Math.max(bestOfFor(tournament, match), a + b);
  const dots = Array.from({ length: count }, (_, i) => {
    if (i < a) return colourOf(firstId, viewerId);
    if (i < a + b) return colourOf(secondId, viewerId);
    return null;
  });
  return (
    <span className={styles.marks} data-size={size} role="img" aria-label={`Best of ${bestOfFor(tournament, match)}, ${a} to ${b}`}>
      {dots.map((colour, i) => <i key={i} className={styles.mk} data-on={colour ? "true" : undefined} style={colour ? ({ "--c": colour } as CSSProperties) : undefined} />)}
    </span>
  );
}
