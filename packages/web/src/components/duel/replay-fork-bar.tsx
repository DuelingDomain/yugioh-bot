"use client";

import { useState } from "react";
import Link from "next/link";
import { GitFork, SlidersHorizontal } from "lucide-react";
import type { ReplayForkControl } from "@yugidraft/shared/duels";
import { Sheet } from "@/components/ui/sheet";
import { FRAME_PARAM } from "./replay-controller";
import { askAllState, type AskState } from "./replay-fork-control";
import styles from "./replay-fork.module.css";

/** Where the fork came from: the source replay, opened at the frame the fork started from. */
export function sourceReplayHref(origin: Pick<ReplayForkControl["origin"], "sourceSlug" | "sourceFrameId">): string {
  const query = new URLSearchParams({ [FRAME_PARAM]: origin.sourceFrameId });
  return `/duels/${encodeURIComponent(origin.sourceSlug)}/replay?${query.toString()}`;
}

const ASK_COPY: Record<AskState, string> = {
  all: "Every seat asks at every response window.",
  mixed: "Some seats skip response windows.",
  unknown: "The response windows are not known yet.",
};

/**
 * The fork's own controls in the table header: a badge, one button per seat and a Controls sheet. The seat buttons
 * pick which seat the table shows and answers for; the sheet holds the switches and the two destructive actions,
 * each behind a second click.
 */
export function ReplayForkBar({
  fork, seatName, living, waitingSeat, follow, reveal, disabled, onPickSeat, onFollow, onReveal, onAskAll, onRestart, onEnd,
}: {
  fork: ReplayForkControl;
  seatName: (seat: number) => string;
  /** Seats that can still act. A seat that is out stays in the row but cannot be picked. */
  living: readonly number[];
  /** The seat the engine waits on; marked with a gold dot. */
  waitingSeat: number | null;
  follow: boolean;
  reveal: boolean;
  /** An answer is out, the table is catching up, or the view is not the one that was asked for. */
  disabled: boolean;
  onPickSeat: (seat: number) => void;
  onFollow: (next: boolean) => void;
  onReveal: (next: boolean) => void;
  onAskAll: () => void;
  onRestart: () => void;
  onEnd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<"restart" | "end" | null>(null);
  const ask = askAllState(fork.chainModes, living);
  const close = () => { setOpen(false); setConfirm(null); };
  return (
    <span className={styles.group} data-replay-fork-bar>
      <strong className={styles.badge} title="A private copy. The source duel never changes.">
        <GitFork size={13} aria-hidden /> Replay fork
      </strong>
      <span className={styles.chips} role="group" aria-label="Acting seat">
        {fork.manualSeats.map((seat) => (
          <button key={seat} type="button" className={styles.chip} aria-pressed={fork.actingSeat === seat}
            data-prompt={waitingSeat === seat ? "true" : undefined}
            title={`Play as ${seatName(seat)}${waitingSeat === seat ? " (the engine waits for this seat)" : ""}`}
            disabled={disabled || !living.includes(seat)} onClick={() => onPickSeat(seat)}>
            {seatName(seat)}
          </button>
        ))}
      </span>
      <button type="button" className={styles.btn} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <SlidersHorizontal size={14} aria-hidden /><span className={styles.wide}>Fork controls</span>
        <span className="sr-only">Fork controls</span>
      </button>
      <Sheet open={open} onClose={close} title="Fork controls">
        <div className={styles.sheetBody}>
          <label className={styles.check}>
            <input type="checkbox" checked={follow} onChange={(event) => onFollow(event.target.checked)} />
            <span>Follow prompt</span>
          </label>
          <p className={styles.hint}>Switch to the seat that must answer. Picking a seat holds it until the next prompt.</p>
          <label className={styles.check}>
            <input type="checkbox" checked={reveal} disabled={disabled} onChange={(event) => onReveal(event.target.checked)} />
            <span>Reveal hands</span>
          </label>
          <div>
            <button type="button" className={styles.action} disabled={disabled || living.length === 0} onClick={onAskAll}>
              Ask at all response windows
            </button>
            <p className={styles.hint} role="status">{ASK_COPY[ask]}</p>
          </div>
          <p className={styles.hint}>
            Copied from the replay at move {fork.origin.sourceStep}.{" "}
            <Link href={sourceReplayHref(fork.origin)} className="underline">Open the source replay</Link>
          </p>
          {confirm === null ? (
            <div className={styles.group}>
              <button type="button" className={styles.action} disabled={disabled} onClick={() => setConfirm("restart")}>Restart from start point</button>
              <button type="button" className={`${styles.action} ${styles.danger}`} disabled={disabled} onClick={() => setConfirm("end")}>End fork</button>
            </div>
          ) : (
            <div className={styles.group} role="group" aria-label="Confirm">
              <span className={styles.note}>
                {confirm === "restart" ? "This drops every move played in the fork." : "This closes the fork and goes back to the replay."}
              </span>
              <button type="button" className={`${styles.action} ${styles.danger}`} disabled={disabled}
                onClick={() => { const next = confirm; close(); if (next === "restart") onRestart(); else onEnd(); }}>
                {confirm === "restart" ? "Restart" : "End fork"}
              </button>
              <button type="button" className={styles.action} onClick={() => setConfirm(null)}>Keep playing</button>
            </div>
          )}
        </div>
      </Sheet>
    </span>
  );
}

/** What replaces the live result screen: the fork has no stats or rematch, only a way back. */
export function ReplayForkResult({ headline, reason, sourceHref, disabled, onRestart, onClose }: {
  headline: string;
  reason: string | null;
  sourceHref: string;
  disabled: boolean;
  onRestart: () => void;
  onClose: () => void;
}) {
  return (
    <div className={styles.result} role="status" data-replay-fork-result>
      <strong>{headline}</strong>
      {reason ? <span>{reason}</span> : null}
      <span className={styles.group}>
        <button type="button" className={styles.btn} disabled={disabled} onClick={onRestart}>Restart from start point</button>
        <Link href={sourceHref} className={styles.btn}>Back to replay</Link>
        <button type="button" className={styles.btn} onClick={onClose}>Show board</button>
      </span>
    </div>
  );
}
