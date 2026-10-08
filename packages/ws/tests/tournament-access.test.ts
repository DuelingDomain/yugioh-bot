import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { findTournamentReadAccess } from "@yugidraft/shared/services";
import { createDraftRoomToken, createTournamentRoomToken } from "@yugidraft/shared/ws";
import { registerEventHandlers, type TypedServer, type TypedSocket } from "../src/events.js";
import { createInternalHttpHandler } from "../src/internal-http.js";
import { DraftRoomManager } from "../src/rooms.js";

const secret = "existing-internal-secret";
const denied = { error: "Tournament not found" };
type Handler = (...args: any[]) => void;
type Client = {
  socket: {
    id: string;
    rooms: Set<string>;
    on: (event: string, handler: Handler) => Map<string, Handler>;
    emit: ReturnType<typeof vi.fn<Handler>>;
    join: (room: string) => void;
    leave: (room: string) => void;
  };
  handlers: Map<string, Handler>;
};

describe("tournament room admission and broadcasts", () => {
  let db: Database.Database;
  let connect: (socket: TypedSocket) => void;
  let guard: ReturnType<typeof registerEventHandlers>;
  let server: TypedServer;
  const clients: Client[] = [];
  function client(id = "socket-1"): Client {
    const handlers = new Map<string, Handler>();
    const socket = {
      id, rooms: new Set([id]),
      on: (event: string, handler: Handler) => handlers.set(event, handler),
      emit: vi.fn<Handler>(),
      join: (room: string) => { socket.rooms.add(room); },
      leave: (room: string) => { socket.rooms.delete(room); },
    };
    connect(socket as unknown as TypedSocket);
    clients.push({ socket, handlers });
    return { socket, handlers };
  }
  const claims = () => ({ slug: "test-cup", userId: 101, guildId: "guild-1", expiresAt: Date.now() + 60_000 });
  function join(token?: unknown, slug = "test-cup", c = clients[0]) {
    const ack = vi.fn();
    c.handlers.get("tournament:join")!({ slug, userId: 101, token }, ack);
    return ack.mock.calls[0]?.[0];
  }
  beforeEach(() => {
    vi.useFakeTimers();
    db = new Database(":memory:");
    migrate(db);
    db.exec("insert into users(id,username,display_name) values(101,'yugi','Yugi'); insert into tournaments(guild_id,name,format,status,created_by_user_id,web_slug) values('guild-1','Cup','round_robin','pending',101,'test-cup')");
    clients.length = 0;
    server = {
      on: (_event: string, handler: typeof connect) => { connect = handler; },
      to: (room: string) => ({ emit: (event: string, payload: unknown) => {
        for (const c of clients) if (c.socket.rooms.has(room)) c.socket.emit(event, payload);
      } }),
    } as unknown as TypedServer;
    guard = registerEventHandlers(server, new DraftRoomManager(), {
      secret, canReadDraft: () => false,
      canReadTournament: (c) => findTournamentReadAccess(db, c.slug, c.guildId, c.userId)?.canRead ?? false,
    });
    client();
  });
  afterEach(() => { vi.useRealTimers(); db.close(); });
  it.each([null, undefined, "", "invalid"])("requires a signed token: %s", (token) => {
    expect(join(token)).toEqual(denied);
    expect(clients[0].socket.rooms.has("tournament:test-cup")).toBe(false);
  });
  it.each([{ slug: "wrong-cup" }, { guildId: "other-guild" }, { userId: 102 }, { expiresAt: 0 }])("rejects wrong or expired claims: %s", (override) => {
    expect(join(createTournamentRoomToken({ ...claims(), ...override }, secret))).toEqual(denied);
    expect(clients[0].socket.rooms.has("tournament:test-cup")).toBe(false);
  });
  it("rejects a draft token even with the same claims", () => {
    expect(join(createDraftRoomToken(claims(), secret))).toEqual(denied);
  });
  it("allows a guild reader and rechecks database access on replay", () => {
    const token = createTournamentRoomToken(claims(), secret);
    expect(join(token)).toBeUndefined();
    expect(clients[0].socket.rooms.has("tournament:test-cup")).toBe(true);
    db.exec("update tournaments set guild_id='other-guild'");
    const c = client("socket-2");
    expect(join(token, "test-cup", c)).toEqual(denied);
    expect(c.socket.rooms.has("tournament:test-cup")).toBe(false);
  });
  it("fails closed when the permission query throws", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "prepare").mockImplementationOnce(() => { throw new Error("Unavailable"); });
    expect(join(createTournamentRoomToken(claims(), secret))).toEqual(denied);
    expect(clients[0].socket.rooms.has("tournament:test-cup")).toBe(false);
    log.mockRestore();
  });
  it.each(["participant-joined", "participant-left", "started", "cancelled", "completed", "match-updated"])("prunes revoked subscriptions before %s", async (kind) => {
    join(createTournamentRoomToken(claims(), secret));
    db.exec("update tournaments set guild_id='other-guild'");
    const handler = createInternalHttpHandler({ io: server, secret, beforeTournamentBroadcast: guard.pruneTournamentRoom });
    const body = JSON.stringify({ slug: "test-cup", playerId: 1, displayName: "Private name" });
    const response = await handler(new Request(`http://internal/internal/tournament/${kind}`, {
      method: "POST", body,
      headers: { "x-announce-signature": "sha256=" + createHmac("sha256", secret).update(body).digest("hex") },
    }));
    expect(response.status).toBe(204);
    expect(clients[0].socket.rooms.has("tournament:test-cup")).toBe(false);
    expect(clients[0].socket.emit).toHaveBeenCalledWith("tournament:subscription-expired", { slug: "test-cup" });
    expect(clients[0].socket.emit).not.toHaveBeenCalledWith(`tournament:${kind}`, expect.anything());
  });
  it("keeps authorized subscriptions after admission token expiry, as draft rooms do", () => {
    join(createTournamentRoomToken(claims(), secret));
    vi.advanceTimersByTime(60_001);
    guard.pruneTournamentRoom("test-cup");
    expect(clients[0].socket.rooms.has("tournament:test-cup")).toBe(true);
  });
  it("cleans tournament subscriptions on disconnect", () => {
    join(createTournamentRoomToken(claims(), secret));
    clients[0].handlers.get("disconnecting")!();
    expect(clients[0].socket.rooms.has("tournament:test-cup")).toBe(false);
  });
});
