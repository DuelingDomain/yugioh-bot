"use client";

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import { GitFork, SlidersHorizontal } from "lucide-react";
import type { ReplayForkControl } from "@yugidraft/shared/duels";
import { Sheet } from "@/components/ui/sheet";
import { useBugReportHeaderHost } from "../bug-report/room-store";
import { BodyPortal } from "./replay-open-forks";
import { FRAME_PARAM } from "./replay-controller";
import { askAllState, type AskState } from "./replay-fork-control";
import styles from "./replay-fork.module.css";

/** Where the fork came from: the source replay, opened at the frame the fork started from. */
export function sourceReplayHref(origin: Pick<ReplayForkControl["origin"], "sourceSlug" | "sourceFrameId">): string {
  const query = new URLSearchParams({ [FRAME_PARAM]: origin.sourceFrameId });
  return `/duels/${encodeURIComponent(origin.sourceSlug)}/replay?${query.toString()}`;
}

/** A click that opens the link in this tab. Ctrl, Cmd, Shift and non-primary buttons open a new tab or window and keep this page. */
function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
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
  fork, seatName, living, waitingSeat, follow, reveal, disabled, onPickSeat, onFollow, onReveal, onAskAll, onRestart, onEnd, ended = false, onLeave, held = false, onShowResult,
  open: controlledOpen, onOpenChange,
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
  /** The room keeps the sheet open when a loading or access view temporarily unmounts the bar. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The fork is over (a result or a closed session). There is nothing to cancel: only the way back stays. */
  ended?: boolean;
  /** The creator goes to the source replay by a link. An open fork is closed then, so it does not fill the fork limit. */
  onLeave?: () => void;
  /** The seat on screen was picked by hand (or Follow prompt is off), so it stays when another seat must answer. */
  held?: boolean;
  /** Opens the result panel again after "Show board". Only the live Tag and FFA shells need it: they have no button of their own. */
  onShowResult?: () => void;
}) {
  useBugReportHeaderHost();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = onOpenChange ?? setOwnOpen;
  const [confirm, setConfirm] = useState<"restart" | "end" | "source" | null>(null);
  const ask = askAllState(fork.chainModes, living);
  const close = () => { setOpen(false); setConfirm(null); };
  return (
    <span className={styles.group} data-replay-fork-bar>
      <strong className={styles.badge} title="A private copy. The source duel never changes.">
        <GitFork size={13} aria-hidden /> <span className={styles.badgeText}>Replay fork</span>
      </strong>
      <span className={styles.chips} role="group" aria-label="Acting seat">
        {fork.manualSeats.map((seat) => (
          <button key={seat} type="button" className={styles.chip} aria-pressed={fork.actingSeat === seat}
            data-prompt={waitingSeat === seat ? "true" : undefined}
            title={`Play as ${seatName(seat)}${waitingSeat === seat ? " (the engine waits for this seat)" : ""}`}
            disabled={disabled || !living.includes(seat)} onClick={() => onPickSeat(seat)}>
            <span className={styles.full}>{seatName(seat)}</span>
            <span className={styles.short} aria-hidden>{seat + 1}</span>
          </button>
        ))}
      </span>
      {held && waitingSeat != null && waitingSeat !== fork.actingSeat && living.includes(waitingSeat) && !ended ? (
        <span className={`${styles.group} ${styles.waiting}`} role="status" data-replay-fork-waiting>
          <span className={styles.note}>{seatName(waitingSeat)} must answer</span>
          <button type="button" className={styles.btn} disabled={disabled} aria-label={`Switch to ${seatName(waitingSeat)}`}
            onClick={() => onPickSeat(waitingSeat)}>Switch</button>
        </span>
      ) : null}
      {onShowResult ? <button type="button" className={styles.btn} onClick={onShowResult}>Show result</button> : null}
      <button type="button" className={styles.btn} title="Fork controls" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <SlidersHorizontal size={14} aria-hidden /><span className={styles.wide} aria-hidden="true">Fork controls</span>
        <span className="sr-only">Fork controls</span>
      </button>
      <BodyPortal>
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
              {/* A plain click asks first: the link closes the fork. A click for a new tab keeps this page and the fork. */}
              <Link href={sourceReplayHref(fork.origin)} className="underline"
                onClick={(event) => { if (isPlainClick(event)) { event.preventDefault(); setConfirm("source"); } }}>
                Close fork and open the source replay
              </Link>
            </p>
            {confirm === null ? (
              <div className={styles.group}>
                <button type="button" className={styles.action} disabled={disabled} onClick={() => setConfirm("restart")}>Restart from start point</button>
                {ended ? null : <button type="button" className={`${styles.action} ${styles.danger}`} disabled={disabled} onClick={() => setConfirm("end")}>End fork</button>}
              </div>
            ) : (
              <div className={styles.group} role="group" aria-label="Confirm">
                <span className={styles.note}>
                  {confirm === "restart" ? "This drops every move played in the fork."
                    : confirm === "source" ? "This closes the fork and opens the source replay." : "This closes the fork and goes back to the replay."}
                </span>
                {confirm === "source" ? (
                  <Link href={sourceReplayHref(fork.origin)} className={`${styles.action} ${styles.danger}`}
                    onClick={(event) => { if (isPlainClick(event)) { onLeave?.(); close(); } }}>
                    Close fork and open the source replay
                  </Link>
                ) : (
                  <button type="button" className={`${styles.action} ${styles.danger}`} disabled={disabled}
                    onClick={() => { const next = confirm; close(); if (next === "restart") onRestart(); else onEnd(); }}>
                    {confirm === "restart" ? "Restart" : "End fork"}
                  </button>
                )}
                <button type="button" className={styles.action} onClick={() => setConfirm(null)}>Keep playing</button>
              </div>
            )}
          </div>
        </Sheet>
      </BodyPortal>
    </span>
  );
}

/** What replaces the live result screen: the fork has no stats or rematch, only a way back. */
export function ReplayForkResult({ headline, reason, sourceHref, disabled, onRestart, onClose, onLeave, ended = false }: {
  headline: string;
  reason: string | null;
  sourceHref: string;
  disabled: boolean;
  onRestart: () => void;
  onClose: () => void;
  onLeave?: () => void;
  /** The fork is already closed: "Back to replay" is a plain link, with nothing to confirm. */
  ended?: boolean;
}) {
  // A plain click on "Back to replay" asks first: it closes the fork when it is still open. A click for a new tab does not.
  const [confirming, setConfirming] = useState(false);
  return (
    <div className={styles.result} role="status" data-replay-fork-result>
      <strong>{headline}</strong>
      {reason ? <span>{reason}</span> : null}
      {confirming ? <span className={styles.note}>This closes the fork and opens the source replay.</span> : null}
      <span className={styles.group}>
        <button type="button" className={styles.btn} disabled={disabled} onClick={onRestart}>Restart from start point</button>
        {confirming ? (
          <>
            <Link href={sourceHref} className={styles.btn} onClick={(event) => { if (isPlainClick(event)) onLeave?.(); }}>Close fork and open the source replay</Link>
            <button type="button" className={styles.btn} onClick={() => setConfirming(false)}>Stay here</button>
          </>
        ) : (
          <Link href={sourceHref} className={styles.btn}
            onClick={(event) => { if (!ended && isPlainClick(event)) { event.preventDefault(); setConfirming(true); } }}>Back to replay</Link>
        )}
        <button type="button" className={styles.btn} onClick={onClose}>Show board</button>
      </span>
    </div>
  );
}
