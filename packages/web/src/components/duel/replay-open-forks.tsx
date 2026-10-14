"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { GitBranch, GitFork } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { DuelRequestError, cancelReplayFork, getOpenReplayForks, type OpenReplayFork } from "./api";
import { formatLabel } from "./table-format";
import styles from "./replay-fork.module.css";

/** A server time ("YYYY-MM-DD HH:MM:SS", UTC) as a timestamp. Null when the text is not that shape. */
export function parseUtcStamp(text: string): number | null {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(text.trim());
  if (!match) return null;
  const time = Date.parse(`${match[1]}T${match[2]}Z`);
  return Number.isNaN(time) ? null : time;
}

/** "just now", "5 min ago", "2 h ago", "3 d ago". Empty when the time is unknown. */
export function relativeAgo(text: string, now = Date.now()): string {
  const time = parseUtcStamp(text);
  if (time == null) return "";
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/**
 * The server refused this user (not an owner, or no session). A 503 is not a refusal: the access check was down for a
 * moment, so the list stays retryable.
 */
function isListRefusal(error: unknown): boolean {
  return error instanceof DuelRequestError && (error.code === "ACCESS_DENIED" || error.status === 401 || error.status === 403 || error.status === 404);
}

/**
 * Renders in a layer on the page body. The shells draw the header inside a layer of its own, where a fixed sheet would
 * sit under the replay strip; a portal to the body avoids that.
 */
export function BodyPortal({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(document.body); }, []);
  return host ? createPortal(children, host) : null;
}

export interface OpenForksState {
  /** Null until a list has arrived. */
  forks: OpenReplayFork[] | null;
  limit: number | null;
  loading: boolean;
  error: string | null;
  /** The route refused this user (not an owner). Nothing is shown and it is not asked again. A 503 is an error instead. */
  denied: boolean;
  refresh: () => Promise<void>;
}

/**
 * The owner's open forks. `enabled` is false for anyone who is not an owner: the route is then never called and the state
 * stays empty (fail closed). A refusal from the server hides the list for good; an outage shows an error that can be retried.
 */
export function useOpenForks(enabled: boolean): OpenForksState {
  const [state, setState] = useState<Omit<OpenForksState, "refresh">>({ forks: null, limit: null, loading: false, error: null, denied: false });
  const latest = useRef(0);
  const mounted = useRef(true);
  const deniedRef = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const refresh = useCallback(async () => {
    if (!enabled || deniedRef.current) return;
    const mine = ++latest.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const list = await getOpenReplayForks();
      if (mounted.current && mine === latest.current) setState({ forks: list.forks, limit: list.limit, loading: false, error: null, denied: false });
    } catch (error) {
      if (!mounted.current || mine !== latest.current) return;
      if (isListRefusal(error)) {
        deniedRef.current = true;
        setState({ forks: null, limit: null, loading: false, error: null, denied: true });
      } else {
        setState((current) => ({ ...current, loading: false, error: error instanceof Error && error.message ? error.message : "Could not load your open forks." }));
      }
    }
  }, [enabled]);
  useEffect(() => {
    if (!enabled) {
      latest.current += 1;
      deniedRef.current = false;
      setState({ forks: null, limit: null, loading: false, error: null, denied: false });
      return;
    }
    void refresh();
  }, [enabled, refresh]);
  return { ...state, refresh };
}

function ForkRow({ fork, onCancelled, currentSlug }: { fork: OpenReplayFork; onCancelled: () => Promise<void>; currentSlug?: string }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const started = relativeAgo(fork.createdAt);
  const active = relativeAgo(fork.lastActivityAt);
  const createdMs = parseUtcStamp(fork.createdAt);

  async function cancel() {
    setBusy(true);
    setFailure(null);
    try {
      await cancelReplayFork(fork.slug);
    } catch (error) {
      // A fork that is already gone (ended, or not found) needs no cancel: the refreshed list drops it.
      const status = (error as { status?: number } | null)?.status;
      if (status !== 404 && status !== 409) {
        setFailure(error instanceof Error && error.message ? error.message : "Could not cancel this fork.");
        setBusy(false);
        return;
      }
    }
    await onCancelled();
    setBusy(false);
    setConfirming(false);
  }

  return (
    <li className={styles.forkRow} data-open-fork={fork.slug}>
      <div className={styles.forkInfo}>
        <span className={styles.forkFormat}>{formatLabel(fork.format)}</span>
        {fork.sourceSlug === currentSlug ? (
          // A link to the replay on screen would do nothing.
          <span className={styles.forkSource} data-fork-source-here>From this replay ({fork.sourceSlug})</span>
        ) : (
          <Link className={styles.forkSource} href={`/duels/${encodeURIComponent(fork.sourceSlug)}/replay`} title="Source replay">
            From {fork.sourceSlug}
          </Link>
        )}
        <span className={styles.forkTimes} title={createdMs != null ? `Started ${new Date(createdMs).toLocaleString()}` : undefined}>
          {started ? `Started ${started}` : null}{started && active ? " · " : null}{active ? `Active ${active}` : null}
        </span>
      </div>
      <div className={styles.forkActions}>
        {confirming ? (
          <>
            <span className={styles.note}>Cancel this fork? The source replay does not change.</span>
            <button type="button" className={`${styles.btn} ${styles.dangerBtn}`} disabled={busy} onClick={() => void cancel()}>
              {busy ? "Cancelling…" : "Cancel fork"}
            </button>
            <button type="button" className={styles.btn} disabled={busy} onClick={() => setConfirming(false)}>Keep</button>
          </>
        ) : (
          <>
            <Link className={styles.btn} href={`/duels/${encodeURIComponent(fork.slug)}`} aria-label={`Open the ${formatLabel(fork.format)} fork from ${fork.sourceSlug}`}>Open</Link>
            <button type="button" className={styles.btn} aria-label={`Cancel the ${formatLabel(fork.format)} fork from ${fork.sourceSlug}`} onClick={() => setConfirming(true)}>Cancel</button>
          </>
        )}
      </div>
      {failure ? <p role="alert" className={styles.alert}>{failure}</p> : null}
    </li>
  );
}

