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
   * updated) and after a reconnect, once the room is rejoined. The specific
   * callbacks above still fire first. Pass this instead of them, not as well,
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
    let hasConnected = false;

    socket.on("connect", () => {
      socket.emit("tournament:join", { slug });
      // Reuse the page's existing refetch callback without firing on first connect.
      const isReconnect = hasConnected;
      hasConnected = true;
      if (isReconnect) {
        optionsRef.current.onMatchUpdated?.();
        optionsRef.current.onInvalidate?.();
      }
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
      socket.disconnect();
      socketRef.current = null;
    };
  }, [slug]);

  return socketRef;
}
