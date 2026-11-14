import Database from "better-sqlite3";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { remoteActionSchema, type RemoteActionProposal } from "@yugidraft/shared/remote";
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
const calibration = (corner: number) => ({ at: 1700000000100, note: "not stored", format: "normal", placed: true, needed: false,
  calibration: { version: 1, layout: 3, corners: [{ x: corner, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }], orientation: { playerSide: "bottom", mirrored: false }, zoneSpacing: 1.1, zones: { M1: { x: 0.2, y: 0.3, w: 0.1, h: 0.2 }, BANISHED: { x: 0.8, y: 0.3, w: 0.1, h: 0.2 }, EVIL: { x: 0, y: 0, w: 1, h: 1 } } } });
const start = (userId: number) => post(userId, "action=start", JSON.stringify({ mime: "video/webm;codecs=vp9", width: 1280, height: 720, fps: 30, clock: { recorderStartDateNow: 1, recorderStartPerfNow: 2, timeOrigin: 3 }, calibration: calibration(0.1) }));

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
  // The calibration changes: a repeat adds nothing, an invalid one is refused and the recording goes on; the clock ping needs a recording of the caller.
  expect((await post(101, `action=calibration&id=${id}`, JSON.stringify(calibration(0.1)))).status).toBe(200);
  expect((await post(101, `action=calibration&id=${id}`, JSON.stringify(calibration(0.2)))).status).toBe(200);
  expect((await post(101, `action=calibration&id=${id}`, JSON.stringify({ calibration: { corners: [{ x: "a" }] } }))).status).toBe(400);
  expect(await (await post(101, `action=clock&id=${id}`, "")).json()).toMatchObject({ ok: true, serverTime: expect.any(Number) });
  expect((await post(102, `action=clock&id=${id}`, "")).status).toBe(404);
  const decision={n:1,decision:{id:'fw-test',at:1700000000500,zone:'M3',quad:[{x:.1,y:.2},{x:.2,y:.2},{x:.2,y:.4},{x:.1,y:.4}],guards:{positiveBack:true,prompt:true,ignore:true,startup:true},evidence:{detector:.824,pixel:'unknown',pixelConfidence:0,sd:42.77,backDistance:null,positive:false,basis:'none',decision:'ignored'},discardedText:'not retained'}};
  expect((await post(101,`action=clock&id=${id}`,JSON.stringify({setCandidates:[decision]}))).status).toBe(200);
  expect((await post(101,`action=clock&id=${id}`,JSON.stringify({setCandidates:[decision]}))).status).toBe(200);

  expect((await post(101, `id=${id}&n=1&offset=-35&rtt=8`, new Uint8Array([4, 5]))).status).toBe(200);
  expect(await (await post(101, `id=${id}&n=1&offset=-1&rtt=1`, new Uint8Array([4, 5]))).json()).toMatchObject({ duplicate: true }); // a repeat adds no clock sample
  expect((await post(102, `id=${id}&n=2`, new Uint8Array([7]))).status).toBe(404); // another player cannot add to it
  expect(await (await post(101, `id=${'0'.repeat(24)}&n=0`, new Uint8Array([1]))).json()).toMatchObject({ code: "UNKNOWN_RECORDING" });
  expect((await post(101, `id=${id}&n=2`, new Uint8Array(8 * 1024 * 1024 + 1))).status).toBe(413);
  const ended = await post(101, `action=end&id=${id}`, JSON.stringify({ reason: "test", backend: "webgpu" }));
  expect(await ended.json()).toMatchObject({ ok: true, chunks: 2, bytes: 5 });

  const files = await readdir(join(dir, slug)), video = files.find(name => name.endsWith(".webm"))!, sidecar = files.find(name => name.endsWith(".json"))!;
  expect(video).toMatch(/^101-0-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z\.webm$/);
  expect([...(await readFile(join(dir, slug, video)))]).toEqual([1, 2, 3, 4, 5]);
  const saved = JSON.parse(await readFile(join(dir, slug, sidecar), "utf8"));
  expect(saved).toMatchObject({ tableSlug: slug, userId: 101, seat: 0, chunks: 2, bytes: 5, endReason: "test", client: { clockOffsetMs: -40, rttMs: 25, videoStartDateNow: 1700000000000, videoStartPerfNow: 1234.5, backend: null }, video: { width: 1280, height: 720 } });
  // One clock sample per chunk, in order, and the calibration at the start and after its one real change (the repeat and the refused ones are not stored).
  expect(saved.client.clockSamples).toMatchObject([{ n: 0, offsetMs: -40, rttMs: 25 }, { n: 1, offsetMs: -35, rttMs: 8 }]);
  expect(saved.calibrations).toHaveLength(2);
  expect(saved.setCandidates).toHaveLength(1);expect(saved.setCandidates[0].decision.evidence).toEqual(decision.decision.evidence);expect(JSON.stringify(saved.setCandidates)).not.toContain('not retained');
  expect(JSON.stringify(saved.calibrations)).not.toContain("not stored"); // only known fields are kept
  expect(saved.calibrations[0]).toMatchObject({ format: "normal", placed: true, needed: false, calibration: { layout: 3, zoneSpacing: 1.1, orientation: { playerSide: "bottom" }, zones: { M1: { x: 0.2, w: 0.1 }, BANISHED: { x: 0.8, w: 0.1 } } } });
  expect(Object.keys(saved.calibrations[0].calibration.zones).sort()).toEqual(["BANISHED", "M1"]); // the unknown id EVIL is dropped
  expect(saved.calibrations[0].calibration.corners[0]).toEqual({ x: 0.1, y: 0.1 });
  expect(saved.calibrations[1].calibration.corners[0]).toEqual({ x: 0.2, y: 0.1 });
  expect((await readFile(join(dir, slug, sidecar))).length).toBeLessThan(8 * 1024); // the sidecar stays small
});

