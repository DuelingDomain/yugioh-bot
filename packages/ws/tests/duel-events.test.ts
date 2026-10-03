import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { io as ClientIO, type Socket as ClientSocket } from "socket.io-client";
import { createDraftRoomToken, createDuelConnectionToken, type DuelConnectionTokenClaims } from "@yugidraft/shared/ws";
import { DraftRoomManager } from "../src/rooms.js";
import {
  registerEventHandlers,
  type ClientToServerEvents,
  type DuelJoinAck,
  type ServerToClientEvents,
} from "../src/events.js";
import { registerDuelEventHandlers } from "../src/duel-events.js";

const SECRET = "duel-ws-secret";

type TestServer = SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;
type Presence = { slug: string; onlineSeats: number[]; spectatorCount: number };

type Setup = {
  io: TestServer;
  httpServer: HttpServer;
  url: string;
};

function mint(overrides: Partial<DuelConnectionTokenClaims> = {}) {
  const claims: DuelConnectionTokenClaims = {
    slug: "alpha",
    guildId: "g1",
    playerId: 4242,
    seat: 0,
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
  return { claims, token: createDuelConnectionToken(claims, SECRET) };
}

async function setupTestServer(): Promise<Setup> {
  const httpServer = createServer();
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer);
  registerEventHandlers(io, new DraftRoomManager(), { secret: SECRET, canReadDraft: () => true });
  registerDuelEventHandlers(io, { secret: SECRET });
  return new Promise<Setup>((resolve) => {
    httpServer.listen(0, () => {
      const address = httpServer.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ io, httpServer, url: `http://127.0.0.1:${port}` });
    });
  });
}

function createClient(url: string): TestClient {
  return ClientIO(url, { transports: ["websocket"] });
}

function waitForConnect(socket: TestClient): Promise<void> {
  return new Promise<void>((resolve) => socket.once("connect", resolve));
}

function emitDuelJoin(client: TestClient, token: string): Promise<DuelJoinAck> {
  return new Promise<DuelJoinAck>((resolve) => client.emit("duel:join", { token }, resolve));
}

function emitDraftJoin(client: TestClient, slug: string): Promise<unknown> {
  const userId = "user-1";
  const token = createDraftRoomToken({ slug, guildId: "g1", userId, expiresAt: Date.now() + 60_000 }, SECRET);
  return new Promise<unknown>((resolve) => client.emit("draft:join", { slug, userId, token }, resolve));
}

function oncePresence(client: TestClient, match: (payload: Presence) => boolean): Promise<Presence> {
  return new Promise<Presence>((resolve) => {
    const onPresence = (payload: Presence) => {
      if (!match(payload)) return;
      client.off("duel:presence", onPresence);
      resolve(payload);
    };
    client.on("duel:presence", onPresence);
  });
}

function roomsFor(io: TestServer, clientId: string | undefined): string[] {
  if (!clientId) return [];
  const socket = io.sockets.sockets.get(clientId);
  return socket ? [...socket.rooms] : [];
}

function duelRooms(io: TestServer, clientId: string | undefined): string[] {
  return roomsFor(io, clientId).filter((room) => room.startsWith("duel:"));
}

