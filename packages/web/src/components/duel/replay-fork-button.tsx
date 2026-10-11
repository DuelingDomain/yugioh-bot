"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GitFork, Eye } from "lucide-react";
import type { ReplayFrameV2, ReplayForkStep } from "@yugidraft/shared/duels";
import { Sheet } from "@/components/ui/sheet";
import { isDuelAccessError, postReplayFork } from "./api";
import { replayFailure, type ReplayModel } from "./replay-controller";
import { BodyPortal, OpenForksButton, OpenForksSheet, type OpenForksState } from "./replay-open-forks";
import styles from "./replay-fork.module.css";

/** How long Jump in stays shut after the fork was made, while the page loads it. */
const FORK_NAVIGATION_WAIT_MS = 15_000;

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

/** What the Jump in request holds. It lives above the replay shells: a seek remounts their header, and this must survive it. */
export interface ForkStartState {
  pending: boolean;
  /** The open forks sheet that opens when Jump in is refused for the limit. */
  limitOpen: boolean;
  setLimitOpen: (open: boolean) => void;
  failure: { message: string; code?: string } | null;
  clearFailure: () => void;
  start: () => Promise<void>;
}

/**
 * The request behind "Jump in here": makes a private fork of the selected frame and opens it. One retry key is kept for
 * each frame until the fork is made, so a second click or a network retry cannot make a second fork. Call it from a
 * component that is not remounted by a seek (the replay view), not from the header.
 */
export function useForkStart({ slug, model, frame, onReload, onPause, openForks }: {
  slug: string;
  model: ReplayModel | null;
  /** The move to jump in at: the selected frame, or the chosen move when the saved views were over the size cap. */
  frame: ReplayForkStep | undefined;
  onReload?: () => void;
  onPause?: () => void;
  /** The owner's open forks. When Jump in is refused for the limit, they are refreshed. */
  openForks?: OpenForksState;
}): ForkStartState {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);
  const [failure, setFailure] = useState<{ message: string; code?: string } | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const inFlight = useRef(false);
  const mounted = useRef(true);
  // The fork exists and the page is on its way to it. The button stays shut for that whole time: a second click would be
  // a second fork. If the page never leaves (a stalled navigation) the button opens again after a while; the request id
  // is kept, so even then the same click again returns the same fork.
  const navigating = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (navigating.current) clearTimeout(navigating.current);
    };
  }, []);

  // A different frame is a different request. Its old failure no longer applies.
  const frameId = frame?.frameId ?? null;
  const sourceVersion = model?.sourceVersion ?? undefined;
  useEffect(() => { setFailure(null); }, [frameId, sourceVersion]);
  // Another replay is another request set.
  useEffect(() => {
    requestIds.current.clear();
    setFailure(null);
    setLimitOpen(false);
  }, [slug]);

  async function start() {
    const cursor = frame?.cursor;
    if (!model || !canOfferFork(model) || !frame || !cursor || !sourceVersion || inFlight.current) return;
    inFlight.current = true;
    onPause?.();
    setPending(true);
    setFailure(null);
    const key = `${slug}:${frame.frameId}:${cursor}:${sourceVersion}`;
    let requestId = requestIds.current.get(key);
    if (!requestId) {
      requestId = newForkRequestId();
      requestIds.current.set(key, requestId);
    }
    try {
      const result = await postReplayFork(slug, { cursor, sourceVersion, requestId });
      // Pending and the request id both stay until the page has left.
      navigating.current = setTimeout(() => {
        navigating.current = null;
        inFlight.current = false;
        if (mounted.current) setPending(false);
      }, FORK_NAVIGATION_WAIT_MS);
      router.push(`/duels/${encodeURIComponent(result.slug)}`);
      return;
    } catch (error) {
      if (isDuelAccessError(error)) onReload?.();
      const text = replayFailure(error, "Could not start a fork.");
      const code = (error as { code?: string } | null)?.code;
      if (code === "REQUEST_CONFLICT" || code === "SOURCE_CHANGED") requestIds.current.clear();
      if (code === "FORK_LIMIT" && openForks && !openForks.denied) {
        void openForks.refresh();
        if (mounted.current) setLimitOpen(true);
      }
      if (mounted.current) setFailure({ message: text.message, code });
    }
    inFlight.current = false;
    if (mounted.current) setPending(false);
  }

  return { pending, limitOpen, setLimitOpen, failure, clearFailure: () => setFailure(null), start };
}

