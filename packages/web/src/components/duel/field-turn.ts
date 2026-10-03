"use client";

import { duelFxClock } from "./fx-clock";
import { useEffect, useRef, useState } from "react";
import type { DuelEngineView } from "@yugidraft/shared/duels";
import { getPhaseBeat } from "./phase-beats";

/** Keep the previous turn owner until the new turn's first planned phase ribbon begins. */
export function useFieldTurnSeat(engine: DuelEngineView, turnSeat: number | null): number | null {
  const [shown, setShown] = useState(turnSeat);
  const presented = useRef({ turn: engine.turn, eventId: engine.events.at(-1)?.id ?? 0 });

  useEffect(() => {
    const eventId = engine.events.at(-1)?.id ?? 0;
    const show = () => {
      presented.current = { turn: engine.turn, eventId };
      setShown(turnSeat);
    };
    // The room plans its phase beats in a layout effect; read them here after that plan exists.
    const firstBeat = turnSeat != null && engine.turn !== presented.current.turn
      ? engine.events.filter((event) => event.id > presented.current.eventId)
        .map((event) => getPhaseBeat(event.id)).find((beat) => beat != null)
      : null;
    const wait = (firstBeat?.startAt ?? 0) - duelFxClock.now();
    if (wait <= 0) {
      show();
      return;
    }
    const timer = duelFxClock.setTimeout(show, wait);
    return () => duelFxClock.clearTimeout(timer);
  }, [engine.turn, engine.events, turnSeat]);

  // Finished games and invalid/pre-turn snapshots clear gold synchronously.
  return turnSeat == null ? null : shown;
}
