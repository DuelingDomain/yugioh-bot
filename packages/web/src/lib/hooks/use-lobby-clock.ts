"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { LOBBY_COUNTDOWN_POLL_MS, LOBBY_IDLE_POLL_MS, type LobbySnapshot } from "@yugidraft/shared/types";
import { clockOffset } from "@/components/draft/lobby/lobby-model";

/** A short wait past the server deadline, so the read happens after the server has acted. */
const DEADLINE_GRACE_MS = 250;

export interface LobbyClockOptions {
  /** The draft is pending. The clock is silent for an active, finished or missing draft. */
  pending: boolean;
  /** The lobby of the latest read. Absent for a server without lobbies. */
  lobby?: LobbySnapshot | null;
  /** Read the draft again. The page coalesces overlapping reads, so this is safe to call often. */
  onRefresh: () => void;
}

export interface LobbyClock {
  /** Server clock minus this browser's clock, taken when the lobby arrived. Add it to `Date.now()`. */
  offsetMs: number;
  /** The server time now, on this browser's clock. */
  serverNow: () => number;
  /** A start is scheduled: the read runs every second until it clears. */
  counting: boolean;
}

/**
 * The recovery clock of a pending lobby. The server owns every deadline (see `lobby.start`), so this clock never starts
 * a draft. It only reads the draft again so a browser that missed a socket message still lands on the truth:
 *
 * - every `LOBBY_IDLE_POLL_MS` while nothing is scheduled;
 * - every `LOBBY_COUNTDOWN_POLL_MS` while a start is scheduled, and once right after its deadline passes;
 * - never while the tab is hidden (the socket hook reads again when the tab comes back).
 *
 * The offset comes from `serverNow` of the lobby, so the deadline is measured on the server clock whatever the
 * browser clock says. The countdown drawing itself lives in `useStartCountdown`.
 */
export function useLobbyClock({ pending, lobby, onRefresh }: LobbyClockOptions): LobbyClock {
  const refresh = useRef(onRefresh);
  useEffect(() => { refresh.current = onRefresh; }, [onRefresh]);

  // Taken when the snapshot first renders: close to the time it arrived, and stable until the next snapshot.
  const serverNowText = lobby?.serverNow ?? null;
  const offsetMs = useMemo(
    () => (serverNowText ? clockOffset(serverNowText, Date.now()) : 0),
    // The offset is for this one snapshot; a new revision with the same server time is the same clock reading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverNowText, lobby?.revision],
  );
  const offsetRef = useRef(offsetMs);
  useEffect(() => { offsetRef.current = offsetMs; }, [offsetMs]);

  const startsAt = lobby?.start?.startsAt ?? null;
  const token = lobby?.start?.token ?? null;
  const counting = pending && token !== null;

  useEffect(() => {
    if (!pending) return;
    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    const tick = () => {
      if (visible()) refresh.current();
    };

    const interval = setInterval(tick, counting ? LOBBY_COUNTDOWN_POLL_MS : LOBBY_IDLE_POLL_MS);

    let deadline: ReturnType<typeof setTimeout> | null = null;
    if (counting && startsAt) {
      const at = Date.parse(startsAt);
      if (!Number.isNaN(at)) {
        const wait = Math.max(0, at - (Date.now() + offsetRef.current)) + DEADLINE_GRACE_MS;
        deadline = setTimeout(tick, wait);
      }
    }
    return () => {
      clearInterval(interval);
      if (deadline !== null) clearTimeout(deadline);
    };
  }, [pending, counting, startsAt, token]);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);
  return { offsetMs, serverNow, counting };
}