/** The list itself: one row for each open fork, with Open and a confirmed Cancel. */
export function OpenForksList({ state, currentSlug }: { state: OpenForksState; currentSlug?: string }) {
  if (state.denied) return null;
  const { forks } = state;
  return (
    <div className={styles.forkList} data-open-forks-list>
      {state.error ? (
        <p role="alert" className={styles.alert}>
          {state.error}{" "}
          <button type="button" className={styles.btn} onClick={() => void state.refresh()}>Try again</button>
        </p>
      ) : null}
      {forks == null ? (state.error ? null : <p className={styles.note}>Loading your forks…</p>) : forks.length === 0 ? (
        <p className={styles.note}>You have no open forks.</p>
      ) : (
        <ul className={styles.forkItems}>
          {forks.map((fork) => <ForkRow key={fork.slug} fork={fork} onCancelled={state.refresh} currentSlug={currentSlug} />)}
        </ul>
      )}
    </div>
  );
}

/**
 * The sheet with the list. `limitHit` is set when Jump in was refused for the limit: it says so and offers the retry once
 * a place is free.
 */
export function OpenForksSheet({ open, onClose, state, currentSlug, limitHit = false, onRetry, retryBusy = false }: {
  open: boolean;
  onClose: () => void;
  state: OpenForksState;
  /** The replay on screen. A fork made from it says so instead of linking to the page already open. */
  currentSlug?: string;
  limitHit?: boolean;
  onRetry?: () => void;
  retryBusy?: boolean;
}) {
  if (state.denied) return null;
  const full = state.forks != null && state.limit != null && state.forks.length >= state.limit;
  return (
    <BodyPortal>
      <Sheet open={open} onClose={onClose} title="Open forks">
        <div className={styles.sheetBody} data-open-forks-sheet>
          {limitHit ? (
            <p className={styles.hint} role="status">
              {full || state.forks == null
                ? `You have too many open forks${state.limit != null ? ` (limit ${state.limit})` : ""}. Cancel one to start another.`
                : "There is room for a new fork now."}
            </p>
          ) : (
            <p className={styles.hint}>
              {state.limit != null ? `You can keep ${state.limit} forks open.` : "Forks you left open."} They are private to you.
            </p>
          )}
          <OpenForksList state={state} currentSlug={currentSlug} />
          {limitHit && onRetry ? (
            <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={retryBusy || full || state.loading || state.forks == null}
              onClick={onRetry}>
              <GitFork size={14} aria-hidden />
              <span>Jump in again</span>
            </button>
          ) : null}
        </div>
      </Sheet>
    </BodyPortal>
  );
}

/** "Open forks (N)": the owner finds a fork left open. Nothing renders until the server has answered for an owner. */
export function OpenForksButton({ state, currentSlug }: { state: OpenForksState; currentSlug?: string }) {
  const [open, setOpen] = useState(false);
  // No list and no error yet: nothing to show. An outage with no list still shows the entry, so the owner can try again.
  if (state.denied || (state.forks == null && !state.error)) return null;
  const count = state.forks?.length ?? null;
  const name = count != null ? `Open forks (${count})` : "Open forks (could not load)";
  return (
    <>
      <button type="button" className={styles.btn} aria-haspopup="dialog" aria-expanded={open} data-open-forks-button title={name}
        onClick={() => { setOpen(true); void state.refresh(); }}>
        <GitBranch size={14} aria-hidden />
        <span className="sr-only">{name}</span>
        <span className={styles.forkCount} aria-hidden="true">{count ?? "!"}</span>
      </button>
      <OpenForksSheet open={open} onClose={() => setOpen(false)} state={state} currentSlug={currentSlug} />
    </>
  );
}
