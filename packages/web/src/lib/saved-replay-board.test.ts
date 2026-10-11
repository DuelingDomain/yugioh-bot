import Database from "better-sqlite3";
import { createDuelService } from "@yugidraft/shared/services";
import { migrate } from "@yugidraft/shared/db";
import { NextResponse } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import { seedIdentity } from "../../../shared/tests/helpers/identity";
import { ReplayWorker, replaySource } from "../../../duel-server/tests/support/replay-fixtures";
import { savedReplayBoardResponse } from "./saved-replay-board";

const databases: Database.Database[] = [];
const routeState = vi.hoisted(() => ({ db: null as Database.Database | null, auth: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => routeState.db! }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("../../tests/fixtures/session"); return sessionFixture(routeState.auth);
});
afterEach(() => {
  databases.splice(0).forEach(db => db.close()); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});
async function fixture() {
  const db = new Database(":memory:"); databases.push(db); migrate(db);
  seedIdentity(db, { guildId: "test-guild", playerId: 1, userId: 101 });
  seedIdentity(db, { guildId: "test-guild", playerId: 2, userId: 102 });
  const duels = createDuelService(db);
  const session = duels.create({ guildId: "test-guild", organizerPlayerId: 1, name: "Saved", mode: "normal" });
  duels.takeSeat(session.slug, session.guildId, 2, 1);
  const worker = new ReplayWorker(), source = replaySource();
  await worker.create({ mode: "normal", decks: source.decks, seed: source.seed, dataDirectory: "/fixture" });
  const boards = { public: await worker.view(null), seats: [await worker.view(0), await worker.view(1)] };
  db.prepare("update duels set status='interrupted', snapshot_public_json=?, snapshot_seats_json=? where id=?")
    .run(JSON.stringify(boards.public), JSON.stringify(boards.seats), session.id);
  return { db, session: duels.get(session.slug, session.guildId), playerId: 1, version: 2 as const };
}
const tooLarge = () => NextResponse.json({ code: "REPLAY_TOO_LARGE", error: "Replay exceeds the 16 MiB limit." }, { status: 413 });

it("lets the existing viewer show the final board and size notice without a fork cursor", async () => {
  const input = await fixture();
  const response = await savedReplayBoardResponse(tooLarge(), { ...input, owner: false, visibility: "public" });
  expect(response?.status).toBe(200); expect(response?.headers.get("cache-control")).toBe("private, no-store");
  const replay = await response!.json();
  expect(replay.frames).toHaveLength(1);
  expect(replay.frames[0]).toMatchObject({ kind: "result", cursor: null });
  expect(replay.frames[0].view.log.at(-1).text).toContain("16 MiB limit");
  expect(replay.frames[0].view.log.at(-1).text).toContain("Showing the saved final board");
  expect(replay.frames[0].view.seats.every((seat: any) => seat.hand[0].code === undefined)).toBe(true);
});
it("preserves own-seat privacy and only reveals all hands for an authorized owner projection", async () => {
  const input = await fixture();
  const mine = await savedReplayBoardResponse(tooLarge(), { ...input, owner: false });
  expect((await mine!.json()).frames[0].view.seats.map((seat: any) => seat.hand[0].code)).toEqual([900, undefined]);
  const owner = await savedReplayBoardResponse(tooLarge(), { ...input, owner: true, seat: 1, reveal: true });
  const replay = await owner!.json();
  expect(replay.dataSeat).toBe(1); expect(replay.capabilities.canFork).toBe(false);
  expect(replay.frames[0].view.seats.map((seat: any) => seat.hand[0].code)).toEqual([900, 901]);
});
it("keeps the host error when no saved board exists or the error is transient", async () => {
  const input = await fixture();
  const transient = NextResponse.json({ code: "ENGINE_BUSY" }, { status: 503 });
  expect(await savedReplayBoardResponse(transient, { ...input, owner: false })).toBeNull();
  input.db.prepare("update duels set snapshot_public_json=null, snapshot_seats_json=null where id=?").run(input.session.id);
  expect(await savedReplayBoardResponse(tooLarge(), { ...input, owner: false })).toBeNull();
});

