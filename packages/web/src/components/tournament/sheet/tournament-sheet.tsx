"use client";

import { SheetRoot } from "@/components/sheet/sheet-root";
import sheet from "@/components/sheet/sheet.module.css";
import { YourMatch } from "../matches/your-match";
import { MatchQueue } from "../matches/match-queue";
import { Crosstable } from "../standings/crosstable";
import type { PlayerRatings } from "../sheet-contracts";
import type { TournamentDetail } from "../types";
import { DeckPanel } from "./deck-panel";
import { EventCard } from "./event-card";
import { OrganizerPanel } from "./organizer-panel";
import { PlayersPanel } from "./players-panel";
import { SheetHeader } from "./sheet-header";
import { getTournamentProgress } from "./sheet-model";
import styles from "./tournament-sheet.module.css";

export function TournamentSheet({ tournament, tournamentSlug, isHost, ratings, onChanged, refreshFailed = false }: {
  tournament: TournamentDetail; tournamentSlug: string; isHost: boolean; ratings: PlayerRatings; onChanged: () => void; refreshFailed?: boolean;
}) {
  const progress = getTournamentProgress(tournament);
  const sectionProps = { tournament, tournamentSlug, currentUserPlayerId: tournament.currentUserPlayerId, ratings };
  return <div className={styles.page} data-testid="tournament-page-shell"><SheetRoot>
    <SheetHeader tournament={tournament} progress={progress} />
    {refreshFailed && <p role="status" className={`${sheet.small} ${styles["refresh-status"]}`}>Couldn&apos;t refresh. Showing the last update.</p>}
    <div className={styles["t-grid"]}>
      <div className={styles["t-main"]}>
        <YourMatch {...sectionProps} isHost={isHost} onChanged={onChanged} />
        <Crosstable {...sectionProps} />
        <MatchQueue {...sectionProps} isHost={isHost} onChanged={onChanged} />
      </div>
      <aside className={styles["t-rail"]} aria-label="Event details and organizer tools">
        <EventCard tournament={tournament} progress={progress} />
        <DeckPanel tournament={tournament} tournamentSlug={tournamentSlug} onChanged={onChanged} />
        {isHost && tournament.status === "active" && <OrganizerPanel tournament={tournament} tournamentSlug={tournamentSlug} onChanged={onChanged} />}
        <PlayersPanel tournament={tournament} isHost={isHost} ratings={ratings} />
      </aside>
    </div>
  </SheetRoot></div>;
}
