"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Mono, TierName, YouPill, ringColour } from "@/components/sheet";
import { isSeriesOpen } from "../duel-rules";
import { BetweenGames } from "../matches/match-state";
import { opponent, winnerScore } from "../matches/match-model";
import type { PlayerRatings } from "../sheet-contracts";
import type { Match, TournamentDetail } from "../types";
import { NearBox } from "./near-box";
import {
  finishLine, nameList, otherPlayer, pageRound, recordLine, roundName, tableStatus, totalRounds,
  type Champion, type HeroCase,
} from "./floor-model";
import { GameDots, scoreOf } from "./game-dots";
import { ZoneRow } from "./zones";
import styles from "./floor.module.css";

const YOU_HC = "rgb(var(--beam))";

function hc(colour: string): CSSProperties {
  return { "--hc": colour } as CSSProperties;
}

/** The stack of card backs at the end of a row. Dashed when the player has no deck in yet. */
function DeckZone({ registered, label }: { registered: boolean; label: string }) {
  return (
    <div className={styles.dz}>
      <span className={styles.dbox} data-none={registered ? undefined : "true"} aria-hidden="true">
        {registered && <><i /><i /><i /></>}
      </span>
      <span className={styles.dl}>{label}</span>
    </div>
  );
}

/** A big monogram, the name, the tier line and the record so far, as in the mock. */
function PlayerSeat({ tournament, ratings, playerId, name, viewerId }: {
  tournament: TournamentDetail;
  ratings: PlayerRatings;
  playerId: number;
  name: string;
  viewerId: number | null;
}) {
  const rating = ratings.get(playerId);
  const you = playerId === viewerId;
  return (
    <div className={styles.seat} data-you={you ? "true" : undefined}>
      <Mono name={name} size="big" ring={ringColour(playerId)} you={you} />
      <span className={styles.seatText}>
        <span className={styles.nmrow}><b className={styles.name}>{name}</b>{you && <YouPill />}</span>
        {rating && (
          <span className={styles.tl}><TierName tier={rating.rank} /><em className="sv-elo">{rating.rating}</em></span>
        )}
        <span className={styles.rec}>{recordLine(tournament, playerId)}</span>
      </span>
    </div>
  );
}

function deckIn(tournament: TournamentDetail, playerId: number | null): boolean {
  return playerId !== null && tournament.participants.find((p) => p.playerId === playerId)?.deckRegistered === true;
}

function MatchCentre({ tournament, match, viewerId }: { tournament: TournamentDetail; match: Match; viewerId: number }) {
  const wins = scoreOf(match);
  const reported = match.status === "pending_approval" && match.reporterId !== null;
  const between = match.series?.status === "between_games";
  const live = isSeriesOpen(match.series);
  if (reported) {
    const reporterName = match.reporterId === match.playerOneId ? match.playerOneName : match.playerTwoName ?? "Opponent";
    const mine = match.winnerId === viewerId;
    return (
      <div className={styles.centre} data-reported="true" data-fly-source="centre">
        <div className={styles.gframe}>
          <span className={styles.score}>{mine ? "You won" : "You lost"}</span>
        </div>
        <p className={styles.rline}>{reporterName} reported this by hand.</p>
        <p className={styles.cstat}>{tableStatus(tournament, match, viewerId)}</p>
      </div>
    );
  }
  const mineWins = wins ? (match.playerOneId === viewerId ? wins[0] : wins[1]) : 0;
  const theirWins = wins ? (match.playerOneId === viewerId ? wins[1] : wins[0]) : 0;
  const caption = between ? <BetweenGames match={match} /> : live ? tableStatus(tournament, match, viewerId) : `${roundName(tournament, match.roundNumber)}. Not started.`;
  return (
    <div className={styles.centre} data-fly-source="centre">
      <span className={styles.score} aria-label={`Games ${mineWins} to ${theirWins}`}>
        {mineWins}<span className={styles.dash}> – </span>{theirWins}
      </span>
      <GameDots match={match} tournament={tournament} firstId={viewerId} viewerId={viewerId} />
      <p className={styles.cstat}>{caption}</p>
    </div>
  );
}

