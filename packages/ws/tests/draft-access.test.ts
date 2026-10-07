import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { findDraftReadAccess } from "@yugidraft/shared/services";
import { createDraftRoomToken } from "@yugidraft/shared/ws";
import { registerEventHandlers, type TypedServer, type TypedSocket } from "../src/events.js";
import { createInternalHttpHandler } from "../src/internal-http.js";
import { DraftRoomManager } from "../src/rooms.js";

const secret = "existing-internal-secret";
const error = { error: "This draft is only open to its players." };
type Handler = (...args: any[]) => void;

describe("draft socket access without starting a server", () => {
  let db: Database.Database;
  let rooms: DraftRoomManager;
  let connect: (socket: TypedSocket) => void;
  let guard: ReturnType<typeof registerEventHandlers>;
  let server: TypedServer;
  const clients: ReturnType<typeof client>[] = [];

  function client(id = "socket-1") {
    const handlers = new Map<string, Handler>();
    const socket = {
      id,
      rooms: new Set([id]),
      on: (event: string, handler: Handler) => handlers.set(event, handler),
      emit: vi.fn(),
      join: (room: string) => { socket.rooms.add(room); },
      leave: (room: string) => { socket.rooms.delete(room); },
    };
    connect(socket as unknown as TypedSocket);
    return { socket, handlers };
  }

  function join(c: ReturnType<typeof client>, userId: number, options: { slug?: string; token?: string | null } = {}) {
    const slug = options.slug ?? "test-draft";
    const token = "token" in options ? options.token : createDraftRoomToken({ slug, userId, guildId: "guild-1", expiresAt: Date.now() + 60_000 }, secret);
    const ack = vi.fn();
    c.handlers.get("draft:join")!({ slug, userId, token }, ack);
    return ack.mock.calls[0]?.[0];
  }

  async function broadcast(kind: string) {
    const handle = createInternalHttpHandler({ io: server, secret, beforeDraftBroadcast: guard.pruneDraftRoom });
    const body = JSON.stringify({ slug: "test-draft", status: "active", playerId: 1, packRound: 1, pickStep: 1 });
    return handle(new Request(`http://internal/internal/draft/${kind}`, {
      method: "POST",
      headers: { "x-announce-signature": "sha256=" + createHmac("sha256", secret).update(body).digest("hex") },
      body,
    }));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    db = new Database(":memory:");
    migrate(db);
    db.prepare("insert into users (id, discord_user_id, username, display_name) values (101, '900000000000000101', 'yugi', 'Yugi'), (102, '900000000000000102', 'creator', 'Creator')").run();
    db.prepare("insert into players (id, guild_id, user_id, discord_user_id, display_name) values (1, 'guild-1', 101, '900000000000000101', 'Yugi')").run();
    db.prepare("insert into drafts (guild_id, channel_id, name, status, created_by_user_id, web_slug) values ('guild-1', 'channel', 'Draft', 'pending', 102, 'test-draft')").run();
    db.prepare("insert into draft_players (draft_id, player_id) values (1, 1)").run();
    rooms = new DraftRoomManager();
    clients.length = 0;
    server = {
      on: (_event: string, handler: typeof connect) => { connect = handler; },
      to: (room: string) => ({ emit: (event: string, payload: unknown) => {
        for (const c of clients) if (c.socket.rooms.has(room)) c.socket.emit(event, payload);
      } }),
    } as unknown as TypedServer;
    guard = registerEventHandlers(server, rooms, {
      secret,
      canReadDraft: (claims) => findDraftReadAccess(db, claims.slug, claims.guildId, claims.userId)?.canRead ?? false,
    });
    clients.push(client());
  });

  afterEach(() => {
    for (const c of clients) c.handlers.get("disconnecting")!();
    vi.useRealTimers();
    db.close();
  });

  for (const status of ["pending", "active", "completed", "cancelled"]) {
    for (const [user, userId] of [["player", 101], ["creator", 102], ["outsider", 103]] as const) {
      it(`${status}: signed room join for ${user}`, () => {
        db.prepare("update drafts set status = ? where id = 1").run(status);
        const allowed = status === "pending" || user !== "outsider";
        expect(join(clients[0], userId)).toEqual(allowed ? undefined : error);
        expect(clients[0].socket.rooms.has("draft:test-draft")).toBe(allowed);
      });
    }
  }

  for (const status of ["pending", "active"]) {
    it.each([null, undefined, ""])(`requires a token for ${status} drafts: %s`, (token) => {
      db.prepare("update drafts set status = ? where id = 1").run(status);
      expect(join(clients[0], 101, { token })).toEqual(error);
      expect(rooms.getRoom("test-draft")).toBeUndefined();
    });
  }

  it.each([
    { slug: "wrong-draft" },
    { userId: 104 },
    { guildId: "wrong-guild" },
    { expiresAt: 0 },
  ])("rejects a mismatched or expired token: %s", (overrides) => {
    const token = createDraftRoomToken({ slug: "test-draft", userId: 101, guildId: "guild-1", expiresAt: Date.now() + 60_000, ...overrides }, secret);
    expect(join(clients[0], 101, { token })).toEqual(error);
    expect(rooms.getRoom("test-draft")).toBeUndefined();
  });

  it.each(["101", "01", "1e3", "900000000000000101", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null])("rejects an invalid socket user ID before room admission: %s", (userId) => {
    const c = clients[0];
    const token = createDraftRoomToken({ slug: "test-draft", userId: 101, guildId: "guild-1", expiresAt: Date.now() + 60_000 }, secret);
    const ack = vi.fn();
    c.handlers.get("draft:join")!({ slug: "test-draft", userId, token }, ack);
    expect(ack).toHaveBeenCalledWith(error);
    expect(c.socket.rooms.has("draft:test-draft")).toBe(false);
    expect(rooms.getRoom("test-draft")).toBeUndefined();
  });

  it("checks access again when a lobby token is replayed after the draft starts", () => {
    const token = createDraftRoomToken({ slug: "test-draft", userId: 103, guildId: "guild-1", expiresAt: Date.now() + 60_000 }, secret);
    db.prepare("update drafts set status = 'active' where id = 1").run();
    expect(join(clients[0], 103, { token })).toEqual(error);
    expect(rooms.getRoom("test-draft")).toBeUndefined();
  });

  it.each(["status", "pick", "resync", "complete", "seats"])("removes lobby outsiders before a started draft's %s broadcast", async (kind) => {
    clients.push(client("socket-2"));
    join(clients[0], 103);
    join(clients[1], 101);
    db.prepare("update drafts set status = 'active' where id = 1").run();
    const response = await broadcast(kind);
    expect(response.status).toBe(204);
    expect(clients[0].socket.rooms.has("draft:test-draft")).toBe(false);
    expect(clients[0].socket.emit).toHaveBeenCalledWith("draft:subscription-expired", { slug: "test-draft" });
    expect(clients[0].socket.emit).not.toHaveBeenCalledWith(`draft:${kind}`, expect.anything());
    expect(clients[1].socket.rooms.has("draft:test-draft")).toBe(true);
    expect(clients[1].socket.emit).toHaveBeenCalledWith(`draft:${kind}`, expect.anything());
  });

  it("keeps a joined socket subscribed and receiving broadcasts after token expiry", async () => {
    db.prepare("update drafts set status = 'active' where id = 1").run();
    expect(join(clients[0], 101)).toBeUndefined();
    vi.advanceTimersByTime(60_001);
    expect(clients[0].socket.rooms.has("draft:test-draft")).toBe(true);
    const response = await broadcast("pick");
    expect(response.status).toBe(204);
    expect(clients[0].socket.rooms.has("draft:test-draft")).toBe(true);
    expect(clients[0].socket.emit).toHaveBeenCalledWith("draft:pick", { playerId: 1, packRound: 1, pickStep: 1 });
    expect(clients[0].socket.emit).not.toHaveBeenCalledWith("draft:subscription-expired", expect.anything());
  });

  it("removes a socket whose database access is revoked on the next broadcast", async () => {
    db.prepare("update drafts set status = 'active' where id = 1").run();
    expect(join(clients[0], 101)).toBeUndefined();
    db.prepare("delete from draft_players where draft_id = 1 and player_id = 1").run();
    expect(clients[0].socket.rooms.has("draft:test-draft")).toBe(true);
    const response = await broadcast("pick");
    expect(response.status).toBe(204);
    expect(clients[0].socket.rooms.has("draft:test-draft")).toBe(false);
    expect(rooms.getRoom("test-draft")).toBeUndefined();
    expect(clients[0].socket.emit).toHaveBeenCalledWith("draft:subscription-expired", { slug: "test-draft" });
    expect(clients[0].socket.emit).not.toHaveBeenCalledWith("draft:pick", expect.anything());
  });

  it("removes memberships on disconnect", () => {
    join(clients[0], 101);
    clients[0].handlers.get("disconnecting")!();
    expect(rooms.getRoom("test-draft")).toBeUndefined();
  });

  it("keeps memberships in multiple drafts after both tokens expire", () => {
    db.prepare("insert into drafts (guild_id, channel_id, name, status, created_by_user_id, web_slug) values ('guild-1', 'channel', 'Other draft', 'pending', 102, 'other-draft')").run();
    join(clients[0], 101);
    vi.advanceTimersByTime(30_000);
    join(clients[0], 101, { slug: "other-draft" });
    vi.advanceTimersByTime(60_001);
    guard.pruneDraftRoom("test-draft");
    guard.pruneDraftRoom("other-draft");
    expect(clients[0].socket.rooms.has("draft:test-draft")).toBe(true);
    expect(clients[0].socket.rooms.has("draft:other-draft")).toBe(true);
  });

  it("refuses an unknown draft even with a correctly signed token", () => {
    expect(join(clients[0], 101, { slug: "missing-draft" })).toEqual(error);
    expect(rooms.getRoom("missing-draft")).toBeUndefined();
  });

  it("fails closed if the permission query fails", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "prepare").mockImplementationOnce(() => { throw new Error("Database unavailable"); });
    expect(join(clients[0], 101)).toEqual(error);
    expect(rooms.getRoom("test-draft")).toBeUndefined();
    log.mockRestore();
  });

  it("leaves tournament joins open by slug as before", () => {
    const ack = vi.fn();
    clients[0].handlers.get("tournament:join")!({ slug: "tournament-1" }, ack);
    expect(ack.mock.calls[0]).toEqual([]);
    expect(clients[0].socket.rooms.has("tournament:tournament-1")).toBe(true);
  });
});
