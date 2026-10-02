"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { DuelRoom, DuelSeriesSummary } from "@yugidraft/shared/duels";
import { cancelSeries, chooseSeriesFirst, readySeries } from "./api";
import { SheetButton } from "./sheet-ui";
import resultStyles from "./duel-result.module.css";
import styles from "./series.module.css";
import { canCancelInterrupted, formatCountdown, opponentFirstStatus, opponentSideStatus, seriesPlayerIndex, secondsUntil, viewerChoosesFirst } from "./series-model";

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

/** "Opponent is siding…" or "Opponent ready": the other player's state between games. Null for a spectator. */
export function OpponentSideChip({ series, index }: { series: DuelSeriesSummary; index: 0 | 1 | null }) {
  const status = opponentSideStatus(series, index);
  if (!status) return null;
  return (
    <p className={styles.opp} data-ready={status.ready ? "true" : "false"} role="status" data-testid="opponent-side-status">
      <i aria-hidden />{status.text}
    </p>
  );
}

/** "Opponent is choosing to go first or second…" and then what they chose. Null when nobody chooses. */
export function OpponentFirstChip({ series, index }: { series: DuelSeriesSummary; index: 0 | 1 | null }) {
  const status = opponentFirstStatus(series, index);
  if (!status) return null;
  return (
    <p className={styles.opp} data-ready={status.done ? "true" : "false"} role="status" data-testid="opponent-first-status">
      <i aria-hidden />{status.text}
    </p>
  );
}

/** The loser's Go first / Go second choice. The default, Go first, is what happens when the timer ends. */
export function FirstChoiceGroup({ series, busy, onChoose }: {
  series: DuelSeriesSummary;
  busy: boolean;
  onChoose: (choice: "first" | "second") => void;
}) {
  const myChoice = series.firstChoice ?? "first";
  return (
    <div className={styles.first} role="group" aria-label="Who goes first in the next game" data-testid="first-choice">
      <p className={styles.firstHead}>You lost, so you choose</p>
      <div className={styles.firstRow}>
        {(["first", "second"] as const).map((choice) => (
          <button key={choice} type="button" className={styles.firstBtn} aria-pressed={myChoice === choice}
            data-testid={`first-choice-${choice}`} disabled={busy} onClick={() => onChoose(choice)}>
            Go {choice}
          </button>
        ))}
      </div>
      <p className={styles.firstNote}>
        {series.firstChoice == null ? "Go first is chosen when the timer ends." : `You will go ${series.firstChoice}.`}
      </p>
    </div>
  );
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
 * The between-games controls for a spectator or a strip: countdown, Ready and (for an interrupted
 * casual series) Cancel series. The players side their decks on the Between games screen instead.
 */
export function SeriesNextControls({ room, slug, tone, onChanged, onNavigate }: {
  room: DuelRoom;
  slug: string;
  tone: "result" | "sheet";
  /** Refresh the room after a change. */
  onChanged: () => void;
  /** Go to the next game's room. */
  onNavigate: (slug: string) => void;
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
  const interrupted = series.nextGameAt == null;
  const choosing = viewerChoosesFirst(series, index);

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
    const result = await readySeries(slug);
    if (result.nextSlug) onNavigate(result.nextSlug);
    else onChanged();
  });
  const choose = (choice: "first" | "second") => run(async () => {
    if (choice === series.firstChoice) return;
    const result = await chooseSeriesFirst(slug, choice);
    if (result.nextSlug) onNavigate(result.nextSlug);
    else onChanged();
  });
  const cancel = () => run(async () => {
    await cancelSeries(series.id);
    setConfirmCancel(false);
    onChanged();
  });

  const status = index == null ? "Waiting for the players."
    : imReady ? (theirReady ? "Both players are ready." : "You are ready.")
      : interrupted ? "The last game did not finish. Both players must click Ready to play on."
        : "Click Ready to start sooner.";

  return (
    <section className={styles.next} data-tone={tone} aria-label="Next game">
      <p className={styles.countdown} role="timer" data-waiting={seconds == null ? "true" : undefined}>
        {seconds != null ? <>Game {series.gameNumber + 1} in <b>{formatCountdown(seconds)}</b></> : "Waiting for both players"}
      </p>
      <p className={styles.status} role="status">{status}</p>
      <OpponentSideChip series={series} index={index} />
      <OpponentFirstChip series={series} index={index} />
      {choosing ? (
        <FirstChoiceGroup series={series} busy={busy} onChoose={(choice) => void choose(choice)} />
      ) : null}
      {index != null ? (
        <div className={styles.actions}>
          <Action tone={tone} kind="primary" loading={busy && !confirmCancel} disabled={imReady || busy} onClick={() => void ready()}>
            {imReady ? "Ready" : "Ready for next game"}
          </Action>
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