async function routeFixture() {
  const input = await fixture(); routeState.db = input.db;
  routeState.auth.mockResolvedValue({ user: { id: "101", name: "Owner" } });
  routeState.fetch.mockReset().mockImplementation(async () => tooLarge());
  vi.stubEnv("DISCORD_GUILD_ID", "test-guild"); vi.stubEnv("OWNER_USER_IDS", "101");
  vi.stubEnv("DUEL_INTERNAL_URL", "http://duel.test"); vi.stubEnv("DUEL_INTERNAL_SECRET", "size-test-secret");
  vi.stubGlobal("fetch", routeState.fetch);
  return input;
}
async function routeGet(owner: boolean, slug: string, query: string) {
  const route = owner ? await import("../../app/api/admin/duels/[slug]/replay/route")
    : await import("../../app/api/duels/[slug]/replay/route");
  return route.GET(new Request(`http://localhost/replay?${query}`), { params: Promise.resolve({ slug }) });
}
it.each([false, true])("opens the saved result through the actual replay route (owner=%s)", async owner => {
  const input = await routeFixture();
  const response = await routeGet(owner, input.session.slug, owner ? "version=2&seat=1&reveal=1" : "version=2&visibility=public");
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.replayError.code).toBe("REPLAY_TOO_LARGE");
  expect(result.frames).toHaveLength(1); expect(result.frames[0].cursor).toBeNull();
  expect(result.frames[0].view.seats.map((seat: any) => seat.hand[0].code))
    .toEqual(owner ? [900, 901] : [undefined, undefined]);
});
it("rechecks the owner allowlist before returning a saved private board", async () => {
  const input = await routeFixture();
  routeState.fetch.mockImplementation(async () => { vi.stubEnv("OWNER_USER_IDS", ""); return tooLarge(); });
  const response = await routeGet(true, input.session.slug, "seat=1&reveal=1");
  expect(response.status).toBe(404); expect(await response.json()).toMatchObject({ code: "ACCESS_DENIED" });
});
it("rechecks normal source access before returning the saved board", async () => {
  const input = await routeFixture();
  seedIdentity(input.db, { guildId: "test-guild", playerId: 3, userId: 201 });
  routeState.auth.mockResolvedValue({ user: { id: "201", name: "Spectator" } });
  routeState.fetch.mockImplementation(async () => {
    input.db.prepare("update duels set settings_json=json_set(settings_json,'$.visibility','private') where id=?").run(input.session.id);
    return tooLarge();
  });
  const response = await routeGet(false, input.session.slug, "version=2&visibility=public");
  expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ code: "ACCESS_DENIED" });
});
it.each([false, true])("opens another player's private final board as admin through the replay route (owner=%s)", async owner => {
  const input = await routeFixture();
  seedIdentity(input.db, { guildId: "test-guild", playerId: 3, userId: 103 });
  vi.stubEnv("OWNER_USER_IDS", "103");
  routeState.auth.mockResolvedValue({ user: { id: "103", name: "Admin" } });
  input.db.prepare("update duels set settings_json=json_set(settings_json,'$.visibility','private') where id=?").run(input.session.id);
  const response = await routeGet(owner, input.session.slug, "version=2&visibility=public");
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.mySeat).toBeNull(); expect(body.dataSeat).toBeNull();
  expect(body.frames[0].view.seats.map((seat: any) => seat.hand[0].code)).toEqual([undefined, undefined]);
  expect(input.db.prepare("select * from duel_invite_grants").all()).toEqual([]);
});
it.each(["completed", "interrupted", "cancelled"])("opens another player's private %s saved board through the duel route as admin", async status => {
  const input = await routeFixture();
  seedIdentity(input.db, { guildId: "test-guild", playerId: 3, userId: 103 });
  vi.stubEnv("OWNER_USER_IDS", "103");
  routeState.auth.mockResolvedValue({ user: { id: "103", name: "Admin" } });
  input.db.prepare("update duels set status=?,settings_json=json_set(settings_json,'$.visibility','private') where id=?").run(status, input.session.id);
  const { GET } = await import("../../app/api/duels/[slug]/route");
  const response = await GET(new Request("http://localhost/duel"), { params: Promise.resolve({ slug: input.session.slug }) });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ role: "spectator", mySeat: null, myDeck: null });
  expect(body.engine.seats.map((seat: any) => seat.hand[0].code)).toEqual([undefined, undefined]);
  expect(routeState.fetch).not.toHaveBeenCalled();
});
