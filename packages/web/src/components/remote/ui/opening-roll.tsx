"use client";

import { useEffect, useRef, useState } from "react";
import type { DuelDiceOpeningView } from "@yugidraft/shared/duels";
import { REMOTE_OPENING_ROUND_MS, remoteOpeningChooser, type RemoteActionProposal, type RemoteOpening } from "@yugidraft/shared/remote";
import { DiceDie } from "@/components/duel/dice-die";
import { DICE_TIMELINE, DICE_TIMELINE_REDUCED, currentRound, diceBeat, dicePlan, diceStatus, dieValue, landingOf, nameList, rollSummary, tileOf } from "@/components/duel/dice-model";
import { useDiceSkin } from "@/components/duel/dice-skins";
import { duelFontClasses } from "@/components/duel/fonts";
import { Countdown } from "@/components/duel/opening";
import { cx, SheetButton } from "@/components/duel/sheet-ui";
import rootStyles from "@/components/duel/opening.module.css";
import styles from "@/components/duel/dice-opening.module.css";
import s from "./opening-roll.module.css";

type Act = (proposal: RemoteActionProposal) => Promise<unknown>;

/**
 * The opening die roll of game 1: every seat throws a die, tied seats throw again, and the highest roll chooses who
 * goes first. The server rolled everything when the table started; this plays the stored rounds on the server clock,
 * so a reload or a late spectator sees the same dice. It draws the duel room's dice opening (same dice, tiles, skin and
 * wording from `components/duel`) and ends with the duel room's go-first / go-second choice. Skip jumps to the result.
 */
