"use client";

import { useEffect, useState } from "react";
import sheet from "@/components/sheet/sheet.module.css";
import { formatRecent, parseDbTime } from "../sheet-dates";
import type { Match } from "../types";
import { decidedPlayers, firstGameWinner, reportNames, type ViewerState } from "./match-model";
import styles from "./matches.module.css";

/** This leaf alone ticks; the queue and its other rows never update on a tick. */
export function BetweenGames({ match }: { match: Match }) {
  const deadline = parseDbTime(match.series?.nextGameAt)?.getTime() ?? null;
  const secondsLeft = () => deadline === null ? 0 : Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
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
  if (deadline === null) return <>Between games · side decking</>;
  return <span>Between games · game {(match.series?.gameNumber ?? 1) + 1} starts in <b className={styles.countdown}>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</b> · side decking</span>;
}

export function MatchState({ match, state, lamp, format, hours }: { match: Match; state: ViewerState; lamp: string; format: string; hours: number }) {
  const { reporter, other, won } = reportNames(match);
  const firstWinner = firstGameWinner(match);
  const ink = `${sheet.ink} ${styles.ink}`;
  return <p className={styles["m-state"]}>
    {state !== "confirm" && state !== "bye" && <span className={sheet.lamp} data-s={lamp} />}
    {state === "your-open" && <span>Your match · not started</span>}
    {state === "open" && <span>Not started</span>}
    {state === "reported" && <><span className={ink}>You reported a {won ? "win" : "loss"}.</span><span>{other} has {hours} hours to confirm, then it approves itself</span></>}
    {state === "confirm" && <><span className={ink}>{reporter} says they {won ? "won" : "lost"}.</span><span>If you do nothing, it approves itself after {hours} hours.</span></>}
    {state === "pending" && <><span className={ink}>{reporter} reported a {won ? "win" : "loss"}.</span><span>{other} has {hours} hours to approve or deny, then it approves itself.</span></>}
    {state === "live" && <span>Game {match.series?.gameNumber} in progress{firstWinner ? ` · ${firstWinner} won game 1` : ""}</span>}
    {state === "between-games" && <BetweenGames match={match} />}
    {state === "decided" && <span>{decidedPlayers(match).winner.name} won{formatRecent(match.resolvedAt) ? ` · ${formatRecent(match.resolvedAt)}` : ""}{match.series?.status === "completed" ? ` · online, best of ${match.series.bestOf}` : ""}</span>}
    {state === "bye" && <span>No match to play · not counted as a win in standings</span>}
    {format === "single_elim" && <span>· Round {match.roundNumber}</span>}
  </p>;
}
