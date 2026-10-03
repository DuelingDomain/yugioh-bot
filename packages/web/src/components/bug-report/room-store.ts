import { useEffect, useSyncExternalStore } from "react";
import type { DuelRoom } from "@yugidraft/shared/duels";

/**
 * The duel room on screen, for the Report bug entries. The floating button lives in the app shell, above every page,
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

/**
 * How many live duel headers show their own Report bug button. While one does, the floating button stays hidden: in a
 * duel every corner of the screen belongs to the table, so the button lives in the header there.
 */
let headerHosts = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Call from the header button: it tells the floating button to step aside while it is mounted. */
export function useBugReportHeaderHost(): void {
  useEffect(() => {
    headerHosts += 1;
    notify();
    return () => {
      headerHosts -= 1;
      notify();
    };
  }, []);
}

/** True while a duel header has the button. The server render and the first client render both say false. */
export function useBugReportHeaderHosted(): boolean {
  return useSyncExternalStore(subscribe, () => headerHosts > 0, () => false);
}