/** One of the viewer's own matches, drawn as a field with the opponent across the table. */
function MatchField({ tournament, tournamentSlug, match, viewerId, ratings, isHost, onChanged, narrow, onPick }: {
  tournament: TournamentDetail;
  tournamentSlug: string;
  match: Match;
  viewerId: number;
  ratings: PlayerRatings;
  isHost: boolean;
  onChanged: () => void;
  narrow: boolean;
  onPick?: (matchId: number) => void;
}) {
  const opp = opponent(match, viewerId);
  const oppId = opp.id ?? 0;
  const me = tournament.participants.find((p) => p.playerId === viewerId)?.displayName ?? "You";
  const total = totalRounds(tournament);
  return (
    <>
      <div className={styles.seatrow}><PlayerSeat tournament={tournament} ratings={ratings} playerId={oppId} name={opp.name} viewerId={viewerId} /></div>
      <div className={styles.stage}>
        <div className={styles.field}>
          <div className={styles.half} data-side="far" data-kind="lit" style={hc(ringColour(oppId))}>
            <DeckZone registered={deckIn(tournament, oppId)} label={deckIn(tournament, oppId) ? "Deck" : "No deck yet"} />
            <ZoneRow tournament={tournament} playerId={oppId} viewerId={viewerId} heroId={match.id} total={total} current={match.roundNumber} name={opp.name} />
          </div>
          <div className={styles.mid} data-reported={match.status === "pending_approval" ? "true" : undefined}>
            <MatchCentre tournament={tournament} match={match} viewerId={viewerId} />
          </div>
          <div className={styles.half} data-side="near" data-kind="lit" style={hc(YOU_HC)}>
            <ZoneRow tournament={tournament} playerId={viewerId} viewerId={viewerId} heroId={match.id} total={total} current={match.roundNumber} name={me} onPick={onPick} />
            <DeckZone registered={deckIn(tournament, viewerId)} label={deckIn(tournament, viewerId) ? "Deck" : "No deck yet"} />
          </div>
        </div>
      </div>
      <div className={styles.nearbox}>
        <PlayerSeat tournament={tournament} ratings={ratings} playerId={viewerId} name={me} viewerId={viewerId} />
      </div>
      <NearBox tournament={tournament} tournamentSlug={tournamentSlug} match={match} viewerId={viewerId} isHost={isHost} ratings={ratings} onChanged={onChanged} narrow={narrow} />
    </>
  );
}

function idleSentence(tournament: TournamentDetail, hero: Exclude<HeroCase, { kind: "match" } | { kind: "spectator" }>, viewerId: number): ReactNode {
  const total = totalRounds(tournament);
  if (hero.kind === "bye") {
    const next = hero.round + 1;
    return <>Bye this round. You go straight to {next >= total ? "the final" : `round ${next}`}.</>;
  }
  if (hero.kind === "waitdraw") {
    const opp = otherPlayer(hero.last, viewerId).name;
    const score = winnerScore(hero.last);
    if (hero.won) {
      return <>You beat {opp}{score ? ` ${score}` : ""}. Your next opponent is drawn when {roundName(tournament, hero.last.roundNumber).toLowerCase()} ends.</>;
    }
    return <>You lost to {opp}{score ? ` ${score}` : ""}. Your tournament is over.</>;
  }
  return <>You have no duel to play right now.</>;
}

