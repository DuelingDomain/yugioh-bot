"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { Mono, ringColour } from "@/components/sheet";
import { isSeriesOpen } from "../duel-rules";
import type { Match, TournamentDetail } from "../types";
import { bestOfFor, byeNames, gameWins, isDecided, nameList, tableMatches, tableNumber, tableStatus, totalRounds, zoneFor } from "./floor-model";
import { SlotZone } from "./zones";
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

/** "2 – 1" for the games of a series, or a dim dash when no online games back the table. */
function TableScore({ match, flip = false }: { match: Match; flip?: boolean }) {
  const wins = gameWins(match);
  if (!wins) return <span className={styles.tscore} data-table-score={match.id}><span className={styles.dash}>– –</span></span>;
  const [a, b] = flip ? [wins[1], wins[0]] : wins;
  return <span className={styles.tscore} data-table-score={match.id} aria-label={`Games ${a} to ${b}`}>{a} – {b}</span>;
}

function Marks({ match, tournament }: { match: Match; tournament: TournamentDetail }) {
  const wins = gameWins(match);
  if (!wins) return null;
  const need = Math.ceil(bestOfFor(tournament, match) / 2);
  const side = (count: number, colour: string) => (
    <span style={{ display: "inline-flex", gap: 4 }}>
      {Array.from({ length: need }, (_, i) => <i key={i} className={styles.mk} data-on={i < count ? "true" : undefined} style={{ "--c": colour } as CSSProperties} />)}
    </span>
  );
  return <span className={styles.marks} aria-hidden="true">{side(wins[0], ringColour(match.playerOneId))}<span style={{ width: 8 }} />{side(wins[1], ringColour(match.playerTwoId ?? 0))}</span>;
}

/** The tables of a round as small strips, under your own field. */
export function TableStrip({ tournament, round, viewerId }: { tournament: TournamentDetail; round: number; viewerId: number | null }) {
  const matches = tableMatches(tournament, round);
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
          const mine = viewerId !== null && (match.playerOneId === viewerId || match.playerTwoId === viewerId);
          const href = watchHref(match);
          const oneWon = match.winnerId === match.playerOneId;
          return (
            <li key={match.id}>
              <div
                className={styles.tc}
                data-mine={mine ? "true" : undefined}
                data-st={state}
                style={{ "--ca": mine && match.playerOneId === viewerId ? "rgb(var(--beam))" : ringColour(match.playerOneId), "--cb": mine && match.playerTwoId === viewerId ? "rgb(var(--beam))" : ringColour(match.playerTwoId ?? 0) } as CSSProperties}
                aria-label={`Table ${tableNumber(tournament, match)}, ${match.playerOneName} against ${match.playerTwoName}`}
              >
                <div className={styles.tcl}>
                  <span className={styles.tp}>
                    <Mono name={match.playerOneName} size="sm" ring={ringColour(match.playerOneId)} you={match.playerOneId === viewerId} />
                    <b>{match.playerOneName}</b>
                  </span>
                  <span className={styles.tcs}><TableScore match={match} /><Marks match={match} tournament={tournament} /></span>
                  <span className={styles.tp} data-r="true">
                    <b>{match.playerTwoName}</b>
                    <Mono name={match.playerTwoName ?? ""} size="sm" ring={ringColour(match.playerTwoId ?? 0)} you={match.playerTwoId === viewerId} />
                  </span>
                </div>
                <div className={styles.tcf}>
                  <p className={styles.tstat}>
                    {mine && <span className={styles.ytag}>Your table</span>}
                    <span>{tableStatus(tournament, match, viewerId)}{state === "done" && match.winnerId !== null ? ` ${oneWon ? match.playerOneName : match.playerTwoName} won.` : ""}</span>
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

/** For anyone who is not playing: every table of the round as a medium field. */
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
          const sides: Array<{ id: number; name: string; pos: "top" | "bot" }> = [
            { id: match.playerOneId, name: match.playerOneName, pos: "top" },
            { id: match.playerTwoId ?? 0, name: match.playerTwoName ?? "Opponent", pos: "bot" },
          ];
          return (
            <li key={match.id} className={styles.tbl} data-st={state}>
              <p className={styles.tnum}>Table {tableNumber(tournament, match)}</p>
              <div className={styles.tfield}>
                {sides.slice(0, 1).map((side) => (
                  <div key={side.id} className={styles.th} data-pos={side.pos} style={{ "--hc": ringColour(side.id) } as CSSProperties}>
                    <Mono name={side.name} size="sm" ring={ringColour(side.id)} you={side.id === viewerId} />
                    <span className={styles.tn}><b>{side.name}</b>{decided && match.winnerId === side.id && <Star />}</span>
                  </div>
                ))}
                <div className={styles.tmid}><TableScore match={match} /></div>
                {sides.slice(1).map((side) => (
                  <div key={side.id} className={styles.th} data-pos={side.pos} style={{ "--hc": ringColour(side.id) } as CSSProperties}>
                    <Mono name={side.name} size="sm" ring={ringColour(side.id)} you={side.id === viewerId} />
                    <span className={styles.tn}><b>{side.name}</b>{decided && match.winnerId === side.id && <Star />}</span>
                  </div>
                ))}
              </div>
              <div className={styles.tfoot}>
                <p className={styles.tstat}>{tableStatus(tournament, match, viewerId)}</p>
                <ul className={styles.tslots} aria-label="This round">
                  {sides.map((side) => (
                    <li key={side.id}>
                      <SlotZone tournament={tournament} zone={zoneFor(tournament, side.id, round, null)} playerId={side.id} viewerId={viewerId} size="xs" focusable={false} />
                    </li>
                  ))}
                </ul>
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
