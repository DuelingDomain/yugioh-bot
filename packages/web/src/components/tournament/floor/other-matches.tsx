"use client";

import { Mono, ringColour } from "@/components/sheet";
import type { Match, TournamentDetail } from "../types";
import { otherPlayer, roundName, tableStatus } from "./floor-model";
import styles from "./floor.module.css";

/**
 * The rest of your open matches, under the field. In a round robin every round exists from the start, so you
 * can start, open or report any of them. Picking one puts it on the field.
 */
export function OtherMatches({ tournament, matches, shownId, viewerId, onPick }: {
  tournament: TournamentDetail;
  matches: Match[];
  shownId: number;
  viewerId: number;
  onPick: (matchId: number) => void;
}) {
  const others = matches.filter((match) => match.id !== shownId);
  if (others.length === 0) return null;
  return (
    <section className={styles.others} aria-label="Your other matches" data-testid="other-matches">
      <h2 className={styles.othersHead}>Your other matches</h2>
      <ul className={styles.othersList}>
        {others.map((match) => {
          const opp = otherPlayer(match, viewerId);
          const round = roundName(tournament, match.roundNumber);
          return (
            <li key={match.id}>
              <button type="button" className={styles.otherBtn} data-match-id={match.id} aria-label={`${round}, against ${opp.name}. Show this match.`} onClick={() => onPick(match.id)}>
                <Mono name={opp.name} size="sm" ring={ringColour(opp.id ?? 0)} />
                <span className={styles.otherText}>
                  <b>{round} against {opp.name}</b>
                  <span>{tableStatus(tournament, match, viewerId)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
