"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { GitBranch, GitFork } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { cancelReplayFork, getOpenReplayForks, isDuelAccessError, type OpenReplayFork } from "./api";
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

export interface OpenForksState {
  /** Null until a list has arrived. */
  forks: OpenReplayFork[] | null;
  limit: number | null;
  loading: boolean;
  error: string | null;
  /** The route refused this user (not an owner). Nothing is shown and it is not asked again. */
  denied: boolean;
  refresh: () => Promise<void>;
}

/**
 * The owner's open forks. `enabled` is false for anyone who is not an owner: the route is then never called and the state
 * stays empty (fail closed). A refusal from the server hides the list for good.
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
      if (isDuelAccessError(error)) {
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

function ForkRow({ fork, onCancelled }: { fork: OpenReplayFork; onCancelled: () => Promise<void> }) {
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
        <Link className={styles.forkSource} href={`/duels/${encodeURIComponent(fork.sourceSlug)}/replay`} title="Source replay">
          From {fork.sourceSlug}
        </Link>
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
export function OpenForksList({ state }: { state: OpenForksState }) {
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
          {forks.map((fork) => <ForkRow key={fork.slug} fork={fork} onCancelled={state.refresh} />)}
        </ul>
      )}
    </div>
  );
}

/**
 * The sheet with the list. `limitHit` is set when Jump in was refused for the limit: it says so and offers the retry once
 * a place is free.
 */
export function OpenForksSheet({ open, onClose, state, limitHit = false, onRetry, retryBusy = false }: {
  open: boolean;
  onClose: () => void;
  state: OpenForksState;
  limitHit?: boolean;
  onRetry?: () => void;
  retryBusy?: boolean;
}) {
  // The shells draw the header inside a layer of its own, where a fixed sheet would sit under the replay strip. A portal to
  // the page body avoids that.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setHost(document.body); }, []);
  if (state.denied || !host) return null;
  const full = state.forks != null && state.limit != null && state.forks.length >= state.limit;
  return createPortal(
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
        <OpenForksList state={state} />
        {limitHit && onRetry ? (
          <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={retryBusy || full || state.loading || state.forks == null}
            onClick={onRetry}>
            <GitFork size={14} aria-hidden />
            <span>Jump in again</span>
          </button>
        ) : null}
      </div>
    </Sheet>,
    host,
  );
}

/** "Open forks (N)": the owner finds a fork left open. Nothing renders until the server has answered for an owner. */
export function OpenForksButton({ state }: { state: OpenForksState }) {
  const [open, setOpen] = useState(false);
  if (state.denied || state.forks == null) return null;
  return (
    <>
      <button type="button" className={styles.btn} aria-haspopup="dialog" aria-expanded={open} data-open-forks-button title={`Open forks (${state.forks.length})`}
        onClick={() => { setOpen(true); void state.refresh(); }}>
        <GitBranch size={14} aria-hidden />
        <span className="sr-only">Open forks ({state.forks.length})</span>
        <span className={styles.forkCount} aria-hidden="true">{state.forks.length}</span>
      </button>
      <OpenForksSheet open={open} onClose={() => setOpen(false)} state={state} />
    </>
  );
}
