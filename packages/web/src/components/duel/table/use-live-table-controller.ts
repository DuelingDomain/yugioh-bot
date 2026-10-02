"use client";

import { useMemo } from "react";
import type { DuelRoom } from "@yugidraft/shared/duels";
import { seatPickFor } from "../multi-seat";
import type { TableController } from "./types";

export type LiveTableControllerInput = Omit<TableController, "room" | "engine" | "viewerSeat" | "promptSeat" | "seatPick"> & {
  room: DuelRoom | null | undefined;
  error?: unknown;
  catchingUp?: boolean;
};

/** Adapt the room's existing state and handlers; the room remains the only owner of its prompt draft. */
export function useLiveTableController(input: LiveTableControllerInput): TableController | null {
  const { room, error, catchingUp, nameOf, prompt, canAct: allowed, busy: working, revealed, draft,
    legalKeys, selectedKeys, aim, reducedMotion, onAnswer, onActivate, onInspect, onHoverCard, onAim } = input;
  return useMemo(() => {
    const engine = room?.engine;
    if (!room || !engine) return null;
    const busy = working || Boolean(error) || Boolean(catchingUp);
    const canAct = allowed && !busy;
    return {
      room, engine, viewerSeat: room.mySeat, nameOf, prompt, revealed, draft, legalKeys, selectedKeys,
      aim, reducedMotion, onAnswer, onActivate, onInspect, onHoverCard, onAim,
      promptSeat: prompt?.seat ?? null, busy, canAct,
      seatPick: canAct && revealed ? seatPickFor(prompt, engine, onAnswer) : null,
    };
  }, [room, error, catchingUp, nameOf, prompt, allowed, working, revealed, draft, legalKeys, selectedKeys,
    aim, reducedMotion, onAnswer, onActivate, onInspect, onHoverCard, onAim]);
}
