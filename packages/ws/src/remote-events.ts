import { verifyRemoteConnectionToken, createTalkLimiter, type RemoteConnectionTokenClaims } from "@yugidraft/shared/ws";
import { remoteDataMessageSchema, remoteSocketRoom, type RemoteSnapshot } from "@yugidraft/shared/remote";
import type { TypedServer, TypedSocket } from "./events.js";

export function registerRemoteEventHandlers(io: TypedServer, opts: {
  secret: string;
  canRead: (claims: RemoteConnectionTokenClaims) => boolean;
  readSnapshot: (slug: string, guildId: string) => RemoteSnapshot | null;
}) {
  const members = new Map<string, Set<TypedSocket>>();
  const timers = new Map<string, NodeJS.Timeout>();
  const limiter = createTalkLimiter({ cooldownMs: 100 });
  const pending = new Map<string, Map<string, { owner: number; requester: number; expiresAt: number }>>();
  function authorized(claims: RemoteConnectionTokenClaims) {
    try { return claims.expiresAt > Date.now() && opts.canRead(claims); } catch { return false; }
  }
  function detach(socket: TypedSocket, expired = false) {
    const timer = timers.get(socket.id); if (timer) clearTimeout(timer); timers.delete(socket.id);
    const claims = socket.data.remote; if (!claims) return;
    const room = remoteSocketRoom(claims.guildId, claims.slug);
    socket.leave(room); members.get(room)?.delete(socket);
    if (!members.get(room)?.size) { members.delete(room); pending.delete(room); }
    socket.data.remote = undefined;
    if (expired) socket.emit("remote:subscription-expired", { slug: claims.slug });
  }
  function prune(slug: string, guildId: string) {
    for (const socket of [...(members.get(remoteSocketRoom(guildId, slug)) ?? [])]) {
      if (!socket.data.remote || !authorized(socket.data.remote)) detach(socket, true);
    }
  }
  function snapshot(slug: string, guildId: string) {
    prune(slug, guildId); return opts.readSnapshot(slug, guildId);
  }
  function publish(slug: string, guildId: string) {
    const data = snapshot(slug, guildId);
    if (data) io.to(remoteSocketRoom(guildId, slug)).emit("remote:changed", data);
  }
  io.on("connection", socket => {
    socket.on("remote:join", (payload, ack) => {
      const claims = verifyRemoteConnectionToken(payload?.token, opts.secret);
      if (!claims || !authorized(claims)) { ack?.({ ok: false, error: "Invalid or revoked remote token" }); return; }
      detach(socket);
      const room = remoteSocketRoom(claims.guildId, claims.slug);
      socket.data.remote = claims; socket.join(room);
      if (!members.has(room)) members.set(room, new Set());
      members.get(room)!.add(socket);
      timers.set(socket.id, setTimeout(() => detach(socket, true), Math.max(1, claims.expiresAt - Date.now())));
      ack?.({ ok: true });
    });
    socket.on("remote:leave", () => detach(socket));
    socket.on("disconnect", () => detach(socket));
    socket.on("remote:data", (payload, ack) => {
      const claims = socket.data.remote;
      if (!claims || !authorized(claims)) { detach(socket, true); ack?.({ ok: false, error: "Remote membership expired" }); return; }
      if (!payload || typeof payload !== "object" || JSON.stringify(payload).length > 8192) { ack?.({ ok: false, error: "Invalid data message" }); return; }
      const parsed = remoteDataMessageSchema.safeParse(payload);
      if (!parsed.success) { ack?.({ ok: false, error: "Invalid data message" }); return; }
      const limit = limiter.take(`${claims.guildId}:${claims.slug}:${claims.userId}`);
      if (!limit.ok) { ack?.({ ok: false, error: "Rate limited", retryAfterMs: limit.retryAfterMs }); return; }
      prune(claims.slug, claims.guildId);
      const room = remoteSocketRoom(claims.guildId, claims.slug); const message = parsed.data;
      if (!pending.has(room)) pending.set(room, new Map());
      const requests = pending.get(room)!;
      for (const [key, req] of requests) if (req.expiresAt <= Date.now()) requests.delete(key);
      if (message.type === "recognition.request") {
        const targets = [...(members.get(room) ?? [])].filter(s => s.data.remote?.seat === message.feedOwnerSeat);
        if (!targets.length || requests.size >= 128 || requests.has(message.requestId)) { ack?.({ ok: false, error: "Feed unavailable or request already pending" }); return; }
        requests.set(message.requestId, { owner: message.feedOwnerSeat, requester: claims.seat, expiresAt: Date.now() + 10_000 });
        for (const target of targets) target.emit("remote:data", { slug: claims.slug, fromSeat: claims.seat, message });
      } else {
        const request = requests.get(message.requestId);
        if (!request || request.owner !== claims.seat) { ack?.({ ok: false, error: "Unknown request or wrong feed owner" }); return; }
        requests.delete(message.requestId);
        io.to(room).emit("remote:data", { slug: claims.slug, fromSeat: claims.seat, message });
      }
      ack?.({ ok: true });
    });
  });
  return { snapshot, publish };
}
