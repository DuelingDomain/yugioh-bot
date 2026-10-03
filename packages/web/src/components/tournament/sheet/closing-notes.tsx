import { Flag, X } from "lucide-react";
import { Stamp } from "@/components/sheet";
import type { TournamentDetail } from "../types";
import type { TournamentEnding } from "./sheet-header";

/**
 * The top of a closed tournament. A full finish gets the result frame; ended-early and cancelled get a
 * plain note, because they have no champion. The champion and placings need award data the payload
 * does not carry, so the frame never crowns the top of the standings.
 */
export function ClosingNote({ tournament, ending }: { tournament: TournamentDetail; ending: Exclude<TournamentEnding, null> }) {
  const total = tournament.matches.length;
  const decided = tournament.matches.filter((match) => match.status === "completed").length;
  const unplayed = total - decided;
  if (ending === "finished") {
    return (
      <section className="frame res result" aria-label="Result">
        <div className="champ">
          <Stamp>Finished</Stamp>
          <span className="who">{tournament.name}</span>
          <span className="rec"><span><b>{total}</b> {total === 1 ? "match" : "matches"} decided</span></span>
        </div>
      </section>
    );
  }
  if (ending === "ended-early") {
    return (
      <div className="banner" role="status">
        <Flag className="ic" aria-hidden="true" />
        <span><strong>Ended early with {unplayed} {unplayed === 1 ? "match" : "matches"} unplayed.</strong> No champion or placement winnings are recorded. Match wins already approved still count.</span>
      </div>
    );
  }
  return (
    <div className="banner banner-warn" role="status">
      <X className="ic" aria-hidden="true" />
      <span><strong>The organizer cancelled this tournament.</strong> Results approved before then still count toward Elo and winnings. Nothing else will be played.</span>
    </div>
  );
}
