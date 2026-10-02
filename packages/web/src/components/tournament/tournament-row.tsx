import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatLabel, playersLabel, tournamentHref, type TournamentListItem } from "./tournaments-list-model";
import styles from "./tournament-row.module.css";

/**
 * One running or open tournament on the list. Render inside a `SheetRoot`.
 * The board's "yours to play" chip, station track and dates need per-row data the list
 * query does not read yet, so the row shows what it has: status, format and players.
 */
export function TournamentRow({ tournament, variant }: { tournament: TournamentListItem; variant: "running" | "open" }) {
  return (
    <Link href={tournamentHref(tournament)} className={`tl-row ${styles.row}`}>
      <div>
        <p className="tl-name">{tournament.name}</p>
        <p className="tl-meta">
          {variant === "running" ? (
            <span className="live-pill">In progress</span>
          ) : (
            <span className="status">
              <span className="lamp" data-s="open" aria-hidden="true" />
              Open to join
            </span>
          )}
          <span className="dot" aria-hidden="true" />
          {formatLabel(tournament.format)}
          <span className="dot" aria-hidden="true" />
          {playersLabel(tournament.participantCount)}
        </p>
      </div>
      <div className="tl-side">
        <ChevronRight className="ic" aria-hidden="true" />
      </div>
    </Link>
  );
}
