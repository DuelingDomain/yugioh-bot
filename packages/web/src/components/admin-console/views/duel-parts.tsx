"use client";

import type { ReactNode } from "react";
import { duration } from "@/lib/admin-console/format";
import { formatClock, formatDayMonthClock } from "@/lib/admin-console/time";
import type { LiveSeat, SeatOutcome, TodayDuel, TodayResult, UserKey } from "@/lib/admin-console/types";
import { Avatar, Tag, WatchLink } from "../parts";
import styles from "../admin-console.module.css";

const OUTCOME_WORD: Record<Exclude<SeatOutcome, null>, string> = { won: "Won", lost: "Lost", draw: "Draw" };
const RESULT_WORD: Record<Exclude<TodayResult, "won">, string> = { live: "Live", draw: "Draw", interrupted: "Interrupted", cancelled: "Cancelled", idle: "Idle" };

export function Seat({ seat, toPlay, outcome, onOpen }: { seat: LiveSeat; toPlay?: boolean; outcome?: SeatOutcome; onOpen: (userId: UserKey) => void }) {
  const mark: ReactNode = toPlay ? <span className={styles.toPlay}>To decide</span>
    : outcome ? <span className={styles.outcome} data-outcome={outcome}>{OUTCOME_WORD[outcome]}</span> : <span />;
  const body = (
    <>
      <Avatar name={seat.name} url={seat.avatarUrl} size="sm" bot={seat.bot} />
      <span className={styles.nm}>{seat.name}</span>
      {mark}
    </>
  );
  return seat.userId !== null
    ? <button type="button" className={styles.pl} onClick={() => onOpen(seat.userId!)} title={`Open ${seat.name}`} style={{ textAlign: "left" }}>{body}</button>
    : <div className={styles.pl}>{body}</div>;
}

function resultText(duel: TodayDuel): string {
  if (duel.result !== "won") return RESULT_WORD[duel.result];
  const winners = duel.seats.filter((seat) => seat.outcome === "won").map((seat) => seat.name);
  return winners.length ? `${winners.join(" & ")} won` : "Won";
}

export function TodayRow({ duel, onOpen, now, showDay }: { duel: TodayDuel; onOpen: (userId: UserKey) => void; now: number; showDay?: boolean }) {
  const running = duel.result === "live" || duel.result === "idle";
  const facts = [duel.turns != null ? `${duel.turns} ${duel.turns === 1 ? "turn" : "turns"}` : null, duration((duel.endedAt ?? now) - duel.startedAt)].filter(Boolean).join(" · ");
  return (
    <div className={styles.tblRow} role="row">
      <div className={styles.cFmt} role="cell">
        <div className={styles.fmt}>{duel.formatLabel.replace(" duel", "")}<Tag tone={duel.ranked ? "gold" : undefined}>{duel.ranked ? "Ranked" : "Casual"}</Tag></div>
        <div className={styles.fmtSmall} title={duel.name}>{duel.genesys ? "Genesys · " : ""}{duel.name}</div>
      </div>
      <div className={`${styles.cPl} ${styles.players}`} role="cell">
        {duel.seats.map((seat, i) => <Seat key={`${seat.name}-${i}`} seat={seat} outcome={seat.outcome} onOpen={onOpen} />)}
      </div>
      <div className={`${styles.cRes} ${styles.res}`} role="cell" data-result={duel.result}>
        <b title={resultText(duel)}>{duel.result === "live" ? <span className={styles.dot} data-tone="good" /> : null}{resultText(duel)}</b>
        <small>{facts}</small>
      </div>
      <div className={`${styles.cAt} ${styles.num}`} role="cell"><time dateTime={new Date(duel.startedAt).toISOString()}>{showDay ? formatDayMonthClock(duel.startedAt) : formatClock(duel.startedAt)}</time></div>
      <div className={styles.cAct} role="cell">
        {running ? <WatchLink href={duel.href} label="Watch" /> : <WatchLink href={duel.href} label="Replay" icon="play" />}
      </div>
    </div>
  );
}

