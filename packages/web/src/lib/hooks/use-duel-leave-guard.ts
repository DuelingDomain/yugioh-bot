"use client";

import { useLayoutEffect } from "react";
import { installTraversalTracking, useNavigationLeaveGuard } from "./navigation-leave-guard";

export { useNavigationLeaveGuard };
export type { LeaveIntercept } from "./navigation-leave-guard";

const PLAYER_LEAVE_MESSAGE =
  "Leave this active duel? You are playing. The duel and any running timer will continue. You can return to the current state.";

const SPECTATOR_LEAVE_MESSAGE =
  "Leave this active duel? You are watching. The duel and any running timer will continue. You can return to the current state.";

/** Install before App Router's popstate listener, including on non-duel pages. */
export function DuelNavigationGuard() {
  useLayoutEffect(() => installTraversalTracking(), []);
  return null;
}

/**
 * Warn before leaving an active duel. Stay keeps this room's URL, Next tree,
 * and history entry; Leave proceeds once and does not surrender the seat.
 *
 * Cancel same-document Navigation API transitions before the URL changes.
 * Older browsers restore a cancelled traversal using stamped history indices;
 * capture-phase popstate stops Next from rendering the rejected destination.
 * No sentinel entries or history changes on unmount.
 *
 * Link clicks get role-specific confirmation. The matching navigate event
 * consumes that approval so slow App Router transitions do not ask twice.
 * Close, reload, and cross-document traversal use the native browser warning.
 */
export function useDuelLeaveGuard({
  slug,
  active,
  role,
}: {
  slug: string;
  active: boolean;
  role: "player" | "spectator";
}): void {
  useNavigationLeaveGuard(
    active && !!slug,
    role === "player" ? PLAYER_LEAVE_MESSAGE : SPECTATOR_LEAVE_MESSAGE,
    slug,
  );
}
