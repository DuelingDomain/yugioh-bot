import Database from "better-sqlite3";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { remoteActionSchema } from "@yugidraft/shared/remote";
import { createRemoteDuelService } from "@yugidraft/shared/services";
import { seedIdentity } from "../../shared/tests/helpers/identity";

const state = vi.hoisted(() => ({ db: null as Database.Database | null, auth: vi.fn() }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session"); return sessionFixture(state.auth);
});
vi.mock("@/lib/db", () => ({ getDb: () => state.db!, resolveDbPath: () => "/unused/bot.sqlite" }));
let dir: string, slug: string;
beforeEach(async () => {
  vi.resetModules(); state.auth.mockReset();
  dir = await mkdtemp(join(tmpdir(), "remote-rec-"));
  state.db = new Database(":memory:"); migrate(state.db);
  for (const userId of [101, 102, 103]) seedIdentity(state.db, { guildId: "rec-test", userId, playerId: userId - 100, name: `Player ${userId}` });
  vi.stubEnv("DISCORD_GUILD_ID", "rec-test"); vi.stubEnv("REMOTE_DUELS", "1"); vi.stubEnv("REMOTE_DUELS_USERS", "*");
  vi.stubEnv("REMOTE_RECORDINGS_DIR", dir); vi.stubEnv("REMOTE_RECORDINGS_MIN_FREE_BYTES", "0");
  const remote = createRemoteDuelService(state.db);
  slug = remote.create({ guildId: "rec-test", userId: 101, displayName: "Player 101", gameId: "ygo", seatCount: 2, bestOf: 1, visibility: "private" }).slug;
  remote.join(slug, "rec-test", 102, "Player 102");
});
afterEach(async () => { state.db?.close(); vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });
async function post(userId: number, query: string, body: BodyInit) {
  state.auth.mockResolvedValue({ user: { id: String(userId), name: `Player ${userId}` } });
  const { POST } = await import("../app/api/remote/[slug]/recording/route");
  const isJson = typeof body === "string";
  return POST(new Request(`http://localhost/api/remote/${slug}/recording?${query}`, { method: "POST", body,
    headers: { "content-type": isJson ? "application/json" : "application/octet-stream" } }), { params: Promise.resolve({ slug }) });
}
const start = (userId: number) => post(userId, "action=start", JSON.stringify({ mime: "video/webm;codecs=vp9", width: 1280, height: 720, fps: 30, clock: { recorderStartDateNow: 1, recorderStartPerfNow: 2, timeOrigin: 3 } }));

it("records a seated allowlisted player's camera and refuses everybody else", async () => {
  // Off: variable unset.
  expect((await start(101)).status).toBe(404);
  // `*` does not turn it on, and a seated player or a stranger who is not listed is refused.
  vi.stubEnv("REMOTE_RECORD_USERS", "*"); expect((await start(101)).status).toBe(404);
  vi.stubEnv("REMOTE_RECORD_USERS", "101,103");
  expect((await start(102)).status).toBe(404);
  expect((await start(103)).status).toBe(404); // listed, but not at this table
  expect(await readdir(dir)).toEqual([]);

  const opened = await start(101); expect(opened.status).toBe(200);
  const { id } = await opened.json(); expect(id).toMatch(/^[0-9a-f]{24}$/);
  expect((await post(101, `id=${id}&n=1`, new Uint8Array([9]))).status).toBe(409); // chunk 0 holds the header
  expect((await post(101, `id=${id}&n=0&offset=-40&rtt=25&startDateNow=1700000000000&startPerfNow=1234.5`, new Uint8Array([1, 2, 3]))).status).toBe(200);
  expect((await post(101, `id=${id}&n=1`, new Uint8Array([4, 5]))).status).toBe(200);
  expect(await (await post(101, `id=${id}&n=1`, new Uint8Array([4, 5]))).json()).toMatchObject({ duplicate: true });
  expect((await post(102, `id=${id}&n=2`, new Uint8Array([7]))).status).toBe(404); // another player cannot add to it
  expect(await (await post(101, `id=${'0'.repeat(24)}&n=0`, new Uint8Array([1]))).json()).toMatchObject({ code: "UNKNOWN_RECORDING" });
  expect((await post(101, `id=${id}&n=2`, new Uint8Array(8 * 1024 * 1024 + 1))).status).toBe(413);
  const ended = await post(101, `action=end&id=${id}`, JSON.stringify({ reason: "test", backend: "webgpu" }));
  expect(await ended.json()).toMatchObject({ ok: true, chunks: 2, bytes: 5 });

  const files = await readdir(join(dir, slug)), video = files.find(name => name.endsWith(".webm"))!, sidecar = files.find(name => name.endsWith(".json"))!;
  expect(video).toMatch(/^101-0-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z\.webm$/);
  expect([...(await readFile(join(dir, slug, video)))]).toEqual([1, 2, 3, 4, 5]);
  expect(JSON.parse(await readFile(join(dir, slug, sidecar), "utf8"))).toMatchObject({ tableSlug: slug, userId: 101, seat: 0, chunks: 2, bytes: 5, endReason: "test", client: { clockOffsetMs: -40, rttMs: 25, videoStartDateNow: 1700000000000, videoStartPerfNow: 1234.5, backend: null }, video: { width: 1280, height: 720 } });
});

it("accepts the camera timing stamp and the auto removal source on actions", () => {
  expect(remoteActionSchema.safeParse({ type: "twin.remove", idempotencyKey: "a1", actorSeat: 0, seat: 0, cardRef: "c1", source: "auto",
    cam: { seenAt: 1, namedAt: 2, sentAt: 3, v: "abc123def456" } }).success).toBe(true);
});
