"use client";

import { useEffect, useState } from "react";
import { ChainMedallion, LivePill } from "@/components/sheet";
import { formatRecent, parseDbTime } from "../sheet-dates";
import type { Match } from "../types";
import { decidedPlayers, firstGameWinner, reportNames, type ViewerState } from "./match-model";
import styles from "./matches.module.css";

/** This leaf alone ticks; the queue and its other rows never update on a tick. */
export function BetweenGames({ match }: { match: Match }) {
  const deadline = parseDbTime(match.series?.nextGameAt)?.getTime() ?? null;
  const secondsLeft = () => (deadline === null ? 0 : Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  const [seconds, setSeconds] = useState(secondsLeft);
  useEffect(() => {
    setSeconds(secondsLeft());
    if (deadline === null || deadline <= Date.now()) return;
    const interval = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSeconds(left);
      if (left === 0) window.clearInterval(interval);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [deadline]); // The deadline, rather than the refreshed tournament object, drives the clock.
  if (deadline === null) return <>Between games. Side decking.</>;
  return (
    <span>
      Between games. Game {(match.series?.gameNumber ?? 1) + 1} starts in{" "}
      <b className={styles.countdown}>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</b>. Side decking.
    </span>
  );
}

/** The state line under a match. `stakes` is the viewer's Elo swing on a match they play. */
export function MatchState({ match, state, format, hours, stakes }: {
  match: Match; state: ViewerState; format: string; hours: number; stakes?: { win: number; lose: number } | null;
}) {
  const { reporter, other, won } = reportNames(match);
  const firstWinner = firstGameWinner(match);
  const when = formatRecent(match.resolvedAt);
  return (
    <p className="m-state">
      {state === "your-open" && (
        <span>
          Your match. Not started.
          {stakes && <> <span className="lp-d up">+{stakes.win}</span> <span className="lp-d down">−{Math.abs(stakes.lose)}</span></>}
        </span>
      )}
      {state === "open" && <span>Not started</span>}
      {state === "reported" && (
        <>
          <ChainMedallion size="xs" />
          <span className="ink">You reported a {won ? "win" : "loss"}.</span>
          <span>{other} has {hours} hours to confirm, then it approves itself</span>
        </>
      )}
      {state === "confirm" && (
        <>
          <ChainMedallion size="xs" />
          <span className="ink">{reporter} says they {won ? "won" : "lost"}.</span>
          <span>Your reply. If you do nothing, it approves itself after {hours} hours.</span>
        </>
      )}
      {state === "pending" && (
        <>
          <ChainMedallion size="xs" />
          <span className="ink">{reporter} reported a {won ? "win" : "loss"}.</span>
          <span>{other} has {hours} hours to approve or deny, then it approves itself.</span>
        </>
      )}
      {state === "live" && (
        <>
          <LivePill />
          <span>Game {match.series?.gameNumber} in progress{firstWinner ? `. ${firstWinner} took game 1` : ""}.</span>
        </>
      )}
      {state === "between-games" && (
        <>
          <LivePill />
          <BetweenGames match={match} />
        </>
      )}
      {(state === "decided" || state === "reopening") && (
        <span>
          {decidedPlayers(match).winner.name} won{when ? `, ${when}` : ""}.
          {match.series?.status === "completed" ? ` Online, best of ${match.series.bestOf}.` : ""}
        </span>
      )}
      {state === "bye" && <span>No match to play. Not counted as a win in standings.</span>}
      {format === "single_elim" && <span>Round {match.roundNumber}.</span>}
    </p>
  );
}
