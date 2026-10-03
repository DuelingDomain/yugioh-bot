import { StatusLine } from "@/components/sheet";
import type { TournamentEnding } from "../floor/floor-model";
import type { TournamentDetail } from "../types";
import styles from "./rail.module.css";

/**
 * The top of a closed tournament that has no champion to show: ended early, cancelled, or finished with
 * nothing decided. A full finish with a champion is told by the champion field instead.
 */
export function ClosingNote({ tournament, ending }: { tournament: TournamentDetail; ending: Exclude<TournamentEnding, null> }) {
  const real = tournament.matches.filter((match) => match.metadata?.bye !== true && match.playerTwoId !== null);
  const decided = real.filter((match) => match.status === "completed").length;
  const unplayed = real.length - decided;
  return (
    <div className={styles.closing} role="status">
      {ending === "finished" && <StatusLine tone="ready">Finished. {decided} {decided === 1 ? "match" : "matches"} decided.</StatusLine>}
      {ending === "ended-early" && (
        <StatusLine tone="warn">
          <strong>Ended early with {unplayed} {unplayed === 1 ? "match" : "matches"} unplayed.</strong> No champion is recorded. Match wins already approved still count.
        </StatusLine>
      )}
      {ending === "cancelled" && (
        <StatusLine tone="block">
          <strong>The organizer cancelled this tournament.</strong> Results approved before then still count toward Elo. Nothing else will be played.
        </StatusLine>
      )}
    </div>
  );
}
