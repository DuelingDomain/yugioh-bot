"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { LiveDot, Mono, ringColour } from "@/components/sheet";
import { isSeriesOpen } from "../duel-rules";
import type { Match, TournamentDetail } from "../types";
import { byeNames, isDecided, nameList, tableMatches, tableNumber, tableStatus, totalRounds } from "./floor-model";
import { GameDots, scoreOf } from "./game-dots";
import { ZoneStrip } from "./zones";
import styles from "./floor.module.css";

type TableState = "live" | "reported" | "done" | "open";

function tableState(match: Match): TableState {
  if (isSeriesOpen(match.series)) return "live";
  if (match.status === "pending_approval") return "reported";
  if (match.status === "completed") return "done";
  return "open";
}

function watchHref(match: Match): string | null {
  return isSeriesOpen(match.series) && match.series?.currentDuelSlug ? `/duels/${match.series.currentDuelSlug}` : null;
}

/** "2 – 1" for the games of a series, "0 – 0" before it starts, or a dim dash when no online games back the table. */
function TableScore({ match, flip = false }: { match: Match; flip?: boolean }) {
  const wins = scoreOf(match);
  if (!wins) return <span className={styles.tscore} data-table-score={match.id}><span className={styles.dash}>– –</span></span>;
  const [a, b] = flip ? [wins[1], wins[0]] : wins;
  return <span className={styles.tscore} data-table-score={match.id} aria-label={`Games ${a} to ${b}`}>{a}<span className={styles.dash}> – </span>{b}</span>;
}

/** The status line of a table: a live dot while a game is on, then the words. */
function TableLine({ tournament, match, viewerId }: { tournament: TournamentDetail; match: Match; viewerId: number | null }) {
  return (
    <>
      {isSeriesOpen(match.series) && <LiveDot />}
      <span>{tableStatus(tournament, match, viewerId)}</span>
    </>
  );
}

