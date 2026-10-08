"use client";

import { useEffect, useMemo, useState } from "react";
import { DUEL_DICE_REVEAL_MS, type DuelDiceOpeningView } from "@yugidraft/shared/duels";
import { DiceOpeningScreen } from "../dice-opening";
import { DICE_SKINS, setDiceSkin, useDiceSkin } from "../dice-skins";
import type { LabDiceOpening } from "./board";
import styles from "./dice-view.module.css";

/** The lab's players by lobby seat. */
export const DICE_LAB_NAMES = ["Mira", "Dax", "Rin", "Kade"] as const;

/**
 * The view the server would send at one beat of a scripted opening. Step `i` shows rounds 0..i for 3 s; the last
 * step carries the order. After it the duel starts: the phase is `start` and the seats have moved.
 */
export function labDiceView(spec: LabDiceOpening, step: number, now: number): DuelDiceOpeningView {
  const last = spec.rounds.length - 1;
  const index = spec.startPhase ? last : Math.min(step, last);
  const finished = spec.startPhase === true || step > last;
  const order = index === last ? spec.order : null;
  return {
    phase: finished ? "start" : "dice",
    round: index + 1,
    serverNow: now,
    deadlineAt: new Date(now + DUEL_DICE_REVEAL_MS).toISOString(),
    rounds: spec.rounds.slice(0, index + 1).map((rolls, i) => ({ round: i + 1, rolls })),
    order,
    finalSeats: order ? order.map((_, lobby) => order.indexOf(lobby)) : null,
  };
}

/** Names and viewer the way the room reports them: by lobby seat while the dice play, by the new seat after. */
export function labDiceRoom(spec: LabDiceOpening, view: DuelDiceOpeningView): { names: string[]; mySeat: number | null } {
  const count = spec.rounds[0]!.length;
  const lobbyNames = DICE_LAB_NAMES.slice(0, count);
  if (view.phase === "dice" || !view.order || !view.finalSeats) return { names: [...lobbyNames], mySeat: spec.mySeat };
  return { names: view.order.map((lobby) => lobbyNames[lobby]!), mySeat: spec.mySeat == null ? null : view.finalSeats[spec.mySeat]! };
}

/** The real dice opening over the lab board. It plays the scripted rounds on the server's beat, then holds the start. */
export function DiceLabScreen({ spec, reduced }: { spec: LabDiceOpening; reduced: boolean }) {
  const skin = useDiceSkin();
  const [step, setStep] = useState(spec.startPhase ? spec.rounds.length : 0);
  const [received, setReceived] = useState(() => ({ now: Date.now(), at: performance.now() }));
  useEffect(() => {
    if (step > spec.rounds.length - 1) return undefined;
    const timer = window.setTimeout(() => {
      setReceived({ now: Date.now(), at: performance.now() });
      setStep(step + 1);
    }, DUEL_DICE_REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [step, spec]);
  const view = useMemo(() => labDiceView(spec, step, received.now), [spec, step, received.now]);
  const room = labDiceRoom(spec, view);
  return (
    <>
      <DiceOpeningScreen opening={view} receivedAt={received.at} mySeat={room.mySeat} names={room.names} reducedMotion={reduced} />
      <div className={styles.skins} role="group" aria-label="Dice">
        <span>Dice</span>
        {DICE_SKINS.map((option) => (
          <button key={option.id} type="button" aria-pressed={skin === option.id} disabled={option.state === "locked"} onClick={() => setDiceSkin(option.id)}>{option.label}</button>
        ))}
      </div>
    </>
  );
}
