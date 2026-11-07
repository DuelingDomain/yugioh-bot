"use client";

import { useEffect, useRef, useState } from "react";
import { REMOTE_OPENING_ROUND_MS, type RemoteActionProposal, type RemoteOpening } from "@yugidraft/shared/remote";
import { DiceDie } from "@/components/duel/dice-die";
import { DICE_TIMELINE, DICE_TIMELINE_REDUCED, dicePlan, landingOf, landsAt } from "@/components/duel/dice-model";
import { useDiceSkin } from "@/components/duel/dice-skins";
import { duelFontClasses } from "@/components/duel/fonts";
import { cx, SheetButton } from "@/components/duel/sheet-ui";
import rootStyles from "@/components/duel/opening.module.css";
import styles from "@/components/duel/dice-opening.module.css";
import s from "./opening-roll.module.css";

type Act = (proposal: RemoteActionProposal) => Promise<unknown>;

/** The latest roll of a seat up to and including `round`. */
function valueAt(rounds: RemoteOpening["rounds"], seat: number, round: number): number {
  for (let r = round; r >= 0; r--) { const roll = rounds[r]?.[seat]; if (roll != null) return roll; }
  return 1;
}

/**
 * The opening die roll of game 1: every seat throws a die, tied seats throw again, and the highest roll chooses who
 * goes first. The server rolled everything when the table started; this plays the stored rounds on the server clock,
 * so a reload or a late spectator sees the same dice. Skip jumps to the result.
 */
