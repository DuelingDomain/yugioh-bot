import { useSyncExternalStore } from "react";

/**
 * Why "Scan field" is worth pressing now, and how long the last scan took. Local only: the field watcher publishes it for my seat,
 * the Scan field button and the status chip read it. A null reason means the board and the camera agree.
 */
export interface ScanAdvice {
  seat: number | null;
  /** Short reason, e.g. "Camera sees 2 cards not on the board". Null when nothing is wrong. */
  reason: string | null;
  /** The last finished scan: who asked, ms until the two detector passes were done, ms until the board writes were done, and how many fixes it saved. */
  last?: { origin: "manual" | "auto" | "remote"; sweepMs: number; totalMs: number; changes: number };
}
const none: ScanAdvice = { seat: null, reason: null };
let current = none;
const listeners = new Set<() => void>();
export function publishScanAdvice(next: ScanAdvice) {
  if (current.seat === next.seat && current.reason === next.reason && current.last === next.last) return;
  current = next; for (const listener of listeners) listener();
}
export const clearScanAdvice = () => publishScanAdvice(none);
/** The advice for my seat; the empty advice for any other seat. */
export function useScanAdvice(seat: number): ScanAdvice {
  const value = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => current, () => none);
  return value.seat === seat ? value : none;
}

/** The sentence for a mismatch: cards the camera sees that the board lacks, and board cards the camera no longer sees. */
export function scanReason(input: { holding?: boolean; untracked: number; missing: number }): string | null {
  const plural = (n: number) => `${n} card${n === 1 ? "" : "s"}`;
  if (input.holding) return "Auto-detect is paused, so the board may be behind the camera";
  if (input.untracked > 0 && input.missing > 0) return `Camera and board differ (${plural(input.untracked)} not on the board, ${plural(input.missing)} not seen)`;
  if (input.untracked > 0) return `Camera sees ${plural(input.untracked)} not on the board`;
  if (input.missing > 0) return `Board shows ${plural(input.missing)} the camera does not see`;
  return null;
}
