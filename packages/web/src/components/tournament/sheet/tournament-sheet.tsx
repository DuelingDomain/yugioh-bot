"use client";

import { useEffect, useRef } from "react";
import { SheetRoot } from "@/components/sheet";
import { MatchQueue } from "../matches/match-queue";
import { MyRow } from "../matches/my-row";
import { YourMatch } from "../matches/your-match";
import { StandingsSection } from "../standings/standings-section";
import type { PlayerRatings } from "../sheet-contracts";
import { SECTION_IDS } from "../sheet-contracts";
import { TournamentLobby } from "../tournament-lobby";
import type { TournamentDetail } from "../types";
import { featuredMatch } from "../matches/match-model";
import { useNarrow } from "../use-narrow";
import { MyDeckPanel } from "../my-deck-panel";
import { ClosingNote } from "./closing-notes";
import { EndingEarly, PlayersPanel } from "./rail-panels";
import { RulesPanel } from "./rules-panel";
import { SheetHeader, tournamentEnding } from "./sheet-header";
import { getTournamentProgress } from "./sheet-model";

/** Where an old `?tab=` link lands on the one-sheet page. Unknown values stay at the top. */
export const TAB_TARGETS: Record<string, string> = {
  standings: SECTION_IDS.standings,
  my: SECTION_IDS.matches,
  "my-matches": SECTION_IDS.matches,
  all: SECTION_IDS.matches,
  "all-matches": SECTION_IDS.matches,
  players: "players",
};

export function TournamentSheet({ tournament, tournamentSlug, isHost, ratings, onChanged, refreshFailed = false, tab = null }: {
  tournament: TournamentDetail;
  tournamentSlug: string;
  isHost: boolean;
  ratings: PlayerRatings;
  onChanged: () => void;
  refreshFailed?: boolean;
  /** The `?tab=` value, scrolled to once the sheet first renders. */
  tab?: string | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(root);
  const scrolled = useRef(false);
  const progress = getTournamentProgress(tournament);
  const ending = tournamentEnding(tournament);
  const pending = tournament.status === "pending";
  const active = tournament.status === "active";
  const mine = active && featuredMatch(tournament, tournament.currentUserPlayerId) !== null;
  const section = { tournament, tournamentSlug, currentUserPlayerId: tournament.currentUserPlayerId, ratings };

  useEffect(() => {
    if (scrolled.current || pending) return;
    scrolled.current = true;
    const id = TAB_TARGETS[tab ?? ""];
    if (!id) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(id)?.scrollIntoView?.({ behavior: reduced ? "instant" : "smooth", block: "start" });
  }, [pending, tab]);

  return (
    <div data-testid="tournament-page-shell" ref={root}>
      <SheetRoot>
        <SheetHeader tournament={tournament} progress={progress} mine={mine} ending={ending} />
        {refreshFailed && <p role="status" className="small">Couldn&apos;t refresh. Showing the last update.</p>}
        {pending ? (
          <TournamentLobby tournament={tournament} tournamentSlug={tournamentSlug} isCreator={isHost} currentUserId={tournament.createdByUserId} onChanged={onChanged} ratings={ratings} />
        ) : (
          <div className="t-grid">
            <div className="t-main">
              {ending && <ClosingNote tournament={tournament} ending={ending} />}
              {active && <YourMatch {...section} isHost={isHost} onChanged={onChanged} narrow={narrow} />}
              {active && narrow && <MyRow {...section} isHost={isHost} onChanged={onChanged} />}
              <StandingsSection {...section} narrow={narrow} final={!active && ending !== "cancelled"} />
              <MatchQueue {...section} isHost={isHost} onChanged={onChanged} />
            </div>
            <aside className="t-rail" aria-label={active ? "Event details and organizer tools" : "Event details"}>
              <RulesPanel tournament={tournament} tournamentSlug={tournamentSlug} isHost={isHost} onChanged={onChanged} />
              {active && tournament.isParticipant && (
                <section id={SECTION_IDS.myDeck} aria-label="Your deck">
                  <MyDeckPanel tournament={tournament} tournamentSlug={tournamentSlug} onChanged={onChanged} />
                </section>
              )}
              <PlayersPanel tournament={tournament} isHost={isHost && active} ratings={ratings} />
              {isHost && <EndingEarly tournament={tournament} tournamentSlug={tournamentSlug} onChanged={onChanged} />}
            </aside>
          </div>
        )}
      </SheetRoot>
    </div>
  );
}