export function OpeningRollScreen({ opening, mySeat, name, now, act, error: outsideError }: {
  opening: RemoteOpening; mySeat: number; name: (seat: number) => string; now: () => number; act: Act; error?: string | null;
}) {
  const skin = useDiceSkin();
  const [reduced, setReduced] = useState(false);
  useEffect(() => { try { setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch { /* keep motion */ } }, []);
  const timeline = reduced ? DICE_TIMELINE_REDUCED : DICE_TIMELINE;
  const [clock, setClock] = useState(() => now());
  useEffect(() => {
    setClock(now());
    const timer = window.setInterval(() => setClock(now()), 150);
    return () => window.clearInterval(timer);
  }, [now]);
  const [skipped, setSkipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setError] = useState<string | null>(null);
  const error = localError ?? outsideError ?? null;

  const rounds = opening.rounds;
  const seatCount = rounds[0]?.length ?? 2;
  const diceEnd = opening.startedAt + rounds.length * REMOTE_OPENING_ROUND_MS;
  const elapsed = clock - opening.startedAt;
  const rolling = !skipped && clock < diceEnd;
  const round = rolling ? Math.max(0, Math.min(rounds.length - 1, Math.floor(elapsed / REMOTE_OPENING_ROUND_MS))) : rounds.length - 1;
  const inRound = elapsed - round * REMOTE_OPENING_ROUND_MS;
  const isLast = round === rounds.length - 1;
  const winner = opening.winnerSeat;
  const iWin = mySeat === winner;
  const left = opening.deadline - clock;

  // The choice clock ends at the deadline: the server applies the default, a check just asks soon after.
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return undefined;
    const timer = window.setTimeout(() => { sent.current = true; void act({ type: "side.timeout", actorSeat: mySeat >= 0 ? mySeat : 0 }); }, Math.max(0, opening.deadline - now()) + 1500);
    return () => window.clearTimeout(timer);
  }, [opening.deadline, now, act, mySeat]);

  const choose = async (seat: number) => {
    setBusy(true); setError(null);
    try { await act({ type: "match.first", actorSeat: mySeat, seatGoesFirst: seat }); } catch (cause) { setError(cause instanceof Error ? cause.message : "Something went wrong. Try again."); } finally { setBusy(false); }
  };

  const landed = (seat: number) => !rolling || inRound >= landsAt(dicePlan(round, seat, timeline), timeline);
  const tiedSeats = isLast ? [] : rounds[round + 1]!.flatMap((roll, seat) => (roll == null ? [] : [seat]));
  const topTied = rolling && !isLast && inRound >= timeline.tieAt;
  const status = rolling
    ? (topTied ? { main: `Tie: ${tiedSeats.map(name).join(" and ")} roll again`, kind: "tie" }
      : { main: round === 0 ? "Rolling for the first choice" : "Rolling again", kind: "plain" })
    : { main: `${name(winner)} won the roll`, kind: "win" };
  const note = rolling ? "" : iWin ? "You choose who goes first." : `${name(winner)} chooses who goes first.`;
  const sampleElapsed = () => now() - opening.startedAt - round * REMOTE_OPENING_ROUND_MS;

  return (
    <div className={cx(rootStyles.root, duelFontClasses)} role="dialog" aria-modal="true" aria-labelledby="opening-roll-title" data-testid="remote-opening-roll" data-stage={rolling ? "rolling" : "choose"} data-reduced={reduced ? "true" : undefined}>
      {rolling ? <SheetButton kind="quiet" size="sm" className={s.skip} onClick={() => setSkipped(true)} data-testid="opening-roll-skip">Skip</SheetButton> : null}
      <div className={styles.stage}>
        <header className={styles.head}>
          <h2 id="opening-roll-title" className={styles.title}>Who goes first?</h2>
          <p className={styles.sub}>Highest roll chooses</p>
        </header>
        <p className={rootStyles.sr} role="status" aria-live="polite" data-testid="opening-roll-live">
          {rolling ? "" : `${rounds.at(-1)!.map((roll, seat) => (roll == null ? "" : `${name(seat)} rolled ${roll}. `)).join("")}${status.main}.`}
        </p>
        <div className={styles.status} data-kind={status.kind} data-testid="opening-roll-status">
          <span key={status.main} className={styles.main}>{status.main}</span>
          <span key={note} className={styles.note}>{note}</span>
        </div>
        <div className={cx(styles.row, seatCount === 2 && s.row2)} data-n={seatCount} data-testid="opening-roll-row">
          {Array.from({ length: seatCount }, (_, seat) => {
            const roll = rounds[round]![seat] ?? null;
            const sat = roll == null;
            const isTied = topTied && tiedSeats.includes(seat);
            const isWinner = !rolling && seat === winner;
            const state = sat ? "kept" : isTied ? "tied" : "landed";
            const shown = landed(seat) || sat;
            return (
              <div key={seat} className={cx(styles.tile, styles[`s${seat}` as "s0"])} role="group" aria-label={`${name(seat)}${seat === mySeat ? " (you)" : ""}, rolled ${valueAt(rounds, seat, round)}`}
                data-testid={`opening-roll-tile-${seat}`} data-state={state} data-me={seat === mySeat ? "true" : "false"} data-first={isWinner ? "true" : undefined}>
                <div className={styles.rankrow}>
                  <span className={styles.chip} data-on={isWinner || isTied ? "true" : "false"} data-kind={isWinner ? "rank" : "tie"} data-first={isWinner ? "true" : undefined}>{isWinner ? "Chooses" : isTied ? "Tie" : ""}</span>
                </div>
                <div className={styles.dieBox}>
                  <DiceDie value={valueAt(rounds, seat, round)} skin={skin} throwRound={rolling && !sat ? round : null}
                    plan={dicePlan(round, seat, timeline)} timeline={timeline} landing={rolling && !sat ? landingOf({ round, rolls: rounds[round]! }, seat) : null}
                    tied={isTied} reduced={reduced} sampleElapsed={sampleElapsed} />
                </div>
                <div className={styles.who}><span className={styles.av} aria-hidden /><span className={styles.nm}>{name(seat)}</span></div>
                <div className={styles.cap} aria-hidden><b>{shown && !sat ? `Rolled ${roll}` : sat ? "Keeps " + valueAt(rounds, seat, round) : "Rolling…"}</b></div>
                {seat === mySeat ? <span className={styles.you}>You</span> : null}
              </div>
            );
          })}
        </div>
        {!rolling ? (
          <div className={s.choice} data-testid="opening-roll-choice">
            {iWin ? (
              <div className={s.actions}>
                {Array.from({ length: seatCount }, (_, seat) => (
                  <SheetButton key={seat} kind={seat === winner ? "primary" : "secondary"} size="lg" disabled={busy || left <= 0} onClick={() => void choose(seat)}
                    data-testid={seat === winner ? "opening-roll-first" : seatCount === 2 ? "opening-roll-second" : `opening-roll-first-${seat}`}>
                    {seat === winner ? "I go first" : seatCount === 2 ? "I go second" : `${name(seat)} goes first`}
                  </SheetButton>
                ))}
              </div>
            ) : <p className={styles.note} data-testid="opening-roll-waiting">Waiting for {name(winner)} to choose</p>}
            <p className={s.countdown}>{left > 0 ? <>{iWin ? "Choose within" : "Auto-start in"}<b>{Math.ceil(left / 1000)} s</b></> : "Starting…"}</p>
          </div>
        ) : null}
        {error ? <p className={rootStyles.error} role="alert">{error}</p> : null}
      </div>
    </div>
  );
}
