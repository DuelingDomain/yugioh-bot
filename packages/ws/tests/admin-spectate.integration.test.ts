import { createServer } from "node:http";
import Database from "better-sqlite3";
import { Server } from "socket.io";
import { io as connect, type Socket } from "socket.io-client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { canAdminSpectate } from "@yugidraft/shared/services";
import { createAdminSpectateToken, createDuelConnectionToken } from "@yugidraft/shared/ws";
import { registerAdminSpectateHandlers } from "../src/admin-spectate-events.js";
import { registerDuelEventHandlers } from "../src/duel-events.js";
import type { TypedServer } from "../src/events.js";
let db: Database.Database; let io: TypedServer; let url: string;
let events: ReturnType<typeof registerAdminSpectateHandlers>;
const clients: Socket[] = [];
const secret = "admin-socket-test";
beforeEach(async () => {
  vi.stubEnv("DISCORD_GUILD_ID", "g"); vi.stubEnv("OWNER_USER_IDS", "1");
  db = new Database(":memory:"); migrate(db);
  db.exec(`insert into users(id,username,display_name) values(1,'owner','Owner'),(2,'player','Player');
    insert into players(id,guild_id,discord_user_id,display_name,user_id) values(12,'g','p','Player',2);
    insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status,settings_json) values(1,'g','private','Private',12,'normal','active','{"visibility":"private"}');
    insert into drafts(guild_id,channel_id,name,web_slug,created_by_user_id,status,visibility) values('g','c','Draft','draft',2,'active','private');`);
  const server = createServer(); io = new Server(server);
  events = registerAdminSpectateHandlers(io, { secret, canRead: c => canAdminSpectate(db, c) });
  registerDuelEventHandlers(io, { secret, canReadDuel: () => true, beforePresence: (slug, guild) => events.prune("duel", slug, guild) });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => { for (const c of clients.splice(0)) c.disconnect(); await new Promise<void>(resolve => io.close(() => resolve())); db.close(); vi.unstubAllEnvs(); });
async function client() { const c = connect(url, { transports: ["websocket"] }); clients.push(c); await new Promise<void>(resolve => c.on("connect", resolve)); return c; }
function token(kind: "draft" | "duel" = "duel", extra = {}) { return createAdminSpectateToken({ role: "admin-spectator", kind, slug: kind === "duel" ? "private" : "draft", guildId: "g", userId: 1, expiresAt: Date.now() + 60_000, ...extra }, secret); }
it.each(["duel", "draft"] as const)("receives %s invalidations with a signed read-only claim and prunes revocation", async kind => {
  const c = await client(); expect(await c.emitWithAck("admin:spectate", { token: token(kind) })).toEqual({ ok: true });
  const room = kind === "duel" ? "duel:g:private" : "draft:draft";
  const update = new Promise(resolve => c.once(`${kind}:${kind === "duel" ? "changed" : "resync"}`, resolve));
  io.to(room).emit(kind === "duel" ? "duel:changed" : "draft:resync", { slug: "private", packRound: 1, pickStep: 2 } as never);
  await update;
  const expired = new Promise(resolve => c.once("admin:spectate-expired", resolve));
  vi.stubEnv("OWNER_USER_IDS", ""); events.prune(kind, kind === "duel" ? "private" : "draft", "g");
  await expired; expect(io.sockets.adapter.rooms.get(room)?.size ?? 0).toBe(0);
});
it("never counts an admin as a participant or spectator, even with observe=false", async () => {
  const admin = await client();
  expect(await admin.emitWithAck("admin:spectate", { token: token(), observe: false, seat: 0 })).toEqual({ ok: true });
  expect(io.sockets.sockets.get(admin.id!)?.data.duel).toBeUndefined();
  const player = await client(); const presence = await player.emitWithAck("duel:join", { token: createDuelConnectionToken({ slug: "private", guildId: "g", playerId: 12, seat: 0, expiresAt: Date.now() + 60_000 }, secret) });
  expect(presence).toEqual({ ok: true, onlineSeats: [0], spectatorCount: 0 });
  expect(await admin.emitWithAck("duel:join", { token: token() })).toMatchObject({ ok: false });
});
it("denies signed non-owner, cross-guild, missing, forged and expired credentials", async () => {
  const c = await client();
  for (const value of [token("duel", { userId: 2 }), token("duel", { guildId: "other" }), token("duel", { slug: "missing" }), token("duel", { expiresAt: Date.now() - 1 }), token() + "x"]) {
    expect(await c.emitWithAck("admin:spectate", { token: value })).toEqual({ ok: false });
  }
  expect([...io.sockets.sockets.get(c.id!)!.rooms]).toEqual([c.id]);
});

it("ignores malformed acknowledgement arguments without losing the socket server", async () => {
  const c = await client();
  c.emit("admin:spectate", { token: "invalid" }, "not a callback");
  expect(await c.timeout(2000).emitWithAck("admin:spectate", { token: token() })).toEqual({ ok: true });
});

it("prunes revoked admins before ordinary player presence is broadcast", async () => {
  const admin = await client(); await admin.emitWithAck("admin:spectate", { token: token() });
  const seen: unknown[] = []; admin.on("duel:presence", payload => seen.push(payload));
  const expired = new Promise(resolve => admin.once("admin:spectate-expired", resolve));
  vi.stubEnv("OWNER_USER_IDS", ""); const player = await client();
  await player.emitWithAck("duel:join", { token: createDuelConnectionToken({ slug: "private", guildId: "g", playerId: 12, seat: 0, expiresAt: Date.now() + 60_000 }, secret) });
  await expired; expect(seen).toEqual([]);
});
