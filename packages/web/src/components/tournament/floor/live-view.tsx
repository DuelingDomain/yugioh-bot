"use client";

import { useEffect, useState } from "react";
import { StatusLine } from "@/components/sheet";
import { matchAnchorId, type PlayerRatings } from "../sheet-contracts";
import type { TournamentDetail } from "../types";
import { ClosingNote } from "../sheet/closing-notes";
import { ChampionField, DuelField } from "./duel-field";
import { champion, confirmLine, heroCase, openMatchesOf, pageRound, tournamentEnding } from "./floor-model";
import { NearBox } from "./near-box";
import { OtherMatches } from "./other-matches";
import { SELECT_MATCH_EVENT } from "./select-match";
import { SpectatorGrid, TableStrip } from "./tables";
import styles from "./floor.module.css";

/** After the tournament closed, an opponent can still answer a hand report. It needs the same two buttons. */
function ClosedConfirm({ tournament, tournamentSlug, ratings, isHost, onChanged }: {
  tournament: TournamentDetail;
  tournamentSlug: string;
  ratings: PlayerRatings;
  isHost: boolean;
  onChanged: () => void;
}) {
  const viewerId = tournament.currentUserPlayerId;
  const line = confirmLine(tournament, viewerId);
  if (!line || viewerId === null) return null;
  return (
    <section className={styles.closedConfirm} aria-label="Waiting for your reply">
      <StatusLine tone="warn">{line.text}</StatusLine>
      <NearBox tournament={tournament} tournamentSlug={tournamentSlug} match={line.match} viewerId={viewerId} isHost={isHost} ratings={ratings} onChanged={onChanged} narrow={false} />
    </section>
  );
}

/**
 * The top of the page while a tournament is under way or just closed: the tables of your round and then
 * your field, the grid of every table for someone who is not playing, or the champion.
 */
export function LiveView({ tournament, tournamentSlug, ratings, isHost, onChanged, narrow }: {
  tournament: TournamentDetail;
  tournamentSlug: string;
  ratings: PlayerRatings;
  isHost: boolean;
  onChanged: () => void;
  narrow: boolean;
}) {
  const viewerId = tournament.currentUserPlayerId;
  const ending = tournamentEnding(tournament);
  // The match the viewer picked. heroMatch ignores it once that match is no longer one of their open matches.
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => {
    const onSelect = (event: Event) => {
      const id = (event as CustomEvent<number>).detail;
      if (typeof id === "number") setPicked(id);
    };
    window.addEventListener(SELECT_MATCH_EVENT, onSelect);
    return () => window.removeEventListener(SELECT_MATCH_EVENT, onSelect);
  }, []);
  const closed = { tournament, tournamentSlug, ratings, isHost, onChanged };

  if (ending) {
    const champ = champion(tournament);
    return (
      <>
        {champ ? (
          <section className={styles.hero} id="duel-field" aria-label="Champion" data-testid="duel-field">
            <ChampionField tournament={tournament} champ={champ} viewerId={viewerId} />
          </section>
        ) : (
          <ClosingNote tournament={tournament} ending={ending} />
        )}
        <ClosedConfirm {...closed} />
      </>
    );
  }

  const hero = heroCase(tournament, viewerId, picked);
  if (hero.kind === "spectator" || viewerId === null) {
    return <SpectatorGrid tournament={tournament} round={pageRound(tournament, viewerId)} viewerId={viewerId} />;
  }
  const round = pageRound(tournament, viewerId, picked);

  return (
    <>
      <TableStrip tournament={tournament} round={round} viewerId={viewerId} />
      <section
        className={styles.hero}
        id={hero.kind === "match" ? matchAnchorId(hero.match.id) : "duel-field"}
        aria-label="Your match"
        data-testid="duel-field"
        tabIndex={-1}
      >
        <DuelField tournament={tournament} tournamentSlug={tournamentSlug} hero={hero} viewerId={viewerId} ratings={ratings} isHost={isHost} onChanged={onChanged} narrow={narrow} onPick={setPicked} />
      </section>
      {hero.kind === "match" && (
        <OtherMatches tournament={tournament} matches={openMatchesOf(tournament, viewerId)} shownId={hero.match.id} viewerId={viewerId} onPick={setPicked} />
      )}
    </>
  );
}
