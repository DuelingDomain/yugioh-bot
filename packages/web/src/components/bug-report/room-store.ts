import { useEffect } from "react";
import type { DuelRoom } from "@yugidraft/shared/duels";

/**
 * The duel room on screen, for the floating Report bug button. The button lives in the root layout, above every page,
 * so a room cannot pass its state down; it hands it over here instead. Only the room that is mounted holds the slot.
 */
let current: DuelRoom | null = null;

export function getBugReportRoom(): DuelRoom | null {
  return current;
}

/** Call from a mounted duel room with its latest room. The slot is cleared when that room goes away. */
export function useBugReportRoom(room: DuelRoom | null): void {
  useEffect(() => {
    current = room;
    return () => {
      if (current === room) current = null;
    };
  }, [room]);
}
