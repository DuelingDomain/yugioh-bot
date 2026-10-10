"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GitFork, Eye } from "lucide-react";
import type { ReplayFrameV2 } from "@yugidraft/shared/duels";
import { Sheet } from "@/components/ui/sheet";
import { postReplayFork } from "./api";
import { replayFailure, type ReplayModel } from "./replay-controller";
import styles from "./replay-fork.module.css";

/** A fresh retry key. It matches the server's key syntax (letters, digits, ".", "_", ":", "-"; at most 128). */
export function newForkRequestId(): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `fork-${random}`;
}

/** The owner may start a fork only when the server said so for this answer. Anything else fails closed. */
export function canOfferFork(model: Pick<ReplayModel, "version" | "capabilities" | "sourceVersion">): boolean {
  return model.version === 2 && model.capabilities?.canFork === true && typeof model.sourceVersion === "string" && model.sourceVersion.length > 0;
}

export function forkDisabledReason(frame: Pick<ReplayFrameV2, "cursor" | "kind"> | undefined): string | null {
  if (!frame) return "No move is selected.";
  if (frame.cursor == null) {
    return frame.kind === "result"
      ? "The final result is not a start point. Pick an earlier move."
      : "This frame is not a start point. Pick another move.";
  }
  return null;
}

/**
 * "Jump in here": makes a private fork of the selected frame and opens it. One retry key is kept for each frame
 * until the fork is made, so a second click or a network retry cannot make a second fork.
 */
export function ReplayForkButton({ slug, model, frame, busy = false, onReload, onPause }: {
  slug: string;
  model: ReplayModel;
  frame: ReplayFrameV2 | undefined;
  /** True while the replay answer is not for the current view. */
  busy?: boolean;
  onReload?: () => void;
  onPause?: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ message: string; code?: string } | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // A different frame is a different request. Its old failure no longer applies.
  const frameId = frame?.frameId ?? null;
  useEffect(() => { setFailure(null); }, [frameId, model.sourceVersion]);

  if (!canOfferFork(model)) return null;
  const reason = forkDisabledReason(frame);
  const disabled = pending || busy || reason != null;

  async function start() {
    const cursor = frame?.cursor;
    const sourceVersion = model.sourceVersion;
    if (!frame || !cursor || !sourceVersion || inFlight.current) return;
    inFlight.current = true;
    onPause?.();
    setPending(true);
    setFailure(null);
    const key = `${frame.frameId}:${cursor}:${sourceVersion}`;
    let requestId = requestIds.current.get(key);
    if (!requestId) {
      requestId = newForkRequestId();
      requestIds.current.set(key, requestId);
    }
    try {
      const result = await postReplayFork(slug, { cursor, sourceVersion, requestId });
      requestIds.current.delete(key);
      router.push(`/duels/${encodeURIComponent(result.slug)}`);
    } catch (error) {
      const text = replayFailure(error, "Could not start a fork.");
      const code = (error as { code?: string } | null)?.code;
      if (code === "REQUEST_CONFLICT" || code === "SOURCE_CHANGED") requestIds.current.clear();
      if (mounted.current) setFailure({ message: text.message, code });
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <span className={styles.group} data-replay-fork>
      <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={disabled} aria-busy={pending || undefined}
        title={reason ?? "Make a private copy from this move and play every seat"}
        aria-describedby={reason ? `fork-reason-${slug}` : undefined}
        onClick={() => void start()}>
        <GitFork size={14} aria-hidden />
        <span>{pending ? "Starting…" : <>Jump in<span className={styles.wide}> here</span></>}</span>
      </button>
      {reason && !pending ? <span id={`fork-reason-${slug}`} className="sr-only">{reason}</span> : null}
      {failure ? (
        <span role="alert" className={styles.alert}>
          {failure.message}{" "}
          {failure.code === "SOURCE_CHANGED" && onReload ? (
            <button type="button" className={styles.btn} onClick={() => { setFailure(null); onReload(); }}>Reload replay</button>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/** What an owner can change in the card view. `seat` shows that seat's cards; `reveal` fills every hand. */
export interface OwnerViewState {
  seat: number | null;
  reveal: boolean;
}

/**
 * Owner-only private view: card view of one seat and the reveal switch. It shows only when the server answer
 * carried owner capabilities, and the choice is sent with the owner replay request.
 */
export function ReplayOwnerView({ model, view, busy = false, onChange }: {
  model: ReplayModel;
  view: OwnerViewState;
  busy?: boolean;
  onChange: (next: OwnerViewState) => void;
}) {
  const [open, setOpen] = useState(false);
  const caps = model.capabilities;
  if (model.version !== 2 || !caps) return null;
  const seats = caps.privateSeats.filter((seat) => model.session.seats.some((player) => player.seat === seat));
  const nameOf = (seat: number) => model.session.seats.find((player) => player.seat === seat)?.displayName ?? `Player ${seat + 1}`;
  if (seats.length === 0) return null;
  return (
    <>
      <button type="button" className={styles.btn} aria-haspopup="dialog" aria-expanded={open} data-replay-owner-view
        aria-pressed={view.seat != null || view.reveal} onClick={() => setOpen(true)}>
        <Eye size={14} aria-hidden />
        <span className={styles.wide}>Private view</span>
        <span className="sr-only">Private view</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Private view">
        <div className={styles.sheetBody}>
          <label>
            <span>Show cards of</span>
            <select aria-label="Show cards of" value={view.seat ?? ""} disabled={busy}
              onChange={(event) => onChange({ ...view, seat: event.target.value === "" ? null : Number(event.target.value) })}>
              <option value="">Default view</option>
              {seats.map((seat) => <option key={seat} value={seat}>{nameOf(seat)} (seat {seat + 1})</option>)}
            </select>
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={view.reveal} disabled={busy}
              onChange={(event) => onChange({ ...view, reveal: event.target.checked })} />
            <span>Reveal all hands</span>
          </label>
          <p className={styles.hint}>Only you see this. Players and the saved duel do not change.</p>
        </div>
      </Sheet>
    </>
  );
}

/** The owner cluster for every replay layout: private view, then Jump in. */
export function ReplayOwnerTools({ model, frame, busy, view, onViewChange, onReload, onPause, slug }: {
  slug: string;
  model: ReplayModel;
  frame: ReplayFrameV2 | undefined;
  busy?: boolean;
  view: OwnerViewState;
  onViewChange: (next: OwnerViewState) => void;
  onReload?: () => void;
  onPause?: () => void;
}) {
  if (model.version !== 2 || !model.capabilities) return null;
  return (
    <span className={styles.group} data-replay-owner-tools>
      <ReplayOwnerView model={model} view={view} busy={busy} onChange={onViewChange} />
      <ReplayForkButton slug={slug} model={model} frame={frame} busy={busy} onReload={onReload} onPause={onPause} />
    </span>
  );
}
