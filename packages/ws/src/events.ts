import type { Server, Socket } from "socket.io";
import type { DraftRoomManager } from "./rooms.js";
import { verifyDraftRoomToken, type DraftRoomTokenClaims, type TalkLineId } from "@yugidraft/shared/ws";

export type DraftStatus = "active" | "cancelled" | "completed";

export interface DraftJoinPayload {
  slug: string;
  token: string;
  userId: string;
}

export type DuelJoinAck =
  | { ok: true; onlineSeats: number[]; spectatorCount: number }
  | { ok: false; error: string };

export interface DuelJoinPayload {
  token: string;
}

export interface ServerToClientEvents {
  "draft:status": (data: { status: DraftStatus }) => void;
  "draft:pick": (data: { playerId: number; packRound: number; pickStep: number }) => void;
  "draft:resync": (data: { packRound: number; pickStep: number }) => void;
  "draft:complete": (data: Record<string, never>) => void;
  "draft:seats": (data: Record<string, never>) => void;
  "draft:talk": (data: { playerId: number; line: TalkLineId }) => void;
  "draft:subscription-expired": (data: { slug: string }) => void;
  "tournament:participant-joined": (data: { playerId: number; displayName: string }) => void;
  "tournament:participant-left": (data: { playerId: number }) => void;
  "tournament:started": (data: Record<string, never>) => void;
  "tournament:cancelled": (data: Record<string, never>) => void;
  "tournament:completed": (data: Record<string, never>) => void;
  "tournament:match-updated": (data: Record<string, never>) => void;
  "duel:changed": (data: { slug: string }) => void;
  "duel:presence": (data: { slug: string; onlineSeats: number[]; spectatorCount: number }) => void;
  "duel:subscription-expired": (data: { slug: string }) => void;
}

export interface ClientToServerEvents {
  "draft:join": (
    payload: DraftJoinPayload,
    ack?: (result?: { error?: string }) => void,
  ) => void;
  "tournament:join": (
    payload: { slug: string },
    ack?: (result?: { error?: string }) => void,
  ) => void;
  "duel:join": (
    payload: DuelJoinPayload,
    ack?: (result: DuelJoinAck) => void,
  ) => void;
  "duel:leave": (payload: { slug: string; guildId: string }) => void;
}

export interface InterServerEvents {
  // reserved for future use
}

export interface SocketData {
  duel?: {
    slug: string;
    guildId: string;
    playerId: number;
    seat: number | null;
    expiresAt: number;
  };
}

export type TypedServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export type TypedSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export function registerEventHandlers(
  io: TypedServer,
  roomManager: DraftRoomManager,
  opts: { secret: string; canReadDraft: (claims: DraftRoomTokenClaims) => boolean },
) {
  const subscriptions = new Map<TypedSocket, Map<string, { claims: DraftRoomTokenClaims }>>();

  function hasAccess(claims: DraftRoomTokenClaims): boolean {
    try {
      return opts.canReadDraft(claims);
    } catch (error) {
      console.error("[ws] draft access check failed", error);
      return false;
    }
  }

  function leaveDraft(socket: TypedSocket, slug: string, expired: boolean) {
    subscriptions.get(socket)?.delete(slug);
    const room = roomManager.getRoom(slug);
    if (room) roomManager.leaveRoom(room, socket);
    if (expired) socket.emit("draft:subscription-expired", { slug });
  }

  io.on("connection", (socket: TypedSocket) => {
    console.log(`[ws] client connected: ${socket.id}`);
    subscriptions.set(socket, new Map());

    socket.on("draft:join", (payload, ack) => {
      try {
        const slug = payload?.slug;
        if (typeof slug !== "string" || slug.length === 0) {
          ack?.({ error: "slug required" });
          return;
        }
        const userId = payload?.userId;
        const claims = typeof userId === "string"
          ? verifyDraftRoomToken(payload?.token, opts.secret, { slug, userId })
          : null;
        if (!claims || !hasAccess(claims)) {
          ack?.({ error: "This draft is only open to its players." });
          return;
        }
        const room = roomManager.getOrCreateRoom(slug, slug);
        roomManager.joinRoom(room, socket);
        subscriptions.get(socket)?.set(slug, { claims });
        ack?.();
      } catch (err) {
        console.error(`[ws] draft:join error for ${socket.id}`, err);
        ack?.({ error: "This draft is only open to its players." });
      }
    });

    socket.on("tournament:join", (payload, ack) => {
      try {
        const slug = payload?.slug;
        if (typeof slug !== "string" || slug.length === 0) {
          ack?.({ error: "slug required" });
          return;
        }
        socket.join(`tournament:${slug}`);
        ack?.();
      } catch (err) {
        console.error(`[ws] tournament:join error for ${socket.id}`, err);
        ack?.({ error: err instanceof Error ? err.message : String(err) });
      }
    });

    socket.on("disconnecting", () => {
      for (const slug of subscriptions.get(socket)?.keys() ?? []) leaveDraft(socket, slug, false);
      subscriptions.delete(socket);
    });
  });

  return {
    /** Check current permissions before every broadcast, including lobby-to-active transitions. */
    pruneDraftRoom(slug: string) {
      const room = roomManager.getRoom(slug);
      if (!room) return;
      for (const member of room.sockets) {
        const socket = member as TypedSocket;
        const subscription = subscriptions.get(socket)?.get(slug);
        if (!subscription || !hasAccess(subscription.claims)) {
          leaveDraft(socket, slug, true);
        }
      }
    },
  };
}
