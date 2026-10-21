import { verifyAdminSpectateToken, type AdminSpectateClaims } from "@yugidraft/shared/ws";
import type { TypedServer, TypedSocket } from "./events.js";

const roomOf = (c: AdminSpectateClaims) => c.kind === "duel" ? `duel:${c.guildId}:${c.slug}` : `draft:${c.slug}`;
/** Invalidations only. Kept outside normal occupancy and draft membership; there is no action handler. */
export function registerAdminSpectateHandlers(io: TypedServer, opts: { secret: string; canRead: (c: AdminSpectateClaims) => boolean }) {
  const members = new Map<TypedSocket, { claims: AdminSpectateClaims; timer: ReturnType<typeof setTimeout> }>();
  function authorized(c: AdminSpectateClaims) {
    try { return c.expiresAt > Date.now() && opts.canRead(c); } catch { return false; }
  }
  function leave(socket: TypedSocket, expired = false) {
    const previous = members.get(socket); if (!previous) return;
    clearTimeout(previous.timer); members.delete(socket);
    void socket.leave(roomOf(previous.claims));
    if (expired) socket.emit("admin:spectate-expired", { kind: previous.claims.kind, slug: previous.claims.slug });
  }
  io.on("connection", socket => {
    socket.on("admin:spectate", (payload, ack) => {
      const respond = typeof ack === "function" ? ack : undefined;
      const claims = verifyAdminSpectateToken(payload?.token, opts.secret);
      if (!claims || !authorized(claims)) { leave(socket); respond?.({ ok: false }); return; }
      const previous = members.get(socket);
      if (previous && roomOf(previous.claims) !== roomOf(claims)) leave(socket);
      else if (previous) clearTimeout(previous.timer);
      void socket.join(roomOf(claims));
      const timer = setTimeout(() => leave(socket, true), Math.max(0, claims.expiresAt - Date.now()));
      timer.unref(); members.set(socket, { claims, timer });
      respond?.({ ok: true });
    });
    socket.on("disconnecting", () => leave(socket));
  });
  return {
    prune(kind: "draft" | "duel", slug: string, guildId?: string) {
      for (const [socket, { claims }] of members) {
        if (claims.kind === kind && claims.slug === slug && (guildId === undefined || claims.guildId === guildId)
          && !authorized(claims)) leave(socket, true);
      }
    },
  };
}
