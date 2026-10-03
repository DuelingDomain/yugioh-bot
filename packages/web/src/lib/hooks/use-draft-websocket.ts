"use client";

import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { useDraftStore } from "@/lib/stores/draft-store";

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:3001");

interface UseDraftWebsocketOptions {
  onStatusChange?: (status: "active" | "cancelled" | "completed") => void;
  onResync?: () => void;
  onSeatsChange?: () => void;
}

export function useDraftWebsocket(slug: string, options: UseDraftWebsocketOptions = {}) {
  const socketRef = useRef<Socket | null>(null);
  const setFromServer = useDraftStore((s) => s.setFromServer);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!slug) return;

    const socket = io(WS_URL, { autoConnect: true });
    socketRef.current = socket;
    let disposed = false;
    let requestId = 0;
    let tokenRequest: AbortController | null = null;

    async function joinDraftRoom() {
      const currentRequest = ++requestId;
      tokenRequest?.abort();
      tokenRequest = new AbortController();
      try {
        const response = await fetch(`/api/drafts/${encodeURIComponent(slug)}/connection`, {
          cache: "no-store", signal: tokenRequest.signal,
        });
        if (!response.ok) return;
        const data = await response.json();
        if (disposed || !socket.connected || currentRequest !== requestId) return;
        socket.emit("draft:join", { slug, token: data.token, userId: data.userId }, (result?: { error?: string }) => {
          if (result?.error !== undefined || disposed || !socket.connected || currentRequest !== requestId) return;
          optionsRef.current.onResync?.();
        });
      } catch (error) {
        if (!disposed && currentRequest === requestId && !(error instanceof Error && error.name === "AbortError")) {
          console.warn("Draft live feed is unavailable. Reconnect to try again.");
        }
      }
    }

    socket.on("connect", () => {
      void joinDraftRoom();
    });

    socket.on("disconnect", () => {
      ++requestId;
      tokenRequest?.abort();
    });

    socket.on("draft:subscription-expired", (payload: { slug: string }) => {
      if (payload.slug !== slug) return;
      optionsRef.current.onResync?.();
      void joinDraftRoom();
    });

    socket.on("draft:status", (payload: { status: "active" | "cancelled" | "completed" }) => {
      if (payload.status === "completed") {
        setFromServer({ completed: true, isMyTurn: false });
      }
      optionsRef.current.onStatusChange?.(payload.status);
    });

    socket.on(
      "draft:pick",
      (payload: { playerId: number; packRound: number; pickStep: number }) => {
        const state = useDraftStore.getState();
        if (state.packRound !== payload.packRound || state.pickStep !== payload.pickStep) return;
        setFromServer({
          seats: state.seats.map((s) =>
            s.playerId === payload.playerId ? { ...s, hasPicked: true } : s,
          ),
        });
      },
    );

    socket.on("draft:resync", (_payload: { packRound: number; pickStep: number }) => {
      optionsRef.current.onResync?.();
    });

    socket.on("draft:complete", () => {
      setFromServer({ completed: true, isMyTurn: false });
      optionsRef.current.onStatusChange?.("completed");
    });

    socket.on("draft:seats", () => {
      optionsRef.current.onSeatsChange?.();
    });

    socket.on("connect_error", (err) => {
      // eslint-disable-next-line no-console
      console.warn("Draft WS connect error:", err.message);
    });

    return () => {
      disposed = true;
      ++requestId;
      tokenRequest?.abort();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [slug, setFromServer]);

  return socketRef;
}
