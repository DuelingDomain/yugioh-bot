import { verifyRemoteConnectionToken, createTalkLimiter, type RemoteConnectionTokenClaims } from "@yugidraft/shared/ws";
import { diffView, makePatch, remoteDataMessageSchema, remoteSocketRoom, remoteSpectatorSocketRoom, type RemotePatchMessage, type RemoteSnapshot } from "@yugidraft/shared/remote";
import type { TypedServer, TypedSocket } from "./events.js";

/** What the browser holds as its room: the table fields, `state` and `events`. Patches are relative to it. The browser adds its own seat and flags. */
type RoomView = RemoteSnapshot["table"] & Pick<RemoteSnapshot, "state" | "events">;
export type RemoteViews = { players: Map<number, RemoteSnapshot | null>; spectator?: RemoteSnapshot; publicView?: RemoteSnapshot };
/** The spectators that joined with `patch: 1` sit in their own socket room, so one serialization reaches all of them. */
const remotePatchSpectatorRoom = (guildId: string, slug: string) => `remote-spectators-patch:${guildId}:${slug}`;
const SPECTATOR_VIEWER = "spectator";

export function registerRemoteEventHandlers(io: TypedServer, opts: {
  secret: string;
  canRead: (claims: RemoteConnectionTokenClaims) => boolean;
  readPrivateSnapshot?: (claims: RemoteConnectionTokenClaims) => RemoteSnapshot | null;
  readSnapshot: (slug: string, guildId: string) => RemoteSnapshot | null;
  readSpectatorSnapshot?: (slug: string, guildId: string) => RemoteSnapshot | null;
  /** One read of the table for all the views a publish needs. When it is missing, the three readers above are used. */
  readViews?: (slug: string, guildId: string, want: { userIds: readonly number[]; spectator: boolean; publicView: boolean }) => RemoteViews | null;
}) {
  const members = new Map<string, Set<TypedSocket>>();
  /** Spectator sockets, by the spectator room. They receive only the spectator projection, never a player room event. */
  const spectators = new Map<string, Set<TypedSocket>>();
  const timers = new Map<string, NodeJS.Timeout>();
  /** Sockets that joined with `patch: 1`. Every other socket keeps the full messages it always got. */
  const patchCapable = new Set<string>();
  /**
   * The last view sent to the patch sockets of each viewer, by table. An entry exists only while the viewer has a patch socket joined,
   * and a table's map goes when its last socket leaves, so memory is bounded by the viewers now connected (seats plus one spectator view).
   */
  const lastSent = new Map<string, Map<string, { seq: number; view: RoomView }>>();
  const limiter = createTalkLimiter({ cooldownMs: 100 });
  const pending = new Map<string, Map<string, { owner: number; requester: number; expiresAt: number }>>();
  const viewerKey = (claims: RemoteConnectionTokenClaims) => claims.seat === null ? SPECTATOR_VIEWER : `user:${claims.userId}`;
  function authorized(claims: RemoteConnectionTokenClaims) {
    try { return claims.expiresAt > Date.now() && opts.canRead(claims); } catch { return false; }
  }
  /** Drop the cached view of a viewer that has no patch socket left, and the whole table's cache when nobody is joined. */
  function releaseViews(claims: RemoteConnectionTokenClaims) {
    const room = remoteSocketRoom(claims.guildId, claims.slug), watching = remoteSpectatorSocketRoom(claims.guildId, claims.slug);
    const key = viewerKey(claims), cache = lastSent.get(room);
    const sockets = claims.seat === null ? spectators.get(watching) : members.get(room);
    if (cache && ![...(sockets ?? [])].some(s => patchCapable.has(s.id) && s.data.remote && viewerKey(s.data.remote) === key)) cache.delete(key);
    if (cache && !cache.size) lastSent.delete(room);
    if (!members.get(room)?.size && !spectators.get(watching)?.size) lastSent.delete(room);
  }
  function detach(socket: TypedSocket, expired = false) {
    const timer = timers.get(socket.id); if (timer) clearTimeout(timer); timers.delete(socket.id);
    const claims = socket.data.remote; if (!claims) return;
    if (claims.seat === null) {
      const watching = remoteSpectatorSocketRoom(claims.guildId, claims.slug);
      socket.leave(watching); socket.leave(remotePatchSpectatorRoom(claims.guildId, claims.slug)); spectators.get(watching)?.delete(socket);
      if (!spectators.get(watching)?.size) spectators.delete(watching);
    } else {
      const room = remoteSocketRoom(claims.guildId, claims.slug);
      socket.leave(room); members.get(room)?.delete(socket);
      if (!members.get(room)?.size) { members.delete(room); pending.delete(room); }
    }
    patchCapable.delete(socket.id);
    socket.data.remote = undefined;
    releaseViews(claims);
    if (expired) socket.emit("remote:subscription-expired", { slug: claims.slug });
  }
  function prune(slug: string, guildId: string) {
    for (const socket of [...(members.get(remoteSocketRoom(guildId, slug)) ?? []), ...(spectators.get(remoteSpectatorSocketRoom(guildId, slug)) ?? [])]) {
      if (!socket.data.remote || !authorized(socket.data.remote)) detach(socket, true);
    }
  }
  /**
   * What one viewer's patch sockets get now: a patch, the full view (no earlier view, the patch is not smaller, or the sequence did not move,
   * which a browser would drop as old), or nothing (no change).
   */
  function nextMessage(room: string, key: string, view: RemoteSnapshot): { patch: RemotePatchMessage } | { full: RemoteSnapshot } | null {
    let cache = lastSent.get(room); if (!cache) lastSent.set(room, cache = new Map());
    const prev = cache.get(key), seq = view.table.lastSeq;
    const flat: RoomView = { ...view.table, state: view.state, events: view.events };
    cache.set(key, { seq, view: flat });
    if (!prev || seq <= prev.seq) return prev && seq === prev.seq && !diffView(prev.view, flat).length ? null : { full: view };
    const patch = makePatch(prev.view, flat, prev.seq, seq);
    return patch ? { patch: { slug: view.table.slug, ...patch } } : { full: view };
  }
  function readViews(slug: string, guildId: string, want: { userIds: number[]; spectator: boolean; publicView: boolean }, claimsOf: (userId: number) => RemoteConnectionTokenClaims | undefined): RemoteViews | null {
    if (opts.readViews) return opts.readViews(slug, guildId, want);
    const publicView = want.publicView ? opts.readSnapshot(slug, guildId) : undefined;
    if (want.publicView && !publicView) return null;
    const players = new Map<number, RemoteSnapshot | null>();
    for (const userId of want.userIds) { const claims = claimsOf(userId); players.set(userId, claims && opts.readPrivateSnapshot ? opts.readPrivateSnapshot(claims) : null); }
    return { players, spectator: want.spectator ? opts.readSpectatorSnapshot?.(slug, guildId) ?? undefined : undefined, publicView: publicView ?? undefined };
  }
  /**
   * Sends every viewer its own view. A viewer on a patch socket gets a small patch of its own projected view; every other socket
   * gets the full private view and the public notification as before. The public view is read only when an old socket needs it.
   * Returns the public view when `wantPublic` is set (the old internal read), else whether the table exists.
   */
  function broadcast(slug: string, guildId: string, mode: { notifyLegacy: boolean; wantPublic: boolean }): { found: boolean; publicView?: RemoteSnapshot } {
    prune(slug, guildId);
    const room = remoteSocketRoom(guildId, slug), watching = remoteSpectatorSocketRoom(guildId, slug), patchWatching = remotePatchSpectatorRoom(guildId, slug);
    const players = [...(members.get(room) ?? [])].filter(s => s.data.remote);
    const watchers = [...(spectators.get(watching) ?? [])];
    const legacyPlayers = players.filter(s => !patchCapable.has(s.id));
    const userIds = [...new Set(players.map(s => s.data.remote!.userId))];
    if (!mode.wantPublic && !players.length && !watchers.length) return { found: true };
    let views: RemoteViews | null;
    try {
      views = readViews(slug, guildId, { userIds, spectator: watchers.length > 0, publicView: mode.wantPublic || (mode.notifyLegacy && legacyPlayers.length > 0) },
        userId => players.find(s => s.data.remote!.userId === userId)?.data.remote);
    } catch (error) {
      if (error instanceof Error && "status" in error && error.status === 404) views = null; else throw error;
    }
    if (!views) return { found: false };
    for (const userId of userIds) {
      const view = views.players.get(userId); if (!view) continue;
      const mine = players.filter(s => s.data.remote!.userId === userId), capable = mine.filter(s => patchCapable.has(s.id));
      for (const socket of mine) if (!patchCapable.has(socket.id)) socket.emit("remote:private", view);
      const message = capable.length ? nextMessage(room, `user:${userId}`, view) : null;
      if (message) for (const socket of capable) { if ("patch" in message) socket.emit("remote:patch", message.patch); else socket.emit("remote:private", message.full); }
    }
    if (views.spectator) {
      const patchOnes = watchers.filter(s => patchCapable.has(s.id)).length;
      // One emit per spectator room: the message is serialized once, whatever the number of spectators.
      if (patchOnes < watchers.length) io.to(watching).emit("remote:private", views.spectator);
      if (patchOnes) {
        const message = nextMessage(room, SPECTATOR_VIEWER, views.spectator);
        if (message) { if ("patch" in message) io.to(patchWatching).emit("remote:patch", message.patch); else io.to(patchWatching).emit("remote:private", message.full); }
      }
    }
    if (mode.notifyLegacy && views.publicView) for (const socket of legacyPlayers) socket.emit("remote:changed", views.publicView);
    return { found: true, publicView: views.publicView };
  }
  /** The old internal read: private messages go out, and the caller sends the public notification. */
  function snapshot(slug: string, guildId: string) {
    return broadcast(slug, guildId, { notifyLegacy: false, wantPublic: true }).publicView ?? null;
  }
  /** Sends every viewer its message. False when the table does not exist. */
  function publish(slug: string, guildId: string) {
    return broadcast(slug, guildId, { notifyLegacy: true, wantPublic: false }).found;
  }
  io.on("connection", socket => {
    socket.on("remote:join", (payload, ack) => {
      const claims = verifyRemoteConnectionToken(payload?.token, opts.secret);
      if (!claims || !authorized(claims)) { ack?.({ ok: false, error: "Invalid or revoked remote token" }); return; }
      detach(socket);
      const room = claims.seat === null ? remoteSpectatorSocketRoom(claims.guildId, claims.slug) : remoteSocketRoom(claims.guildId, claims.slug);
      const list = claims.seat === null ? spectators : members;
      socket.data.remote = claims;
      const patch = payload?.patch === 1;
      if (patch) patchCapable.add(socket.id);
      socket.join(claims.seat === null && patch ? remotePatchSpectatorRoom(claims.guildId, claims.slug) : room);
      if (!list.has(room)) list.set(room, new Set());
      list.get(room)!.add(socket);
      timers.set(socket.id, setTimeout(() => detach(socket, true), Math.max(1, claims.expiresAt - Date.now())));
      ack?.({ ok: true });
    });
    socket.on("remote:leave", () => detach(socket));
    socket.on("disconnect", () => detach(socket));
    socket.on("remote:data", (payload, ack) => {
      const claims = socket.data.remote;
      if (!claims || !authorized(claims)) { detach(socket, true); ack?.({ ok: false, error: "Remote membership expired" }); return; }
      if (claims.seat === null) { ack?.({ ok: false, error: "Spectators cannot send table data" }); return; }
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