/** The tables of a round as small strips, above your own field. Your table comes first. */
export function TableStrip({ tournament, round, viewerId }: { tournament: TournamentDetail; round: number; viewerId: number | null }) {
  const isMine = (match: Match) => viewerId !== null && (match.playerOneId === viewerId || match.playerTwoId === viewerId);
  const matches = tableMatches(tournament, round).sort((a, b) => Number(isMine(b)) - Number(isMine(a)) || a.id - b.id);
  const byes = byeNames(tournament, round);
  if (matches.length === 0 && byes.length === 0) return null;
  const total = totalRounds(tournament);
  const heading = tournament.format === "single_elim" && round === total
    ? `The final. ${matches.length} ${matches.length === 1 ? "table" : "tables"}.`
    : `Round ${round}. ${matches.length} ${matches.length === 1 ? "table" : "tables"}.`;
  return (
    <section className={styles.tables} aria-label="Tables" id="matches" data-testid="table-strip">
      <h2 className={styles.tablesHead}>{heading}</h2>
      <ul className={styles.tgrid}>
        {matches.map((match) => {
          const state = tableState(match);
          const mine = isMine(match);
          // On your own table you are on the left.
          const flip = mine && match.playerTwoId === viewerId;
          const left = flip ? { id: match.playerTwoId ?? 0, name: match.playerTwoName ?? "Opponent" } : { id: match.playerOneId, name: match.playerOneName };
          const right = flip ? { id: match.playerOneId, name: match.playerOneName } : { id: match.playerTwoId ?? 0, name: match.playerTwoName ?? "Opponent" };
          const href = watchHref(match);
          return (
            <li key={match.id}>
              <div
                className={styles.tc}
                data-mine={mine ? "true" : undefined}
                data-st={state}
                style={{ "--ca": left.id === viewerId ? "rgb(var(--beam))" : ringColour(left.id), "--cb": right.id === viewerId ? "rgb(var(--beam))" : ringColour(right.id) } as CSSProperties}
                aria-label={`Table ${tableNumber(tournament, match)}, ${left.name} against ${right.name}`}
              >
                <div className={styles.tcl}>
                  <span className={styles.tp}>
                    <Mono name={left.name} size="sm" ring={ringColour(left.id)} you={left.id === viewerId} />
                    <b>{left.name}</b>
                  </span>
                  <span className={styles.tcs}>
                    <TableScore match={match} flip={flip} />
                    <GameDots match={match} tournament={tournament} firstId={left.id} viewerId={viewerId} size="sm" />
                  </span>
                  <span className={styles.tp} data-r="true">
                    <b>{right.name}</b>
                    <Mono name={right.name} size="sm" ring={ringColour(right.id)} you={right.id === viewerId} />
                  </span>
                </div>
                <div className={styles.tcf}>
                  <p className={styles.tstat}>
                    {mine && <span className={styles.ytag}>Your table</span>}
                    <TableLine tournament={tournament} match={match} viewerId={viewerId} />
                  </p>
                  {href && !mine && <Link className={styles.watch} href={href}>Watch</Link>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {byes.length > 0 && <p className={styles.byeinfo}>Bye this round: {nameList(byes)}.</p>}
    </section>
  );
}

/** For anyone who is not playing: every table of the round as a medium field with each player's rounds beside their name. */
export function SpectatorGrid({ tournament, round, viewerId }: { tournament: TournamentDetail; round: number; viewerId: number | null }) {
  const matches = tableMatches(tournament, round);
  const byes = byeNames(tournament, round);
  const total = totalRounds(tournament);
  const heading = tournament.format === "single_elim" && round === total
    ? "The final. Every table."
    : `Round ${round} of ${total}. Every table.`;
  return (
    <section className={styles.gridHero} aria-label="Tables" id="matches" data-testid="spectator-grid">
      <h2 className={styles.gh}>{heading}</h2>
      <ul className={styles.tgridMd}>
        {matches.map((match) => {
          const state = tableState(match);
          const href = watchHref(match);
          const decided = isDecided(match);
          const one = { id: match.playerOneId, name: match.playerOneName };
          const two = { id: match.playerTwoId ?? 0, name: match.playerTwoName ?? "Opponent" };
          const half = (side: { id: number; name: string }, pos: "top" | "bot") => (
            <div className={styles.th} data-pos={pos} style={{ "--hc": ringColour(side.id) } as CSSProperties}>
              <Mono name={side.name} size="sm" ring={ringColour(side.id)} you={side.id === viewerId} />
              <span className={styles.tn}><b>{side.name}</b>{decided && match.winnerId === side.id && <Star />}</span>
              <ZoneStrip tournament={tournament} playerId={side.id} viewerId={viewerId} heroId={match.id} total={total} current={round} name={side.name} />
            </div>
          );
          return (
            <li key={match.id} className={styles.tbl} data-st={state}>
              <p className={styles.tnum}>Table {tableNumber(tournament, match)}</p>
              <div className={styles.tfield}>
                {half(one, "top")}
                <div className={styles.tmid}>
                  <TableScore match={match} />
                  <GameDots match={match} tournament={tournament} firstId={one.id} viewerId={viewerId} size="sm" />
                </div>
                {half(two, "bot")}
              </div>
              <div className={styles.tfoot}>
                <p className={styles.tstat}><TableLine tournament={tournament} match={match} viewerId={viewerId} /></p>
                {href && <Link className={styles.watch} href={href}>Watch</Link>}
              </div>
            </li>
          );
        })}
      </ul>
      {byes.length > 0 && <p className={styles.byeinfo}>Bye this round: {nameList(byes)}.</p>}
    </section>
  );
}

function Star() {
  return (
    <svg viewBox="0 0 24 24" aria-label="Won" role="img" focusable="false">
      <path fill="currentColor" d="M12 1.5l2.9 7.2 7.6.6-5.8 5 1.8 7.5L12 17.7 5.5 21.8l1.8-7.5-5.8-5 7.6-.6Z" />
    </svg>
  );
}
