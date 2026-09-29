"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import type {
  DuelChangedPayload, DuelConnectionResponse, DuelJoinAck, DuelPresencePayload,
  DuelSubscriptionExpiredPayload,
} from "@yugidraft/shared/ws";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ||
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:3001");
const POLL_LIVE_MS = 10_000;
const POLL_STALE_MS = 1000;

type Presence = Omit<DuelPresencePayload, "slug">;

export type DuelWebsocketState = {
  slug: string;
  connected: boolean;
  presence: Presence | null;
  /** In-flight GET from invalidation, join, resync, or recovery — not silent live polls. */
  syncing: boolean;
  /** True until a GET succeeds; also set when the latest GET fails. */
  recovering: boolean;
  /** Recovery GET. Rejects if that GET fails. */
  resync: () => Promise<void>;
};

type Snapshot = Omit<DuelWebsocketState, "resync">;

function idle(slug: string, flags: Pick<Snapshot, "syncing" | "recovering">): Snapshot {
  return { slug, connected: false, presence: null, syncing: flags.syncing, recovering: flags.recovering };
}

/**
 * Socket carries invalidations only; `onChange` (authenticated GET) owns the board.
 * Coalesces overlapping GETs: invalidations trail; polls never trail on an in-flight GET.
 * Owns visible+online polling through that coalescer: 1s when not Live, 10s when Live.
 *
 * Parent SWR: initial load and action mutate only. No `refreshInterval`.
 * `revalidateOnFocus: false`, `revalidateOnReconnect: false`.
 * Gate prompts with `syncing || recovering`. Hide/remount DuelFeedback only while `recovering`.
 * Routine polls do not raise either flag; only explicit refreshes and failures do.
 */