it("accepts the camera timing stamp, and stamps a table action once per idempotency key with only the by it knows", async () => {
  expect(remoteActionSchema.safeParse({ type: "twin.remove", idempotencyKey: "a1", actorSeat: 0, seat: 0, cardRef: "c1", source: "auto",
    cam: { seenAt: 1, namedAt: 2, sentAt: 3, v: "abc123def456", by: "camera", ui: "auto-undo" } }).success).toBe(true);
  const { stampedProposal } = await import("@/lib/remote/field-timing");
  const remove: RemoteActionProposal = { type: "twin.remove", actorSeat: 0, seat: 0, cardRef: "c1" };
  const first = stampedProposal(remove, "key-1");
  expect(first.cam).toMatchObject({ by: "player" });
  await new Promise(resolve => setTimeout(resolve, 5)); // time passes before the retry
  expect(stampedProposal(remove, "key-1").cam).toBe(first.cam); // same sentAt: the server sees the same action, not a 409
  expect(remoteActionSchema.safeParse({ ...first, idempotencyKey: "key-1" }).success).toBe(true);
  expect(stampedProposal({ ...remove, type: "card.identified", source: "voice" } as unknown as RemoteActionProposal, "key-2").cam).toMatchObject({ by: "player", ui: "voice" });
  expect(stampedProposal({ ...remove, source: "auto" }, "key-3").cam).toMatchObject({ by: "camera" }); // a camera reading, not a choice
  expect(stampedProposal(remove, "phone:scan:identify").cam).toMatchObject({ by: "camera" }); // phone scan
  const bot = stampedProposal(remove, "key-5", true).cam; // a test bot seat: nobody to name
  expect(bot).toHaveProperty("sentAt"); expect(bot).not.toHaveProperty("by");
  expect(stampedProposal({ type: "side.timeout", actorSeat: 0 }, "key-6")).not.toHaveProperty("cam"); // timers are no person's choice
  const watcher: RemoteActionProposal = { ...remove, cam: { sentAt: 9, by: "camera" } };
  expect(stampedProposal(watcher, "key-7").cam).toEqual({ sentAt: 9, by: "camera" }); // the watcher's own stamp is kept
});
