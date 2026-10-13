import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./fixtures/identity";

const mocks = vi.hoisted(() => ({ requireDuelActor: vi.fn(), callDuelHost: vi.fn(), notifyDuelChange: vi.fn() }));
vi.mock("@/lib/duel-host", async original => ({ ...await original<object>(), ...mocks }));
vi.mock("@/lib/notify-duel", () => mocks);
vi.mock("@/lib/db", () => ({ getDb: () => db }));
import { GET, POST } from "../app/api/duels/route";
import { POST as cancelWaiting } from "../app/api/duels/[slug]/cancel-waiting/route";
let db: Database.Database;
let duels: ReturnType<typeof createDuelService>;
let host: number;
let guest: number;
beforeEach(() => {
  vi.stubEnv("MULTIPLAYER_TABLES", "1");
  db = new Database(":memory:"); migrate(db); seedFixtureUsers(db, ["host", "guest"]);
  const insert = db.prepare("insert into players(guild_id,user_id,discord_user_id,display_name) values('g',?,?,?)");
  host = Number(insert.run(fixtureUserId("host"), fixtureDiscordId("host"), "Host").lastInsertRowid);
  guest = Number(insert.run(fixtureUserId("guest"), fixtureDiscordId("guest"), "Guest").lastInsertRowid);
  duels = createDuelService(db);
  mocks.requireDuelActor.mockReset().mockResolvedValue({ ok: true, guildId: "g", playerId: host, duels });
  mocks.callDuelHost.mockReset().mockResolvedValue({ ok: true, data: { multiplayerTables: true, multiCoreReady: true } });
  mocks.notifyDuelChange.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });
const request = (key?: string, extra = {}) => new NextRequest("http://localhost/api/duels", {
  method: "POST", headers: key ? { "Idempotency-Key": key } : {},
  body: JSON.stringify({ name: "New table", mode: "normal", ...extra }),
});

it("invalidates the replaced table and its replacement after commit", async () => {
  const old = duels.create({ guildId: "g", organizerPlayerId: host, name: "Old", mode: "normal" });
  mocks.notifyDuelChange.mockImplementation(async () => expect(duels.get(old.slug, "g").status).toBe("cancelled"));
  const response = await POST(request());
  expect(response.status).toBe(201);
  const { session } = await response.json();
  expect(mocks.notifyDuelChange).toHaveBeenCalledWith(old.slug, "g");
  expect(mocks.notifyDuelChange).toHaveBeenCalledWith(session.slug, "g");
});

it("returns one table for simultaneous repeated POSTs", async () => {
  const responses = await Promise.all([POST(request("double-click-123")), POST(request("double-click-123"))]);
  expect(responses.map(response => response.status)).toEqual([201, 201]);
  const bodies = await Promise.all(responses.map(response => response.json()));
  expect(bodies[0].session.slug).toBe(bodies[1].session.slug);
  expect(db.prepare("select count(*) as n from duels").get()).toEqual({ n: 1 });
});

it("does not cancel a table with another human or send invalidations on rejection", async () => {
  const old = duels.create({ guildId: "g", organizerPlayerId: host, name: "Old", mode: "normal" });
  duels.takeSeat(old.slug, "g", guest);
  const response = await POST(request());
  expect(response.status).toBe(409);
  expect((await response.json()).error).toMatch(/another player|already started/i);
  expect(duels.get(old.slug, "g").status).toBe("lobby");
  expect(mocks.notifyDuelChange).not.toHaveBeenCalled();
});

it("rejects a request key reused for different settings", async () => {
  expect((await POST(request("same-key-123"))).status).toBe(201);
  expect((await POST(request("same-key-123", { name: "Changed" }))).status).toBe(409);
  expect(db.prepare("select count(*) as n from duels").get()).toEqual({ n: 1 });
});

