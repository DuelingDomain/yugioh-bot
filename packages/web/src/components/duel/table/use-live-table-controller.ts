"use client";

import { useMemo } from "react";
import type { DuelRoom } from "@yugidraft/shared/duels";
import { opponentPickOptions } from "../multi-seat";
import type { TableController } from "./types";

export type LiveTableControllerInput = Omit<TableController, "room" | "engine" | "viewerSeat" | "promptSeat" | "seatPick"> & {
  room: DuelRoom | null | undefined;
  error?: unknown;
  catchingUp?: boolean;
};

/** Adapt the room's existing state and handlers; the room remains the only owner of its prompt draft. */
export function useLiveTableController(input: LiveTableControllerInput): TableController | null {
  return useMemo(() => {
    const { room, error, catchingUp, ...state } = input;
    const engine = room?.engine;
    if (!room || !engine) return null;
    const busy = state.busy || Boolean(error) || Boolean(catchingUp);
    const canAct = state.canAct && !busy;
    const picks = canAct && state.revealed ? opponentPickOptions(state.prompt, engine) : null;
    return {
      ...state, room, engine, viewerSeat: room.mySeat,
      promptSeat: state.prompt?.seat ?? null, busy, canAct,
      seatPick: picks && picks.size > 0 ? {
        options: picks,
        onPick: (seat) => {
          const choice = picks.get(seat);
          if (choice != null) state.onAnswer({ choice });
        },
      } : null,
    };
  }, [input]);
}