export function OpeningRollScreen({ opening, mySeat, name, now, act, out = [], error: outsideError }: {
  opening: RemoteOpening; mySeat: number; name: (seat: number) => string; now: () => number;
  /** Absent for a spectator: the screen only shows the dice and who chooses. */
  act?: Act;
  /** Seats that have left the game: they cannot choose and are not offered as the first player. */
  out?: readonly boolean[];
  error?: string | null;
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
  const me = mySeat >= 0 ? mySeat : null;
  const diceEnd = opening.startedAt + rounds.length * REMOTE_OPENING_ROUND_MS;
  const elapsed = clock - opening.startedAt;
  const rolling = !skipped && clock < diceEnd;
  const round = rolling ? Math.max(0, Math.min(rounds.length - 1, Math.floor(elapsed / REMOTE_OPENING_ROUND_MS))) : rounds.length - 1;
  const inRound = rolling ? elapsed - round * REMOTE_OPENING_ROUND_MS : Number.POSITIVE_INFINITY;
  const isLast = round === rounds.length - 1;
  const auto = opening.auto === true;
  // The die-roll winner chooses; if the winner is out of the game, the next living seat by roll order does.
  const chooser = remoteOpeningChooser(opening, Array.from({ length: seatCount }, (_, seat) => ({ eliminated: !!out[seat] })));
  const iChoose = me === chooser && !!act && !auto;
  const left = opening.deadline - clock;
  const [dismissed, setDismissed] = useState(false);
  // A bot's roll decides at once: the dice stay up for a moment and the table is already live.
  const finished = auto && (dismissed || clock >= diceEnd + 2500);

  // The choice clock ends at the deadline: the server applies the default, a check just asks soon after.
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current || !act || auto) return undefined;
    const timer = window.setTimeout(() => { sent.current = true; void act({ type: "side.timeout", actorSeat: mySeat >= 0 ? mySeat : 0 }); }, Math.max(0, opening.deadline - now()) + 1500);
    return () => window.clearTimeout(timer);
  }, [opening.deadline, now, act, mySeat, auto]);

  const choose = async (seat: number) => {
    setBusy(true); setError(null);
    try { await act?.({ type: "match.first", actorSeat: mySeat, seatGoesFirst: seat }); } catch (cause) { setError(cause instanceof Error ? cause.message : "Something went wrong. Try again."); } finally { setBusy(false); }
  };

  // The stored rounds as the duel room's dice view, so its tiles, captions and status lines draw them. The last round
  // carries the "order": the chooser first, then the others by their latest roll.
  const latest = (seat: number) => { for (let r = rounds.length - 1; r >= 0; r--) { const roll = rounds[r]?.[seat]; if (roll != null) return roll; } return 0; };
  const order = [chooser, ...Array.from({ length: seatCount }, (_, seat) => seat).filter(seat => seat !== chooser).sort((a, b) => latest(b) - latest(a) || a - b)];
  const view: DuelDiceOpeningView = {
    phase: "dice", round: round + 1, serverNow: 0, deadlineAt: "",
    rounds: rounds.slice(0, round + 1).map((rolls, index) => ({ round: index + 1, rolls })),
    order: isLast ? order : null, finalSeats: null,
  };
  const beat = diceBeat(view, inRound, timeline);
  const settled = beat === "order";
  // Only the tied TOP seats roll again here. The duel room's model marks every group of equal rolls as tied, so a
  // 6-6-3-3 roll would show the low pair as a tie that never rolls: those seats keep their roll.
  const topRolls = rounds[round] ?? [];
  const topMax = Math.max(0, ...topRolls.filter((roll): roll is number => roll != null));
  const tiedTop = beat === "tie" ? topRolls.flatMap((roll, seat) => (roll === topMax ? [seat] : [])) : [];
  const chosen = opening.chosenSeat ?? opening.winnerSeat;
  const rollStatus = diceStatus(view, me, name, beat, false);
  const status = !settled ? (beat === "tie" && rollStatus.kind === "tie" ? { ...rollStatus, note: `${nameList(tiedTop, me, name)} tied on ${dieValue(view, tiedTop[0] ?? 0)}` } : rollStatus)
    : auto ? { main: chosen === me ? "You go first" : `${name(chosen)} goes first`, note: "", kind: "win" as const }
    : { main: iChoose ? "You win. Go first or second?" : `${name(chooser)} wins. ${name(chooser)} is choosing…`, note: "", kind: "win" as const };
  const liveText = settled ? `Round ${view.round}: ${rollSummary(view, me, name)}. ${status.main}` : "";
  const sampleElapsed = () => now() - opening.startedAt - round * REMOTE_OPENING_ROUND_MS;
  const sub = [seatCount === 2 ? `${name(0)} vs ${name(1)}` : `${seatCount}-way`, me == null ? "You are watching" : null,
    round > 0 ? `Round ${round + 1}${seatCount > 2 ? " · tied players only" : ""}` : null].filter(Boolean).join(" · ");
  const deadlineIso = new Date(opening.deadline).toISOString();

  if (finished) return null;
  return (
    <div className={cx(rootStyles.root, duelFontClasses)} role="dialog" aria-modal="true" aria-labelledby="opening-roll-title" data-testid="remote-opening-roll" data-stage={rolling ? "rolling" : "choose"} data-kind="dice" data-reduced={reduced ? "true" : "false"}>
      {rolling ? <SheetButton kind="quiet" size="sm" className={s.skip} onClick={() => { setSkipped(true); if (auto) setDismissed(true); }} data-testid="opening-roll-skip">Skip</SheetButton> : null}
      <div className={styles.stage}>
        <header className={styles.head}>
          <h2 id="opening-roll-title" className={styles.title}>Who goes first?</h2>
          <p className={styles.sub}>{sub}</p>
        </header>
        <p className={rootStyles.sr} role="status" aria-live="polite" data-testid="opening-roll-live">{liveText}</p>
        <div className={styles.status} data-kind={status.kind} data-testid="opening-roll-status">
          <span key={status.main} className={styles.main}>{status.main}</span>
          <span key={status.note} className={styles.note}>{status.note}</span>
        </div>
        <div className={cx(styles.row, seatCount === 2 && s.row2)} data-n={seatCount} data-testid="opening-roll-row">
          {Array.from({ length: seatCount }, (_, seat) => {
            const raw = tileOf(view, seat, inRound, timeline);
            const base = raw.state === "tied" && !tiedTop.includes(seat)
              ? { ...raw, state: "kept" as const, caption: { main: `Keeps ${raw.value}`, note: null }, chip: null } : raw;
            // The rank chip of the room becomes "Chooses" on the roll winner and is left off the other seats.
            const chip = base.chip?.kind === "rank" ? (base.rank === 0 ? { ...base.chip, text: auto ? "First" : "Chooses" } : null) : base.chip;
            const isMe = seat === me;
            const label = [`${name(seat)}${isMe ? " (you)" : ""}`, base.caption.main.toLowerCase(), chip?.text.toLowerCase()].filter(Boolean).join(", ");
            return (
              <div key={seat} className={cx(styles.tile, styles[`s${seat}` as "s0"])} role="group" aria-label={label}
                data-testid={`opening-roll-tile-${seat}`} data-state={base.state} data-me={isMe ? "true" : "false"} data-first={chip?.first ? "true" : undefined}>
                <div className={styles.rankrow}>
                  <span className={styles.chip} data-on={chip ? "true" : "false"} data-kind={chip?.kind} data-first={chip?.first ? "true" : undefined}>{chip?.text}</span>
                </div>
                <div className={styles.dieBox}>
                  <DiceDie value={base.value} skin={skin} throwRound={base.rolling ? view.round : null} plan={dicePlan(view.round, seat, timeline)} timeline={timeline}
                    landing={base.rolling && currentRound(view) ? landingOf(currentRound(view)!, seat) : null} tied={base.state === "tied"} reduced={reduced} sampleElapsed={sampleElapsed} />
                </div>
                <div className={styles.who}><span className={styles.av} aria-hidden /><span className={styles.nm}>{name(seat)}</span></div>
                <div className={styles.cap} aria-hidden>
                  <b key={base.caption.main}>{base.caption.main}</b>
                  {base.caption.note ? <i>{base.caption.note}</i> : null}
                </div>
                {isMe ? <span className={styles.you}>You</span> : null}
              </div>
            );
          })}
        </div>
        {!rolling && !auto ? (iChoose ? (
          <>
            <div className={cx(rootStyles.orders, seatCount > 2 && s.many)} role="group" aria-label="Turn order" data-testid="opening-roll-choice">
              <button type="button" className={cx(rootStyles.order, s.first)} disabled={busy || left <= 0} onClick={() => void choose(mySeat)} data-testid="opening-roll-first">
                <b>Go first</b><span>You take the first turn</span>
              </button>
              {seatCount === 2 ? (
                <button type="button" className={rootStyles.order} disabled={busy || left <= 0} onClick={() => void choose(1 - mySeat)} data-testid="opening-roll-second">
                  <b>Go second</b><span>The opponent takes the first turn</span>
                </button>
              ) : Array.from({ length: seatCount }, (_, seat) => seat).filter(seat => seat !== mySeat && !out[seat]).map(seat => (
                <button key={seat} type="button" className={rootStyles.order} disabled={busy || left <= 0} onClick={() => void choose(seat)} data-testid={`opening-roll-first-${seat}`}>
                  <b>{name(seat)} goes first</b><span>{name(seat)} takes the first turn</span>
                </button>
              ))}
            </div>
            <Countdown iso={deadlineIso} label="You go first in" now={clock} />
          </>
        ) : <div data-testid="opening-roll-waiting"><Countdown iso={deadlineIso} label="Time left" now={clock} /></div>) : null}
        {error ? <p className={rootStyles.error} role="alert">{error}</p> : null}
      </div>
    </div>
  );
}
