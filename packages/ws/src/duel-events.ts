import { verifyDuelConnectionToken } from "@yugidraft/shared/ws";
import type { TypedServer, TypedSocket } from "./events.js";

type Occupant = { playerId: number; seat: number | null };

export function registerDuelEventHandlers(io: TypedServer, opts: { secret: string }): void {
  const occupancy = new Map<string, Map<string, Occupant>>();
  const expiryTimers = new Map<string, NodeJS.Timeout>();

  function presenceSnapshot(roomKey: string): { onlineSeats: number[]; spectatorCount: number } {
    const seats = new Set<number>();
    const spectators = new Set<number>();
    const members = occupancy.get(roomKey);
    if (members) {
      for (const member of members.values()) {
        if (member.seat === null) spectators.add(member.playerId);
        else seats.add(member.seat);
      }
    }
    return { onlineSeats: [...seats].sort((a, b) => a - b), spectatorCount: spectators.size };
  }

  function emitPresence(roomKey: string, slug: string): void {
    const snapshot = presenceSnapshot(roomKey);
    io.to(roomKey).emit("duel:presence", {
      slug,
      onlineSeats: snapshot.onlineSeats,
      spectatorCount: snapshot.spectatorCount,
    });
  }

  function detachSocket(socket: TypedSocket, reason: "leave" | "expired"): void {
    const timer = expiryTimers.get(socket.id);
    if (timer) {
      clearTimeout(timer);
      expiryTimers.delete(socket.id);
    }
    const membership = socket.data.duel;
    if (!membership) return;
    const roomKey = `duel:${membership.guildId}:${membership.slug}`;
    socket.leave(roomKey);
    const members = occupancy.get(roomKey);
    members?.delete(socket.id);
    if (members && members.size === 0) occupancy.delete(roomKey);
    socket.data.duel = undefined;
    if (reason === "expired") {
      socket.emit("duel:subscription-expired", { slug: membership.slug });
    }
    emitPresence(roomKey, membership.slug);
  }

  io.on("connection", (socket: TypedSocket) => {
    socket.on("duel:join", (payload, ack) => {
      try {
        const token = payload && typeof payload === "object" ? payload.token : undefined;
        if (typeof token !== "string" || token.length === 0) {
          ack?.({ ok: false, error: "token required" });
          return;
        }
        const claims = verifyDuelConnectionToken(token, opts.secret);
        if (!claims) {
          ack?.({ ok: false, error: "invalid token" });
          return;
        }
        if (socket.data.duel) detachSocket(socket, "leave");
        const roomKey = `duel:${claims.guildId}:${claims.slug}`;
        let members = occupancy.get(roomKey);
        if (!members) {
          members = new Map();
          occupancy.set(roomKey, members);
        }
        members.set(socket.id, { playerId: claims.playerId, seat: claims.seat });
        socket.data.duel = {
          slug: claims.slug,
          guildId: claims.guildId,
          playerId: claims.playerId,
          seat: claims.seat,
          expiresAt: claims.expiresAt,
        };
        void socket.join(roomKey);
        const delay = Math.max(0, claims.expiresAt - Date.now());
        expiryTimers.set(
          socket.id,
          setTimeout(() => {
            expiryTimers.delete(socket.id);
            const current = socket.data.duel;
            if (!current || current.expiresAt !== claims.expiresAt) return;
            detachSocket(socket, "expired");
          }, delay),
        );
        const snapshot = presenceSnapshot(roomKey);
        ack?.({ ok: true, onlineSeats: snapshot.onlineSeats, spectatorCount: snapshot.spectatorCount });
        emitPresence(roomKey, claims.slug);
      } catch (err) {
        console.error(`[ws] duel:join error for ${socket.id}`, err);
        ack?.({ ok: false, error: "join failed" });
      }
    });

    socket.on("duel:leave", (payload) => {
      const membership = socket.data.duel;
      if (!membership || !payload || typeof payload !== "object") return;
      if (payload.slug !== membership.slug || payload.guildId !== membership.guildId) return;
      detachSocket(socket, "leave");
    });

    socket.on("disconnecting", () => {
      if (socket.data.duel) detachSocket(socket, "leave");
    });
  });
}