export function useDuelWebsocket(
  slug: string,
  seat: number | null | undefined,
  onChange: () => Promise<unknown>,
): DuelWebsocketState {
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const roomKey = `${slug}:${String(seat)}`;
  const roomKeyRef = useRef(roomKey);
  roomKeyRef.current = roomKey;
  const [connection, setConnection] = useState<Snapshot>(idle("", { syncing: false, recovering: false }));
  const resyncImpl = useRef<() => Promise<void>>(async () => {});
  const resync = useCallback(() => resyncImpl.current(), []);

  useEffect(() => {
    if (!slug || seat === undefined) {
      resyncImpl.current = async () => {};
      return;
    }

    const myKey = `${slug}:${String(seat)}`;
    let disposed = false;
    let joining = false;
    let subscribed = false;
    let live = false;
    let guildId: string | undefined;
    let request: AbortController | undefined;
    let renewal: number | undefined;
    let pollTimer: number | undefined;
    let trailing = false;
    let inFlight: Promise<void> | null = null;
    let resolveFlight: (() => void) | null = null;
    let rejectFlight: ((reason: unknown) => void) | null = null;

    const socket = io(WS_URL, {
      autoConnect: false,
      reconnectionDelay: 250,
      reconnectionDelayMax: 3000,
      timeout: 5000,
    });

    const isCurrent = () => !disposed && roomKeyRef.current === myKey;

    const patch = (update: Partial<Snapshot> | ((current: Snapshot) => Snapshot)) => {
      if (!isCurrent()) return;
      setConnection((current) => {
        const base = current.slug === slug ? current : idle(slug, { syncing: true, recovering: true });
        const next = typeof update === "function" ? update(base) : { ...base, ...update, slug };
        if (
          next.slug === current.slug &&
          next.connected === current.connected &&
          next.syncing === current.syncing &&
          next.recovering === current.recovering &&
          next.presence === current.presence
        ) return current;
        return next;
      });
    };

    const settleFlight = (error?: unknown) => {
      const resolve = resolveFlight;
      const reject = rejectFlight;
      resolveFlight = null;
      rejectFlight = null;
      inFlight = null;
      if (!resolve || !reject) return;
      if (error !== undefined) reject(error);
      else resolve();
    };

    const armPoll = () => {
      clearTimeout(pollTimer);
      if (!isCurrent()) return;
      pollTimer = window.setTimeout(() => {
        if (!isCurrent()) return;
        if (document.visibilityState === "visible" && navigator.onLine && !inFlight) {
          void refresh({ recovery: !live, poll: true }).catch(() => {});
        }
        armPoll();
      }, live ? POLL_LIVE_MS : POLL_STALE_MS);
    };

    const updateLive = (next: boolean) => {
      if (live === next) return;
      live = next;
      armPoll();
    };

    const pump = async () => {
      let lastError: unknown;
      let succeeded = false;
      try {
        while (trailing && isCurrent()) {
          trailing = false;
          try {
            await changeRef.current();
            if (!isCurrent()) break;
            lastError = undefined;
            succeeded = true;
          } catch (error) {
            lastError = error;
            succeeded = false;
            if (!trailing) break;
          }
        }
      } finally {
        if (!isCurrent()) {
          settleFlight();
          return;
        }
        const nextLive = succeeded && subscribed && socket.connected;
        updateLive(nextLive);
        patch({
          syncing: false,
          recovering: !succeeded,
          connected: nextLive,
        });
        if (succeeded) settleFlight();
        else settleFlight(lastError ?? new Error("Room snapshot unavailable"));
      }
    };

    const refresh = (opts: { recovery?: boolean; poll?: boolean } = {}) => {
      if (!isCurrent()) return Promise.resolve();
      if (opts.poll && inFlight) return inFlight;
      trailing = true;
      // Routine polls leave the flags alone: raising them every second in Polling mode
      // closed card menus, blocked answers and remounted DuelFeedback on each tick.
      // A failed poll still ends with `recovering: true` (see pump).
      if (!opts.poll) {
        patch((current) => ({
          ...current,
          slug,
          syncing: true,
          recovering: Boolean(opts.recovery) || current.recovering,
        }));
      }
      if (!inFlight) {
        inFlight = new Promise<void>((resolve, reject) => {
          resolveFlight = resolve;
          rejectFlight = reject;
        });
        void inFlight.catch(() => {});
        void pump();
      }
      return inFlight;
    };

    const recoverBoard = (dropLive: boolean) => {
      if (!isCurrent()) return;
      if (dropLive) {
        updateLive(false);
        patch({ connected: false, recovering: true, syncing: true });
      }
      void refresh({ recovery: true }).catch(() => {});
    };

    const disconnected = () => {
      clearTimeout(renewal);
      request?.abort();
      subscribed = false;
      updateLive(false);
      patch({
        connected: false,
        presence: null,
        recovering: true,
        syncing: Boolean(inFlight),
      });
    };

    const join = async () => {
      if (!isCurrent() || joining || !socket.connected) return;
      joining = true;
      clearTimeout(renewal);
      const socketId = socket.id;
      const recoverSnapshot = !subscribed;
      request = new AbortController();
      let credentials: DuelConnectionResponse | undefined;
      try {
        const response = await fetch(`/api/duels/${encodeURIComponent(slug)}/connection`, {
          cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]),
        });
        if (!response.ok) throw new Error("Room subscription unavailable");
        credentials = await response.json() as DuelConnectionResponse;
        if (!isCurrent() || socket.id !== socketId || !socket.connected) return;
        guildId = credentials.guildId;
        const token = credentials.token;
        const result = await new Promise<DuelJoinAck>((resolve, reject) => {
          socket.timeout(5000).emit("duel:join", { token }, (error: Error | null, answer: DuelJoinAck) => {
            if (error) reject(error);
            else resolve(answer);
          });
        });
        if (!result?.ok) throw new Error("Room subscription rejected");
        if (!isCurrent() || socket.id !== socketId || !socket.connected) return;
        subscribed = true;
        patch((current) => ({
          ...current,
          slug,
          presence: { onlineSeats: result.onlineSeats, spectatorCount: result.spectatorCount },
          syncing: true,
          connected: recoverSnapshot ? false : current.connected,
          recovering: recoverSnapshot ? true : current.recovering,
        }));
      } catch {
        if (!isCurrent()) return;
        subscribed = false;
        updateLive(false);
        patch(idle(slug, { syncing: false, recovering: true }));
        if (socket.connected) renewal = window.setTimeout(() => void join(), 3000);
        return;
      } finally {
        joining = false;
        if (isCurrent() && socket.connected && socket.id !== socketId) void join();
      }
      if (!credentials || !isCurrent() || socket.id !== socketId || !socket.connected) return;
      try {
        await refresh({ recovery: recoverSnapshot });
        if (!isCurrent() || socket.id !== socketId || !socket.connected) return;
        patch({ connected: true });
      } catch {
        // Latest GET already left not-Live + recovering; poll retries.
      }
      if (isCurrent() && socket.connected && socket.id === socketId) {
        renewal = window.setTimeout(() => void join(), Math.max(1000, credentials.expiresAt - Date.now() - 30_000));
      }
    };

    const onFocus = () => { void refresh({ recovery: true }).catch(() => {}); };
    const onVisibility = () => {
      if (document.visibilityState === "visible") recoverBoard(true);
    };
    const onOnline = () => recoverBoard(true);
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) recoverBoard(true);
    };

    socket.on("connect", () => void join());
    socket.on("disconnect", disconnected);
    socket.on("connect_error", disconnected);
    socket.on("duel:changed", (event: DuelChangedPayload) => {
      if (event.slug === slug) void refresh().catch(() => {});
    });
    socket.on("duel:presence", (event: DuelPresencePayload) => {
      if (event.slug !== slug || !isCurrent()) return;
      patch({
        presence: { onlineSeats: event.onlineSeats, spectatorCount: event.spectatorCount },
      });
    });
    socket.on("duel:subscription-expired", (event: DuelSubscriptionExpiredPayload) => {
      if (event.slug !== slug || !isCurrent()) return;
      subscribed = false;
      updateLive(false);
      patch({ connected: false, presence: null, recovering: true });
      void join();
    });
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);
    resyncImpl.current = () => refresh({ recovery: true });
    armPoll();
    socket.connect();

    return () => {
      disposed = true;
      resyncImpl.current = async () => {};
      clearTimeout(pollTimer);
      clearTimeout(renewal);
      settleFlight();
      request?.abort();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
      if (guildId && socket.connected) socket.emit("duel:leave", { slug, guildId });
      socket.disconnect();
    };
  }, [slug, seat]);

  if (connection.slug === slug) return { ...connection, resync };
  return { ...idle(slug, { syncing: Boolean(slug), recovering: Boolean(slug) }), resync };
}