/** "Jump in here". The request state comes from `useForkStart`, which the replay view owns. */
export function ReplayForkButton({ slug, model, frame, busy = false, onReload, fork, openForks }: {
  slug: string;
  model: ReplayModel;
  frame: ReplayForkStep | undefined;
  /** True while the replay answer is not for the current view. */
  busy?: boolean;
  onReload?: () => void;
  fork: ForkStartState;
  /** The owner's open forks. When Jump in is refused for the limit, they show in a sheet so one can be cancelled. */
  openForks?: OpenForksState;
}) {
  const { pending, failure, limitOpen } = fork;
  if (!canOfferFork(model)) return null;
  const reason = forkDisabledReason(frame);
  const disabled = pending || busy || reason != null;

  return (
    <span className={styles.group} data-replay-fork>
      <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={disabled} aria-busy={pending || undefined}
        title={reason ?? "Make a private copy from this move and play every seat"}
        aria-describedby={reason ? `fork-reason-${slug}` : undefined}
        onClick={() => void fork.start()}>
        <GitFork size={14} aria-hidden />
        <span>{pending ? "Starting…" : <>Jump in<span className={styles.wide}> here</span></>}</span>
      </button>
      {reason && !pending ? <span id={`fork-reason-${slug}`} className="sr-only">{reason}</span> : null}
      {failure ? (
        // Through the body: the HUD pill has a backdrop-filter, which would trap a fixed box inside the pill.
        <BodyPortal>
          <span role="alert" className={styles.failureBox} data-fork-failure>
            {failure.message}{" "}
            {failure.code === "SOURCE_CHANGED" && onReload ? (
              <button type="button" className={styles.btn} onClick={() => { fork.clearFailure(); onReload(); }}>Reload replay</button>
            ) : null}
          </span>
        </BodyPortal>
      ) : null}
      {openForks ? (
        <OpenForksSheet open={limitOpen} onClose={() => fork.setLimitOpen(false)} state={openForks} currentSlug={slug} limitHit retryBusy={disabled}
          onRetry={() => { fork.setLimitOpen(false); fork.clearFailure(); void fork.start(); }} />
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
        <span className={styles.wide} aria-hidden="true">Private view</span>
        <span className="sr-only">Private view</span>
      </button>
      <BodyPortal>
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
      </BodyPortal>
    </>
  );
}

/** True when the server answer carries owner capabilities. Anything else is not an owner (fail closed). */
export function isOwnerModel(model: ReplayModel | null | undefined): model is ReplayModel {
  return model != null && model.version === 2 && Boolean(model.capabilities);
}

/**
 * The move Jump in starts from. Normally the selected frame. When the replay was over the size cap the server sends only
 * step cursors (`forkSteps`): then it is the chosen step, or the first step that can start a fork.
 */
export function forkTarget(model: ReplayModel | null, frame: ReplayFrameV2 | undefined, selectedStep: string | null): ReplayForkStep | undefined {
  const steps = model?.forkSteps;
  if (!steps) return frame;
  return steps.find((step) => step.frameId === selectedStep) ?? steps.find((step) => step.cursor !== null);
}

/**
 * The owner cluster for every replay layout: private view, open forks, then Jump in. The open forks list and the Jump in
 * request are passed in: this cluster is remounted by every seek in the table shells and holds no state that must last.
 */
export function ReplayOwnerTools({ model, frame, busy, view, onViewChange, onReload, slug, selectedStep, onSelectStep, openForks, fork }: {
  slug: string;
  model: ReplayModel;
  frame: ReplayFrameV2 | undefined;
  busy?: boolean;
  view: OwnerViewState;
  onViewChange: (next: OwnerViewState) => void;
  selectedStep: string | null;
  onSelectStep: (frameId: string) => void;
  onReload?: () => void;
  openForks: OpenForksState;
  fork: ForkStartState;
}) {
  if (!isOwnerModel(model)) return null;
  const steps = model.forkSteps;
  const checkpoint = forkTarget(model, frame, selectedStep);
  return (
    <span className={styles.group} data-replay-owner-tools>
      {steps ? <>
        <span className={styles.note}>{model.frames.length ? "Final board preview." : "No board preview."} Choose a move to Jump in.</span>
        <select className={styles.btn} aria-label="Jump in at move" title="Choose a move to Jump in" disabled={busy} value={checkpoint?.frameId ?? ""}
          onChange={event => onSelectStep(event.target.value)}>
          {steps.map(step => <option key={step.frameId} value={step.frameId} disabled={step.cursor === null}>
            Move {step.step}{step.actorSeat === null ? "" : ` · Seat ${step.actorSeat + 1}`}
          </option>)}
        </select>
      </> : null}
      <ReplayOwnerView model={model} view={view} busy={busy} onChange={onViewChange} />
      <OpenForksButton state={openForks} currentSlug={slug} />
      <ReplayForkButton slug={slug} model={model} frame={checkpoint} busy={busy} onReload={onReload} fork={fork} openForks={openForks} />
    </span>
  );
}
