"use client";

import { StatusLine } from "@/components/sheet";
import { matchAnchorId, type PlayerRatings } from "../sheet-contracts";
import type { TournamentDetail } from "../types";
import { ClosingNote } from "../sheet/closing-notes";
import { ChampionField, DuelField } from "./duel-field";
import { champion, confirmLine, currentRound, heroCase, tournamentEnding } from "./floor-model";
import { NearBox } from "./near-box";
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
 * The top of the page while a tournament is under way or just closed: your field and the tables of your
 * round, the grid of every table for someone who is not playing, or the champion.
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

  const hero = heroCase(tournament, viewerId);
  if (hero.kind === "spectator" || viewerId === null) {
    return <SpectatorGrid tournament={tournament} round={currentRound(tournament)} viewerId={viewerId} />;
  }

  const stripRound = hero.kind === "match" ? hero.match.roundNumber : hero.kind === "bye" ? hero.round : hero.kind === "waitdraw" ? hero.last.roundNumber : currentRound(tournament);
  return (
    <>
      <section
        className={styles.hero}
        id={hero.kind === "match" ? matchAnchorId(hero.match.id) : "duel-field"}
        aria-label="Your match"
        data-testid="duel-field"
        tabIndex={-1}
      >
        <DuelField tournament={tournament} tournamentSlug={tournamentSlug} hero={hero} viewerId={viewerId} ratings={ratings} isHost={isHost} onChanged={onChanged} narrow={narrow} />
      </section>
      <TableStrip tournament={tournament} round={stripRound} viewerId={viewerId} />
    </>
  );
}
