"use client";

import { useEffect, useRef, useState } from "react";
import { SheetRoot, StatusLine } from "@/components/sheet";
import { prefersReducedMotion } from "@/lib/motion";
import { Road } from "../bracket/road";
import { LocatorFly, type Moment } from "../fx/locator-fly";
import { useAnimations } from "../fx/use-animations";
import { finishedSeries, pickMoment, tournamentEnding } from "../floor/floor-model";
import { LiveView } from "../floor/live-view";
import { hostToolsAvailable } from "../sheet-rules";
import { StandingsFloor } from "../standings/standings-floor";
import type { PlayerRatings } from "../sheet-contracts";
import { SECTION_IDS } from "../sheet-contracts";
import { TournamentLobby } from "../tournament-lobby";
import type { TournamentDetail } from "../types";
import { useNarrow } from "../use-narrow";
import { HostDrawer } from "./host-drawer";
import { Rail } from "./rail";
import { TournamentBar } from "./tournament-bar";
import styles from "./tournament-sheet.module.css";

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
  // The phone layout and its fixed action bar switch at the width the stylesheet's phone rules use.
  const narrow = useNarrow(root, 760);
  const scrolled = useRef(false);
  const { motion, reduced, set: setMotion } = useAnimations();
  const [hostOpen, setHostOpen] = useState(false);
  const ending = tournamentEnding(tournament);
  const pending = tournament.status === "pending";
  const active = tournament.status === "active";

  // A series that finished since the last render starts one moment: the winner's locator card arrives.
  // It is worked out during render (not in an effect) so the card can be hidden before the first paint.
  const [seen, setSeen] = useState(tournament);
  const [seq, setSeq] = useState(0);
  const [moment, setMoment] = useState<Moment | null>(null);
  if (seen !== tournament) {
    setSeen(tournament);
    const next = pickMoment(finishedSeries(seen, tournament), tournament.currentUserPlayerId, tournament.isParticipant);
    if (next) {
      setSeq(seq + 1);
      setMoment({ key: `${next.matchId}:${seq + 1}`, matchId: next.matchId, winnerId: next.winnerId, mine: tournament.isParticipant });
    }
  }

  useEffect(() => {
    if (scrolled.current || pending) return;
    scrolled.current = true;
    const id = TAB_TARGETS[tab ?? ""];
    if (!id) return;
    document.getElementById(id)?.scrollIntoView?.({ behavior: prefersReducedMotion() ? "instant" : "smooth", block: "start" });
  }, [pending, tab]);

  const section = { tournament, tournamentSlug, currentUserPlayerId: tournament.currentUserPlayerId, ratings };
  const showHost = hostToolsAvailable(tournament, isHost);

  return (
    <div data-testid="tournament-page-shell" data-motion={motion} ref={root}>
      <SheetRoot>
        <TournamentBar
          tournament={tournament}
          isHost={isHost}
          hostOpen={hostOpen && showHost}
          onHostToggle={() => setHostOpen(!hostOpen)}
          motion={motion}
          reducedMotion={reduced}
          onMotion={setMotion}
        />
        {refreshFailed && (
          <div className={styles.status} role="status">
            <StatusLine tone="warn">Couldn&apos;t refresh. Showing the last update.</StatusLine>
          </div>
        )}
        {pending ? (
          <TournamentLobby tournament={tournament} tournamentSlug={tournamentSlug} isCreator={isHost} currentUserId={tournament.createdByUserId} onChanged={onChanged} ratings={ratings} />
        ) : (
          <>
            <div className={styles.body}>
              <div className={styles.main}>
                <LiveView tournament={tournament} tournamentSlug={tournamentSlug} ratings={ratings} isHost={isHost} onChanged={onChanged} narrow={narrow} />
                {tournament.format === "single_elim"
                  ? <Road {...section} final={!active && ending !== "cancelled"} />
                  : <StandingsFloor {...section} final={!active && ending !== "cancelled"} />}
              </div>
              <Rail tournament={tournament} tournamentSlug={tournamentSlug} isHost={isHost} closed={!active} onChanged={onChanged} />
            </div>
          </>
        )}
        <HostDrawer open={hostOpen && showHost} tournament={tournament} tournamentSlug={tournamentSlug} ratings={ratings} onChanged={onChanged} onClose={() => setHostOpen(false)} />
        <LocatorFly moment={moment} motion={motion} root={root} />
      </SheetRoot>
    </div>
  );
}
