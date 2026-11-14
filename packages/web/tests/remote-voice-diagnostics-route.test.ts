import Database from "better-sqlite3";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, utimes, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createRemoteDuelService } from "@yugidraft/shared/services";
import { seedIdentity } from "../../shared/tests/helpers/identity";
import { describeEvent } from "@/components/remote/ui/describe";

const state = vi.hoisted(() => ({ db: null as Database.Database | null, auth: vi.fn() }));
vi.mock("@/lib/session-identity", async () => { const { sessionFixture } = await import("./fixtures/session"); return sessionFixture(state.auth); });
vi.mock("@/lib/db", () => ({ getDb: () => state.db!, resolveDbPath: () => "/unused/bot.sqlite" }));
let dir: string, slug: string;
beforeEach(async () => {
  vi.resetModules(); state.auth.mockReset();
  dir = await mkdtemp(join(tmpdir(), "remote-voice-"));
  state.db = new Database(":memory:"); migrate(state.db);
  for (const id of [101, 102, 103]) seedIdentity(state.db, { guildId: "voice-test", userId: id, playerId: id - 100, name: `Player ${id}` });
  vi.stubEnv("DISCORD_GUILD_ID", "voice-test"); vi.stubEnv("REMOTE_DUELS", "1"); vi.stubEnv("REMOTE_DUELS_USERS", "*");
  vi.stubEnv("REMOTE_VOICE_USERS", "101,103"); vi.stubEnv("REMOTE_VOICE_DIAGNOSTICS_USERS", "101,103");
  vi.stubEnv("REMOTE_VOICE_DIAGNOSTICS_DIR", dir); vi.stubEnv("SENTRY_RELEASE", "voice-test-build");
  vi.stubEnv("WS_INTERNAL_URL", "");
  const remote = createRemoteDuelService(state.db, { openingRoll: false });
  slug = remote.create({ guildId: "voice-test", userId: 101, displayName: "Player 101", gameId: "ygo", seatCount: 2, bestOf: 1, visibility: "private" }).slug;
  remote.join(slug, "voice-test", 102, "Player 102");
}, 60_000);
afterEach(async () => { state.db?.close(); vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });
const perf = { kind: "perf", at: 1000, method: "kws", windowMs: 5000, stage1BusyMs: 25, stage2BusyMs: 0, idle: true };
const body = () => JSON.stringify({ records: [perf] });
async function post(userId: number | null, data = body(), headers: Record<string, string> = {}) {
  state.auth.mockResolvedValue(userId ? { user: { id: String(userId), name: `Player ${userId}` } } : null);
  const { POST } = await import("../app/api/remote/[slug]/voice-diagnostics/route");
  return POST(new Request(`http://localhost/api/remote/${slug}/voice-diagnostics`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: data }), { params: Promise.resolve({ slug }) });
}
it.each([undefined, "", "*", "102", "0101", "101x"])("voice allowlists stay closed for %s and diagnostics cannot grant voice", async value => {
  const { remoteVoiceEnabledFor, remoteVoiceDiagnosticsEnabledFor } = await import("@/lib/remote-duels");
  if (value === undefined) delete process.env.REMOTE_VOICE_USERS; else vi.stubEnv("REMOTE_VOICE_USERS", value);
  expect(remoteVoiceEnabledFor(101)).toBe(false); expect(remoteVoiceDiagnosticsEnabledFor(101)).toBe(false);
  expect((await post(101)).status).toBe(404);
});
it("switches are read at request time, require Remote Duels, and deliver explicit false capabilities to other seats", async () => {
  const access = await import("@/lib/remote-duels");
  vi.stubEnv("REMOTE_VOICE_USERS", " 101 , * ");
  expect(access.remoteVoiceEnabledFor(101)).toBe(true); expect(access.remoteVoiceEnabledFor(102)).toBe(false);
  for (const id of [NaN, -1, 0, 1.5]) expect(access.remoteVoiceEnabledFor(id)).toBe(false);
  vi.stubEnv("REMOTE_VOICE_DIAGNOSTICS_USERS", "*"); expect(access.remoteVoiceDiagnosticsEnabledFor(101)).toBe(false);
  vi.stubEnv("REMOTE_VOICE_DIAGNOSTICS_USERS", "101"); expect(access.remoteVoiceDiagnosticsEnabledFor(101)).toBe(true);
  const { GET } = await import("../app/api/remote/[slug]/route");
  const room = async (userId: number) => { state.auth.mockResolvedValue({ user: { id: String(userId) } }); return (await GET(new Request("http://localhost/"), { params: Promise.resolve({ slug }) })).json(); };
  expect(await room(102)).toMatchObject({ voiceEnabled: false, voiceDiagnosticsEnabled: false });
  expect(await room(101)).toMatchObject({ voiceEnabled: true, voiceDiagnosticsEnabled: true });
  vi.stubEnv("REMOTE_DUELS_USERS", "102"); expect(access.remoteVoiceEnabledFor(101)).toBe(false); expect((await post(101)).status).toBe(404);
  vi.stubEnv("REMOTE_DUELS_USERS", "*"); vi.stubEnv("REMOTE_DUELS", "0"); expect(access.remoteVoiceEnabledFor(101)).toBe(false);
});
it("keeps voice asset access within the existing vision gate, without requiring voice for manual asset requests", async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("DUEL_FX_LAB", "0");
  vi.stubEnv("VISION_CODE_DIR", dir); vi.stubEnv("VISION_DATA_DIR", dir);
  for (const kind of ["kws", "asr"]) { await mkdir(join(dir, kind)); await writeFile(join(dir, kind, "worker.js"), "export {}"); }
  await writeFile(join(dir, "worker.js"), "export {}");
  const { GET } = await import("../app/dev/vision-assets/[...path]/route");
  const asset = async (userId: number | null, path: string[]) => {
    state.auth.mockResolvedValue(userId ? { user: { id: String(userId) } } : null);
    const response = await GET(new Request("http://localhost/dev/vision-assets/"), { params: Promise.resolve({ path }) });
    await response.text(); return response.status;
  };
  for (const path of [["worker.js"], ["kws", "worker.js"], ["asr", "worker.js"]]) {
    expect(await asset(101, path)).toBe(200); // voice-listed and Remote Duels allowed
    expect(await asset(102, path)).toBe(200); // existing vision allowance, not an automatic browser request
    expect(await asset(null, path)).toBe(404);
    vi.stubEnv("REMOTE_DUELS_USERS", "101"); expect(await asset(102, path)).toBe(404);
    vi.stubEnv("REMOTE_DUELS_USERS", "*");
  }
});
it("requires signed-in seated diagnostic users; validates a strict bounded JSON body before writing", async () => {
  for (const user of [null, 102, 103]) expect((await post(user)).status).toBe(404);
  expect(await readdir(dir)).toEqual([]);
  for (const data of ["{", "[]", JSON.stringify({ records: [] }), JSON.stringify({ records: [{ ...perf, audio: [1, 2] }] }), JSON.stringify({ records: [{ ...perf, stage1BusyMs: -1 }] })]) expect((await post(101, data)).status).toBe(400);
  expect((await post(101, body(), { "content-length": "65537" })).status).toBe(413);
  expect((await post(101, " ".repeat(65537))).status).toBe(413);
  expect(await readdir(dir)).toEqual([]);
  expect((await post(101)).status).toBe(200); expect((await post(101)).status).toBe(200);
  const path = join(dir, slug, "101-0.jsonl"), lines = (await readFile(path, "utf8")).trim().split("\n").map(text => JSON.parse(text));
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatchObject({ ...perf, userId: 101, seat: 0, tableSlug: slug, buildId: "voice-test-build", serverTime: expect.any(Number) });
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect((await stat(join(dir, slug))).mode & 0o777).toBe(0o700);
  slug = "no-such-room"; expect((await post(101)).status).toBe(404);
});
it("evicts oldest managed files first under the total cap and never deletes unrelated files", async () => {
  vi.stubEnv("REMOTE_VOICE_DIAGNOSTICS_MAX_BYTES", "1200");
  const oldDir = join(dir, "old-room"); await mkdir(oldDir);
  await writeFile(join(oldDir, "999-0.jsonl"), "x".repeat(900)); await utimes(join(oldDir, "999-0.jsonl"), 1, 1);
  await writeFile(join(oldDir, "owner-note.txt"), "keep");
  expect((await post(101)).status).toBe(200);
  expect((await post(101)).status).toBe(200);
  expect(await readdir(oldDir)).toEqual(["owner-note.txt"]);
  expect((await stat(join(dir, slug, "101-0.jsonl"))).size).toBeLessThanOrEqual(1200);
  vi.stubEnv("REMOTE_VOICE_DIAGNOSTICS_MAX_BYTES", "1"); expect((await post(101)).status).toBe(413);
});
it("limits diagnostics to 24 requests per minute per user across tables", async () => {
  for (let n = 0; n < 24; n++) expect((await post(101)).status).toBe(200);
  expect((await post(101)).status).toBe(429);
});
it.each(["phase.set", "turn.end"] as const)("a voice %s uses one ordinary action and one undo; the other seat sees the voice label and restored state", async type => {
  const remote = createRemoteDuelService(state.db!, { openingRoll: false });
  remote.ready(slug, "voice-test", 101, true); remote.ready(slug, "voice-test", 102, true); remote.start(slug, "voice-test", 101);
  const before = remote.get(slug, "voice-test", 101), actionId = `voice-${type}`;
  state.auth.mockResolvedValue({ user: { id: "101" } });
  const { POST } = await import("../app/api/remote/[slug]/actions/route");
  const send = async (baseSeq: number, action: object) => POST(new Request("http://localhost/", { method: "POST", body: JSON.stringify({ baseSeq, action }) }), { params: Promise.resolve({ slug }) });
  const sent = await send(before.lastSeq, { type, actorSeat: 0, idempotencyKey: actionId, ...(type === "phase.set" ? { phase: "standby" } : {}), cam: { by: "player", ui: "voice", sentAt: 1000 } });
  expect(sent.status).toBe(200);
  expect(await sent.json()).toMatchObject({ voiceEnabled: true, voiceDiagnosticsEnabled: true });
  const other = remote.get(slug, "voice-test", 102), event = other.events.find(e => e.id === actionId)!;
  expect(describeEvent(event, seat => `Player ${seat}`, () => undefined)?.text).toContain(" · voice");
  expect((await send(other.lastSeq, { type: "undo", actorSeat: 0, idempotencyKey: "undo-voice", targetActionId: actionId })).status).toBe(200);
  const restored = remote.get(slug, "voice-test", 102);
  expect([restored.state.phase, restored.state.turn, restored.state.turnSeat]).toEqual([before.state.phase, before.state.turn, before.state.turnSeat]);
  expect(restored.events.at(-1)?.action.type).toBe("undo");
});
