"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { DuelRoom } from "@yugidraft/shared/duels";
import { cancelSeries, readySeries } from "./api";
import { SheetButton } from "./sheet-ui";
import resultStyles from "./duel-result.module.css";
import styles from "./series.module.css";
import { canCancelInterrupted, formatCountdown, seriesPlayerIndex, secondsUntil } from "./series-model";

/** Whole seconds left until `iso`, ticking twice a second; null when there is no deadline. */
export function useSecondsUntil(iso: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [iso]);
  return secondsUntil(iso, now);
}

type ButtonKind = "primary" | "secondary" | "quiet";

/** The result screen has its own button look; the room strip uses the Match Sheet buttons. */
function Action({ tone, kind, disabled, loading, onClick, children }: {
  tone: "result" | "sheet";
  kind: ButtonKind;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  if (tone === "result") {
    return (
      <button type="button" className={resultStyles.btn} data-kind={kind} disabled={disabled || loading}
        aria-busy={loading || undefined} onClick={onClick}>
        {children}
      </button>
    );
  }
  return <SheetButton kind={kind} size="sm" loading={loading} disabled={disabled} onClick={onClick}>{children}</SheetButton>;
}

/**
 * The between-games controls: countdown, Ready, the side deck button and (for an interrupted casual
 * series) Cancel series. Shown while the series waits between games on this duel.
 */
export function SeriesNextControls({ room, slug, tone, onChanged, onNavigate, onOpenSide, beforeReady }: {
  room: DuelRoom;
  slug: string;
  tone: "result" | "sheet";
  /** Refresh the room after a change. */
  onChanged: () => void;
  /** Go to the next game's room. */
  onNavigate: (slug: string) => void;
  /** Open the side deck panel; only offered to a player with a side deck. */
  onOpenSide?: () => void;
  /** Runs before Ready, e.g. to save pending side deck swaps. */
  beforeReady?: () => Promise<void>;
}) {
  const series = room.series;
  const seconds = useSecondsUntil(series?.nextGameAt ?? null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!series) return null;

  const index = seriesPlayerIndex(room, series);
  const imReady = index != null && series.sideReady[index];
  const theirReady = index != null && series.sideReady[index === 0 ? 1 : 0];
  const theirName = index != null ? series.displayNames[index === 0 ? 1 : 0] : null;
  const canSide = index != null && series.hasSide[index] && onOpenSide != null;
  const interrupted = series.nextGameAt == null;

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong. Try again.");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const ready = () => run(async () => {
    await beforeReady?.();
    const result = await readySeries(slug);
    if (result.nextSlug) onNavigate(result.nextSlug);
    else onChanged();
  });
  const cancel = () => run(async () => {
    await cancelSeries(series.id);
    setConfirmCancel(false);
    onChanged();
  });

  const status = index == null ? "Waiting for the players."
    : imReady ? (theirReady ? "Both players are ready." : `Waiting for ${theirName}.`)
      : interrupted ? "The last game did not finish. Both players must click Ready to play on."
        : canSide ? "Swap cards from your Side Deck, then click Ready." : "Click Ready to start sooner.";

  return (
    <section className={styles.next} data-tone={tone} aria-label="Next game">
      <p className={styles.countdown} role="timer" data-waiting={seconds == null ? "true" : undefined}>
        {seconds != null ? <>Game {series.gameNumber + 1} in <b>{formatCountdown(seconds)}</b></> : "Waiting for both players"}
      </p>
      <p className={styles.status} role="status">{status}</p>
      {index != null ? (
        <div className={styles.actions}>
          <Action tone={tone} kind="primary" loading={busy && !confirmCancel} disabled={imReady || busy} onClick={() => void ready()}>
            {imReady ? "Ready" : "Ready for next game"}
          </Action>
          {canSide ? <Action tone={tone} kind="secondary" disabled={busy} onClick={onOpenSide}>Side deck</Action> : null}
          {canCancelInterrupted(series) ? (
            confirmCancel ? (
              <>
                <Action tone={tone} kind="secondary" loading={busy} disabled={busy} onClick={() => void cancel()}>Confirm cancel</Action>
                <Action tone={tone} kind="quiet" disabled={busy} onClick={() => setConfirmCancel(false)}>Keep series</Action>
              </>
            ) : (
              <Action tone={tone} kind="quiet" disabled={busy} onClick={() => setConfirmCancel(true)}>Cancel series</Action>
            )
          ) : null}
        </div>
      ) : null}
      {interrupted && series.tournamentId != null && index != null ? (
        <p className={styles.note}>The tournament organizer can set the result if this match cannot go on.</p>
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </section>
  );
}
