"use client";

import { useEffect, useId, useState } from "react";
import {
  clockNote, DISPUTE_NOTE_MAX, nameOf, proposalLine, reportOf, sourceText, timeLeftText,
  type RemotePair, type RemoteReport, type RemoteResult,
} from "../remote-result";
import { useRemoteResult, type RemoteResultState } from "./use-remote-result";
import styles from "./remote-result-panel.module.css";

/** Re-reads the clock every 30 seconds, so "time left" moves without a request. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function answerText(report: RemoteReport | null): { text: string; tone: "yes" | "no" | "wait" } {
  if (report?.choice === "confirm") return { text: "Confirmed", tone: "yes" };
  if (report?.choice === "dispute") return { text: "Disputed", tone: "no" };
  return { text: "No answer yet", tone: "wait" };
}

const STATUS_TEXT: Record<RemoteResult["status"], string> = {
  playing: "Playing", proposed: "Needs answers", disputed: "Disputed", final: "Final", void: "Voided",
};

/** The panel body for a result the parent already holds. Pure view: the hook sits in `RemoteResultSlot`. */
export function RemoteResultView({ result, pair, viewerId, busy, error, onConfirm, onDispute, now }: {
  result: RemoteResult;
  pair: RemotePair;
  /** The viewer's player id when they are one of the pair, else null (then the panel only shows). */
  viewerId: number | null;
  busy: "confirm" | "dispute" | null;
  error: string | null;
  onConfirm: () => void;
  onDispute: (note: string) => void;
  now: number;
}) {
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState("");
  const noteId = useId();
  const mine = viewerId === null ? null : reportOf(result, viewerId);
  const canAnswer = viewerId !== null && result.status === "proposed" && !mine?.choice;
  const left = result.confirmDeadlineAt !== null ? timeLeftText(result.confirmDeadlineAt, now) : null;
  const timeUp = result.status === "proposed" && result.confirmDeadlineAt !== null && left === null;
  const clock = viewerId === null ? null : clockNote(result, viewerId, pair);
  const players = [pair.playerOneId, pair.playerTwoId];

  return (
    <section className={styles.panel} data-testid="remote-result-panel" data-status={result.status} aria-label="Remote result">
      <header className={styles.head}>
        <span className={styles.kicker}>Remote result</span>
        <span className={styles.chip} data-status={result.status}>{STATUS_TEXT[result.status]}</span>
      </header>

      {result.status === "playing" ? (
        <p className={styles.line}>The table is open. The result shows here when the match ends.</p>
      ) : result.status === "void" ? (
        <p className={styles.line}>The organizer voided this result. Play the match again.</p>
      ) : (
        <>
          <p className={styles.headline} data-testid="remote-result-line">
            {proposalLine(result, pair)}
            {result.status === "proposed" && viewerId !== null && !mine?.choice && <span className={styles.ask}> Confirm or Dispute.</span>}
          </p>
          {sourceText(result.source) && <p className={styles.sub}>{sourceText(result.source)}</p>}

          <ul className={styles.answers} aria-label="Answers">
            {players.map((id) => {
              const answer = answerText(reportOf(result, id));
              return (
                <li key={id} className={styles.answer} data-tone={answer.tone}>
                  <span className={styles.who}>{id === viewerId ? "You" : nameOf(pair, id)}</span>
                  <span className={styles.what}>{answer.text}</span>
                </li>
              );
            })}
          </ul>

          {result.status === "proposed" && (
            <p className={styles.time} data-testid="remote-result-time" data-up={timeUp || undefined}>
              {timeUp ? "Time is up. It is being finalized." : left ? <><b>{left}</b> left to answer</> : null}
            </p>
          )}
          {clock && <p className={styles.sub}>{clock}</p>}
          {result.status === "disputed" && <p className={styles.line}>A player disputed the result. The organizer will decide.</p>}
          {result.status === "final" && <p className={styles.line}>This result is final and counts in the standings.</p>}
          {mine?.choice === "dispute" && mine.note && <p className={styles.note}>Your note: {mine.note}</p>}
        </>
      )}

      {canAnswer && !disputing && (
        <div className={styles.acts}>
          <button type="button" className={styles.btn} data-kind="primary" disabled={busy !== null} onClick={onConfirm}>Confirm</button>
          <button type="button" className={styles.btn} data-kind="danger" disabled={busy !== null} onClick={() => setDisputing(true)}>Dispute</button>
        </div>
      )}
      {canAnswer && disputing && (
        <form
          className={styles.dispute}
          onSubmit={(event) => { event.preventDefault(); onDispute(note); }}
        >
          <label htmlFor={noteId} className={styles.label}>What was wrong? (optional)</label>
          <textarea
            id={noteId}
            className={styles.text}
            rows={2}
            maxLength={DISPUTE_NOTE_MAX}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Short note for the organizer"
            autoFocus
          />
          <div className={styles.acts}>
            <button type="submit" className={styles.btn} data-kind="danger" disabled={busy !== null}>Send dispute</button>
            <button type="button" className={styles.btn} data-kind="quiet" disabled={busy !== null} onClick={() => { setDisputing(false); setNote(""); }}>Cancel</button>
            <span className={styles.count} aria-hidden="true">{note.length}/{DISPUTE_NOTE_MAX}</span>
          </div>
        </form>
      )}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </section>
  );
}

/** The panel for a result a parent already loads with `useRemoteResult`. It renders nothing until a Remote result exists. */
export function RemoteResultPanel({ state, pair, viewerId }: { state: RemoteResultState; pair: RemotePair; viewerId: number | null }) {
  const { result } = state;
  const now = useNow(result?.status === "proposed");
  if (!result) return null;
  return <RemoteResultView result={result} pair={pair} viewerId={viewerId} busy={state.busy} error={state.error} onConfirm={state.confirm} onDispute={state.dispute} now={now} />;
}

/** Loads the result and shows the panel: for places that need nothing else from the result (the Remote room). */
export function RemoteResultSlot({ tournamentSlug, tournamentMatchId, pair, viewerId, onChanged }: {
  tournamentSlug: string;
  tournamentMatchId: number;
  pair: RemotePair;
  viewerId: number | null;
  onChanged?: () => void;
}) {
  const state = useRemoteResult({ tournamentSlug, tournamentMatchId, enabled: true, onChanged });
  return <RemoteResultPanel state={state} pair={pair} viewerId={viewerId} />;
}