it("returns the host's waiting table without caching it", async () => {
  const old = duels.create({ guildId: "g", organizerPlayerId: host, name: "Old", mode: "normal" });
  const response = await GET(new NextRequest("http://localhost/api/duels?hostedWaiting=1"));
  expect(await response.json()).toMatchObject({ table: { slug: old.slug, name: "Old" } });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it("cancels through the notice action and invalidates the table", async () => {
  const old = duels.create({ guildId: "g", organizerPlayerId: host, name: "Old", mode: "normal" });
  const response = await cancelWaiting(new Request("http://localhost/cancel-waiting", { method: "POST" }), { params: Promise.resolve({ slug: old.slug }) });
  expect(response.status).toBe(200);
  expect(duels.get(old.slug, "g").status).toBe("cancelled");
  expect(mocks.notifyDuelChange).toHaveBeenCalledWith(old.slug, "g");
});

it("rejects notice cancellation when a human joins before the POST", async () => {
  const old = duels.create({ guildId: "g", organizerPlayerId: host, name: "Old", mode: "normal" });
  duels.takeSeat(old.slug, "g", guest);
  const response = await cancelWaiting(new Request("http://localhost/cancel-waiting", { method: "POST" }), { params: Promise.resolve({ slug: old.slug }) });
  expect(response.status).toBe(409);
  expect(duels.get(old.slug, "g").status).toBe("lobby");
  expect(mocks.notifyDuelChange).not.toHaveBeenCalled();
});

it("retries every invalidation even when the first notification fails", async () => {
  const old = duels.create({ guildId: "g", organizerPlayerId: host, name: "Old", mode: "normal" });
  mocks.notifyDuelChange.mockRejectedValue(new Error("offline"));
  const response = await POST(request("notify-retry"));
  expect(response.status).toBe(201);
  const { session } = await response.json();
  expect(mocks.notifyDuelChange.mock.calls).toEqual([[old.slug, "g"], [session.slug, "g"]]);
  mocks.notifyDuelChange.mockClear();
  expect((await POST(request("notify-retry"))).status).toBe(201);
  expect(mocks.notifyDuelChange.mock.calls).toEqual([[old.slug, "g"], [session.slug, "g"]]);
});

it("replaces an empty table with a challenge and deduplicates the challenge request", async () => {
  const old = duels.create({ guildId: "g", organizerPlayerId: host, name: "Old", mode: "normal" });
  const extra = { opponentPlayerId: guest, bestOf: 3 };
  const first = await POST(request("challenge-key", extra));
  const second = await POST(request("challenge-key", extra));
  expect(first.status).toBe(201); expect(second.status).toBe(201);
  expect((await first.json()).session.slug).toBe((await second.json()).session.slug);
  expect(duels.get(old.slug, "g").status).toBe("cancelled");
  expect(db.prepare("select count(*) as n from duel_series").get()).toEqual({ n: 1 });
});


it("returns 409 for a retry whose original table was replaced, then accepts a fresh key", async () => {
  const first = await POST(request("first-tab-key"));
  const { session: old } = await first.json();
  expect((await POST(request("second-tab-key"))).status).toBe(201);
  expect(duels.get(old.slug, "g")).toMatchObject({ status: "cancelled", resultReason: "This table was replaced by a new table from its host." });
  const retry = await POST(request("first-tab-key"));
  expect(retry.status).toBe(409);
  expect((await retry.json()).error).toMatch(/closed table/);
  expect((await POST(request("fresh-tab-key"))).status).toBe(201);
});

it("keeps a pending challenge when creating an open table and allows explicit notice cancellation", async () => {
  const first = await POST(request("pending-challenge", { opponentPlayerId: guest, bestOf: 3 }));
  const { session: challenge } = await first.json();
  const notice = await GET(new NextRequest("http://localhost/api/duels?hostedWaiting=1"));
  expect(await notice.json()).toMatchObject({ table: { slug: challenge.slug, reason: "challenge", canReplace: false, canCancel: true, opponentName: "Guest" } });
  expect((await POST(request("open-after-challenge"))).status).toBe(201);
  expect(duels.get(challenge.slug, "g").status).toBe("lobby");
  const response = await cancelWaiting(new Request("http://localhost/cancel-waiting", { method: "POST" }), { params: Promise.resolve({ slug: challenge.slug }) });
  expect(response.status).toBe(200);
  expect(duels.room(challenge.slug, "g", host).series?.status).toBe("cancelled");
});
