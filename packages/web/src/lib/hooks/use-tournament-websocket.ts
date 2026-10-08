"use client";

import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:3001");

interface UseTournamentWebsocketOptions {
  onParticipantJoined?: (data: { playerId: number; displayName: string }) => void;
  onParticipantLeft?: (data: { playerId: number }) => void;
  onStarted?: () => void;
  onCancelled?: () => void;
  onCompleted?: () => void;
  onMatchUpdated?: () => void;
  /**
   * One refetch hook for pages that just want fresh data. Fires after any
   * tournament event (join, leave, started, cancelled, completed, match
   * updated) and after a reconnect or retried join, once the room is joined.
   * The specific callbacks above still fire first. Pass this instead of them, not as well,
   * or a page that refetches in both will fetch twice.
   */
  onInvalidate?: () => void;
}

export function useTournamentWebsocket(slug: string, options: UseTournamentWebsocketOptions = {}) {
  const socketRef = useRef<Socket | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!slug) return;

    const socket = io(WS_URL, { autoConnect: true });
    socketRef.current = socket;
    let hasAttemptedJoin = false;
    let disposed = false;
    let requestId = 0;
    let tokenRequest: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;

    function clearJoinRetry() {
      if (retryTimer === null) return;
      clearTimeout(retryTimer);
      retryTimer = null;
    }

    function scheduleJoinRetry(currentRequest: number) {
      if (disposed || !socket.connected || currentRequest !== requestId) return;
      clearJoinRetry();
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void joinTournamentRoom();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15000);
    }

    async function joinTournamentRoom() {
      clearJoinRetry();
      // An earlier failed or interrupted attempt may have missed room events.
      const shouldRefetch = hasAttemptedJoin;
      hasAttemptedJoin = true;
      const currentRequest = ++requestId;
      tokenRequest?.abort();
      tokenRequest = new AbortController();
      try {
        const response = await fetch(`/api/tournaments/${encodeURIComponent(slug)}/connection`, {
          cache: "no-store", signal: tokenRequest.signal,
        });
        if (!response.ok) {
          if (response.status !== 401 && response.status !== 403 && response.status !== 404) scheduleJoinRetry(currentRequest);
          return;
        }
        const data = await response.json() as { token: string; userId: number };
        if (disposed || !socket.connected || currentRequest !== requestId) return;
        socket.emit("tournament:join", { slug, token: data.token, userId: data.userId }, (result?: { error?: string }) => {
          if (disposed || !socket.connected || currentRequest !== requestId) return;
          if (result?.error !== undefined) {
            scheduleJoinRetry(currentRequest);
            return;
          }
          clearJoinRetry();
          retryDelay = 1000;
          if (shouldRefetch) {
            optionsRef.current.onMatchUpdated?.();
            optionsRef.current.onInvalidate?.();
          }
        });
      } catch (error) {
        if (!disposed && socket.connected && currentRequest === requestId && !(error instanceof Error && error.name === "AbortError")) {
          console.warn("Tournament live feed is unavailable. Retrying.");
          scheduleJoinRetry(currentRequest);
        }
      }
    }

    socket.on("connect", () => {
      void joinTournamentRoom();
    });

    socket.on("disconnect", () => {
      ++requestId;
      clearJoinRetry();
      retryDelay = 1000;
      tokenRequest?.abort();
    });

    socket.on("tournament:subscription-expired", (payload: { slug: string }) => {
      if (payload.slug !== slug) return;
      optionsRef.current.onMatchUpdated?.();
      optionsRef.current.onInvalidate?.();
      void joinTournamentRoom();
    });

    socket.on("tournament:participant-joined", (payload: { playerId: number; displayName: string }) => {
      optionsRef.current.onParticipantJoined?.(payload);
      optionsRef.current.onInvalidate?.();
    });

    socket.on("tournament:participant-left", (payload: { playerId: number }) => {
      optionsRef.current.onParticipantLeft?.(payload);
      optionsRef.current.onInvalidate?.();
    });

    socket.on("tournament:started", () => {
      optionsRef.current.onStarted?.();
      optionsRef.current.onInvalidate?.();
    });

    socket.on("tournament:cancelled", () => {
      optionsRef.current.onCancelled?.();
      optionsRef.current.onInvalidate?.();
    });

    socket.on("tournament:completed", () => {
      optionsRef.current.onCompleted?.();
      optionsRef.current.onInvalidate?.();
    });

    socket.on("tournament:match-updated", () => {
      optionsRef.current.onMatchUpdated?.();
      optionsRef.current.onInvalidate?.();
    });

    socket.on("connect_error", (err) => {
      // eslint-disable-next-line no-console
      console.warn("Tournament WS connect error:", err.message);
    });

    return () => {
      disposed = true;
      ++requestId;
      clearJoinRetry();
      tokenRequest?.abort();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [slug]);

  return socketRef;
}