describe("registerDuelEventHandlers", () => {
  let server: Setup;
  const clients: TestClient[] = [];

  beforeEach(async () => {
    server = await setupTestServer();
    clients.length = 0;
  });

  afterEach(() => {
    for (const client of clients) {
      if (client.connected) client.disconnect();
    }
    server.io.close();
    server.httpServer.close();
  });

  function addClient(): TestClient {
    const client = createClient(server.url);
    clients.push(client);
    return client;
  }

  it("subscribes a valid token to the token's room and reports presence", async () => {
    const client = addClient();
    await waitForConnect(client);
    const ack = await emitDuelJoin(client, mint().token);
    expect(ack).toEqual({ ok: true, onlineSeats: [0], spectatorCount: 0 });
    expect(JSON.stringify(ack)).not.toContain("4242");
    expect(JSON.stringify(ack)).not.toContain("playerId");
    expect(duelRooms(server.io, client.id)).toEqual(["duel:g1:alpha"]);
    expect(duelRooms(server.io, client.id)).not.toContain("duel:g1:beta");
  });

  it("does not subscribe expired, forged, or empty tokens", async () => {
    const client = addClient();
    await waitForConnect(client);
    const expired = mint({ expiresAt: Date.now() - 1 });
    const forged = mint();
    const [payload, signature] = forged.token.split(".");
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as DuelConnectionTokenClaims;
    parsed.slug = "beta";
    const tampered = `${Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url")}.${signature}`;

    expect((await emitDuelJoin(client, expired.token)).ok).toBe(false);
    expect((await emitDuelJoin(client, tampered)).ok).toBe(false);
    expect((await emitDuelJoin(client, "")).ok).toBe(false);
    expect(duelRooms(server.io, client.id)).toEqual([]);
  });

  it("keeps an existing subscription when a later join token is invalid", async () => {
    const client = addClient();
    await waitForConnect(client);
    expect((await emitDuelJoin(client, mint().token)).ok).toBe(true);
    expect((await emitDuelJoin(client, "not-a-token")).ok).toBe(false);
    expect(duelRooms(server.io, client.id)).toEqual(["duel:g1:alpha"]);
  });

  it("dedupes seated tabs and unique spectators in presence", async () => {
    const seatedA = addClient();
    const seatedB = addClient();
    const spectatorA = addClient();
    const spectatorB = addClient();
    const otherSpectator = addClient();
    await Promise.all([
      waitForConnect(seatedA),
      waitForConnect(seatedB),
      waitForConnect(spectatorA),
      waitForConnect(spectatorB),
      waitForConnect(otherSpectator),
    ]);

    const seatedToken = mint({ playerId: 71, seat: 0 }).token;
    const spectatorToken = mint({ playerId: 82, seat: null }).token;
    const otherToken = mint({ playerId: 93, seat: null }).token;

    await emitDuelJoin(seatedA, seatedToken);
    await emitDuelJoin(seatedB, seatedToken);
    await emitDuelJoin(spectatorA, spectatorToken);
    await emitDuelJoin(spectatorB, spectatorToken);
    const ack = await emitDuelJoin(otherSpectator, otherToken);

    expect(ack).toEqual({ ok: true, onlineSeats: [0], spectatorCount: 2 });
    expect(JSON.stringify(ack)).not.toContain("71");
    expect(JSON.stringify(ack)).not.toContain("82");
    expect(JSON.stringify(ack)).not.toContain("93");
    expect(JSON.stringify(ack)).not.toContain("playerId");
  });

  it("replaces spectator occupancy when the same socket rejoins as a seat", async () => {
    const client = addClient();
    await waitForConnect(client);
    const spectatorAck = await emitDuelJoin(client, mint({ playerId: 11, seat: null }).token);
    expect(spectatorAck).toEqual({ ok: true, onlineSeats: [], spectatorCount: 1 });
    const seatedAck = await emitDuelJoin(client, mint({ playerId: 11, seat: 0 }).token);
    expect(seatedAck).toEqual({ ok: true, onlineSeats: [0], spectatorCount: 0 });
  });

  it("ignores a mismatched leave and removes occupancy on a matching leave", async () => {
    const staying = addClient();
    const leaving = addClient();
    await Promise.all([waitForConnect(staying), waitForConnect(leaving)]);
    await emitDuelJoin(staying, mint({ playerId: 21, seat: 0 }).token);
    const sawBoth = oncePresence(
      staying,
      (payload) => payload.onlineSeats.includes(0) && payload.onlineSeats.includes(1),
    );
    await emitDuelJoin(leaving, mint({ playerId: 22, seat: 1 }).token);
    await sawBoth;

    leaving.emit("duel:leave", { slug: "beta", guildId: "g1" });
    expect((await emitDuelJoin(leaving, "bad")).ok).toBe(false);
    expect(duelRooms(server.io, leaving.id)).toEqual(["duel:g1:alpha"]);

    const afterLeave = oncePresence(
      staying,
      (payload) => payload.onlineSeats.length === 1 && payload.onlineSeats[0] === 0,
    );
    leaving.emit("duel:leave", { slug: "alpha", guildId: "g1" });
    expect(await afterLeave).toEqual({ slug: "alpha", onlineSeats: [0], spectatorCount: 0 });
    expect(duelRooms(server.io, leaving.id)).toEqual([]);
  });

  it("removes occupancy when a socket disconnects", async () => {
    const staying = addClient();
    const leaving = addClient();
    await Promise.all([waitForConnect(staying), waitForConnect(leaving)]);
    await emitDuelJoin(staying, mint({ playerId: 21, seat: 0 }).token);
    const sawBoth = oncePresence(
      staying,
      (payload) => payload.onlineSeats.includes(0) && payload.onlineSeats.includes(1),
    );
    await emitDuelJoin(leaving, mint({ playerId: 22, seat: 1 }).token);
    await sawBoth;

    const afterDisconnect = oncePresence(
      staying,
      (payload) => payload.onlineSeats.length === 1 && payload.onlineSeats[0] === 0,
    );
    leaving.disconnect();
    expect(await afterDisconnect).toEqual({ slug: "alpha", onlineSeats: [0], spectatorCount: 0 });
  });

  it("expires a live subscription and notifies only that socket", async () => {
    const expiring = addClient();
    const staying = addClient();
    await Promise.all([waitForConnect(expiring), waitForConnect(staying)]);
    await emitDuelJoin(staying, mint({ playerId: 31, seat: 1 }).token);

    const expired = new Promise<{ slug: string }>((resolve) => expiring.once("duel:subscription-expired", resolve));

    let sawBothSeats = false;
    const afterExpiry = oncePresence(staying, (payload) => {
      if (payload.onlineSeats.includes(0) && payload.onlineSeats.includes(1)) sawBothSeats = true;
      return sawBothSeats && payload.onlineSeats.length === 1 && payload.onlineSeats[0] === 1;
    });

    // Real clock: expiry is Date.now() + setTimeout; fake timers break Socket.IO heartbeats.
    const joinAck = await emitDuelJoin(
      expiring,
      mint({ playerId: 32, seat: 0, expiresAt: Date.now() + 250 }).token,
    );
    expect(joinAck.ok).toBe(true);
    expect(await expired).toEqual({ slug: "alpha" });
    expect(duelRooms(server.io, expiring.id)).toEqual([]);
    expect(await afterExpiry).toEqual({ slug: "alpha", onlineSeats: [1], spectatorCount: 0 });
    expect(duelRooms(server.io, staying.id)).toEqual(["duel:g1:alpha"]);
  });

  it("leaves draft join working when duel handlers are registered", async () => {
    const client = addClient();
    await waitForConnect(client);
    const draftAck = await emitDraftJoin(client, "draft-1");
    expect(draftAck).toBeUndefined();
    expect(roomsFor(server.io, client.id)).toContain("draft:draft-1");
    const duelAck = await emitDuelJoin(client, mint().token);
    expect(duelAck.ok).toBe(true);
  });

  it("draft:join with a reserved-looking slug cannot join a duel room or receive protected events", async () => {
    const attacker = addClient();
    const seated = addClient();
    await Promise.all([waitForConnect(attacker), waitForConnect(seated)]);

    expect(await emitDraftJoin(attacker, "duel:g1:alpha")).toBeUndefined();
    expect(duelRooms(server.io, attacker.id)).toEqual([]);
    expect(roomsFor(server.io, attacker.id)).toContain("draft:duel:g1:alpha");
    expect(roomsFor(server.io, attacker.id)).not.toContain("duel:g1:alpha");

    let leaked = false;
    attacker.on("duel:presence", () => {
      leaked = true;
    });
    attacker.on("duel:changed", () => {
      leaked = true;
    });

    const seatedSawChange = new Promise<{ slug: string }>((resolve) => seated.once("duel:changed", resolve));

    expect((await emitDuelJoin(seated, mint().token)).ok).toBe(true);
    server.io.to("duel:g1:alpha").emit("duel:changed", { slug: "alpha" });
    expect(await seatedSawChange).toEqual({ slug: "alpha" });
    expect(leaked).toBe(false);
  });
});
