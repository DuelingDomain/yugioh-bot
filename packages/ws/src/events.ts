import type { Server, Socket } from "socket.io";
import type { DraftRoomManager } from "./rooms.js";

export type DraftStatus = "active" | "cancelled" | "completed";

export interface DraftJoinPayload {
  slug: string;
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
) {
  io.on("connection", (socket: TypedSocket) => {
    console.log(`[ws] client connected: ${socket.id}`);

    socket.on("draft:join", (payload, ack) => {
      try {
        const slug = payload?.slug;
        if (typeof slug !== "string" || slug.length === 0) {
          ack?.({ error: "slug required" });
          return;
        }
        const room = roomManager.getOrCreateRoom(slug, slug);
        roomManager.joinRoom(room, socket);
        ack?.();
      } catch (err) {
        console.error(`[ws] draft:join error for ${socket.id}`, err);
        ack?.({ error: err instanceof Error ? err.message : String(err) });
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
      for (const roomName of socket.rooms) {
        if (roomName === socket.id || !roomName.startsWith("draft:")) continue;
        const slug = roomName.slice("draft:".length);
        if (!slug) continue;
        const draftRoom = roomManager.getRoom(slug);
        if (draftRoom) {
          roomManager.leaveRoom(draftRoom, socket);
        }
      }
    });
  });
}