/** No match to play: an empty far half, your zones, and one sentence in the middle. */
function IdleField({ tournament, hero, viewerId, ratings, narrow }: {
  tournament: TournamentDetail;
  hero: Exclude<HeroCase, { kind: "match" } | { kind: "spectator" }>;
  viewerId: number;
  ratings: PlayerRatings;
  narrow: boolean;
}) {
  void narrow;
  const total = totalRounds(tournament);
  const me = tournament.participants.find((p) => p.playerId === viewerId)?.displayName ?? "You";
  const round = pageRound(tournament, viewerId);
  const eliminated = hero.kind === "waitdraw" && !hero.won;
  const farText =
    hero.kind === "bye" ? `${nameList(hero.rivals)} play ${roundName(tournament, round).toLowerCase()}.`
    : hero.kind === "waitdraw" ? `${nameList(hero.waiting)} play ${roundName(tournament, round).toLowerCase()}.`
    : "Nothing is waiting for you.";
  return (
    <>
      <div className={styles.seatrow}>
        <div className={`${styles.seat} ${styles.seatEmpty}`}>
          <Mono name="" size="big" dashed />
          <span className={styles.name}>No opponent right now</span>
        </div>
      </div>
      <div className={styles.stage}>
        <div className={styles.field}>
          <div className={styles.half} data-side="far" data-kind="dashed"><p className={styles.halfMsg}>{farText}</p></div>
          <div className={styles.mid}>
            <div className={styles.centre} data-idle="true" data-fly-source="centre"><p className={styles.idleLine}>{idleSentence(tournament, hero, viewerId)}</p></div>
          </div>
          <div className={styles.half} data-side="near" data-kind={eliminated ? "unlit" : "lit"} style={hc(YOU_HC)}>
            <ZoneRow tournament={tournament} playerId={viewerId} viewerId={viewerId} heroId={null} total={total} current={round} name={me} />
            <DeckZone registered={deckIn(tournament, viewerId)} label={deckIn(tournament, viewerId) ? "Deck" : "No deck yet"} />
          </div>
        </div>
      </div>
      <div className={styles.nearbox}><PlayerSeat tournament={tournament} ratings={ratings} playerId={viewerId} name={me} viewerId={viewerId} /></div>
    </>
  );
}

/** Lobby-style dashed halves are drawn by the lobby itself; this is the finished tournament. */
export function ChampionField({ tournament, champ, viewerId }: { tournament: TournamentDetail; champ: Champion; viewerId: number | null }) {
  const finish = finishLine(tournament, viewerId);
  return (
    <>
      <div className={styles.seatrow}>
        <div className={`${styles.seat} ${styles.seatChamp}`}>
          <Mono name={champ.name} size="big" champion label={`${champ.name}, champion`} />
          <span className={styles.seatText}>
            <span className={styles.name}>{champ.name}</span>
            <span className={styles.rec}>Champion</span>
          </span>
        </div>
      </div>
      <div className={styles.stage}>
        <div className={styles.field}>
          <div className={styles.half} data-side="far" data-kind="lit" style={hc("#e4b64f")}>
            <ZoneRow tournament={tournament} playerId={champ.playerId} viewerId={viewerId} heroId={null} total={totalRounds(tournament)} current={totalRounds(tournament)} name={champ.name} />
          </div>
          <div className={styles.mid}>
            <div className={styles.centre} data-champ="true" data-fly-source="centre">
              <h2 className={styles.ctitle}>{champ.name} wins {tournament.name}</h2>
              <span className={styles.crec}>{champ.wins}–{champ.losses}</span>
            </div>
          </div>
          <div className={styles.half} data-side="near" data-kind="unlit">
            {tournament.draftSlug && <Link className={styles.backLink} href={`/draft/${tournament.draftSlug}`}>Back to the draft</Link>}
            {finish && <p className={styles.halfMsg}>{finish}</p>}
          </div>
        </div>
      </div>
    </>
  );
}

export function DuelField({ tournament, tournamentSlug, hero, viewerId, ratings, isHost, onChanged, narrow, onPick }: {
  tournament: TournamentDetail;
  tournamentSlug: string;
  hero: Exclude<HeroCase, { kind: "spectator" }>;
  viewerId: number;
  ratings: PlayerRatings;
  isHost: boolean;
  onChanged: () => void;
  narrow: boolean;
  /** Puts another open match of the viewer on the field. */
  onPick?: (matchId: number) => void;
}) {
  if (hero.kind === "match") {
    return <MatchField tournament={tournament} tournamentSlug={tournamentSlug} match={hero.match} viewerId={viewerId} ratings={ratings} isHost={isHost} onChanged={onChanged} narrow={narrow} onPick={onPick} />;
  }
  return <IdleField tournament={tournament} hero={hero} viewerId={viewerId} ratings={ratings} narrow={narrow} />;
}
