import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import type { DuelEngineView, EngineIdentity } from "@yugidraft/shared/duels";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { EngineResourceCache } from "../src/engine-resource-cache.js";
import { seedIdentity } from "./helpers/identity.js";
import { ReplayWorker, replaySource } from "./support/replay-fixtures.js";

const secret = "cross-version-fixture";
const owner = { guildId: "test-guild", playerId: 61, userId: 101 };
const identity: EngineIdentity = { version: 1, coreFamily: "legacy", mode: "normal", wasmHash: "a".repeat(64),
  wrapperHash: "b".repeat(64), wrapperVersion: "fixture", protocolVersion: "fixture", hostRuleVersion: "duel-rules-2:null",
  cardDatabaseHash: "c".repeat(64), cardRemapsHash: null, cardScriptsHash: "d".repeat(64), domainScriptHash: null, multiOverlayHash: null };
let db: Database.Database, dir: string, host: DuelHost, slug: string, duelId: number;
let workers: ReplayWorker[], configure: (worker: ReplayWorker) => void;
let currentBundleVersion: string;
function start() {
  host = createDuelHost({ db, dataDirectory: dir, secret, searchCards: () => [], pollIntervalMs: 60_000,
    createWorker: () => { const worker = new ReplayWorker(); configure(worker); workers.push(worker); return worker; } });
}
beforeEach(async () => {
  vi.stubEnv("OWNER_USER_IDS", "101");
  db = new Database(":memory:"); migrate(db); dir = mkdtempSync(join(tmpdir(), "replay-cross-version-"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ bundleVersion: "test-bundle" }));
  currentBundleVersion = "test-bundle";
  vi.spyOn(EngineResourceCache.prototype, "get").mockImplementation(async () => ({ dataDirectory: dir,
    bundleVersion: currentBundleVersion, rawBundleVersion: currentBundleVersion, identity }));
  for (const [playerId, userId] of [[61, 101], [64, 201], [65, 202]]) seedIdentity(db, { guildId: owner.guildId, playerId, userId });
  const service = createDuelService(db), session = service.create({ guildId: owner.guildId, organizerPlayerId: 64, name: "Source fixture", mode: "normal" });
  slug = session.slug; duelId = session.id; service.takeSeat(slug, owner.guildId, 65, 1);
  const source = replaySource();
  db.prepare("update duel_seats set deck_json=?, ready=1 where duel_id=?").run(JSON.stringify(source.decks[0]), duelId);
  db.prepare("update duels set status='active',seed_json=?,bundle_version=?,setup_json=? where id=?")
    .run(JSON.stringify(source.seed), source.bundleVersion, JSON.stringify(source.setup), duelId);
  for (const entry of source.commands) db.prepare("insert into duel_commands(duel_id,seq,seat,command_json) values(?,?,?,?)")
    .run(duelId, entry.storedSeq, entry.seat, JSON.stringify(entry.command));
  const worker = new ReplayWorker(); await worker.create({ mode: "normal", decks: source.decks, seed: source.seed, dataDirectory: dir });
  worker.revision = 3;
  service.complete(slug, owner.guildId, 0, "Finished", { public: await worker.view(null), seats: [await worker.view(0), await worker.view(1)] });
  await worker.close(); workers = []; configure = () => {}; start();
});
afterEach(async () => { await host.close(); db.close(); rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
async function post(input: Record<string, unknown> = {}) {
  const raw = JSON.stringify({ op: "replay", slug, guildId: owner.guildId, playerId: 64, version: 2, ...input });
  const response = await host.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
    headers: { "x-announce-signature": "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") } }));
  return { status: response.status, body: await response.json() as any };
}
const cross = () => db.prepare("update duels set bundle_version='older-bundle' where id=?").run(duelId);
const checks = () => db.prepare("select bundle_version,result,reason from duel_replay_verifications where duel_id=?").all(duelId);
function changeSaved(seat: number | null, change: (view: DuelEngineView) => void) {
  const column = seat === null ? "snapshot_public_json" : `snapshot_seat${seat}_json`;
  const row = db.prepare(`select ${column} as board from duels where id=?`).get(duelId) as { board: string };
  const view = JSON.parse(row.board); change(view);
  db.prepare(`update duels set ${column}=? where id=?`).run(JSON.stringify(view), duelId);
}

it("keeps the exact v1/v2 path and does not store a check", async () => {
  for (const version of [1, 2]) expect(await post({ version })).toMatchObject({ status: 200, body: { verification: "exact" } });
  expect(checks()).toEqual([]); expect(workers).toHaveLength(1);
});
it("records a pass, shares builds and retains the original version", async () => {
  cross(); const results = await Promise.all([post(), post(), post()]);
  expect(results.every(r => r.status === 200 && r.body.verification === "verified")).toBe(true);
  expect(workers).toHaveLength(1); expect(checks()).toEqual([{ bundle_version: "test-bundle", result: "verified", reason: null }]);
  expect(db.prepare("select bundle_version from duels where id=?").get(duelId)).toEqual({ bundle_version: "older-bundle" });
  expect((await post()).body.verification).toBe("verified"); expect(workers).toHaveLength(1);
  await host.close(); start(); expect((await post()).body.verification).toBe("verified"); expect(workers).toHaveLength(2);
});
it("compares gzip saved public and private boards through the codec", async () => {
  cross();
  for (const column of ["snapshot_public_json", "snapshot_seat0_json", "snapshot_seat1_json"]) {
    const row = db.prepare(`select ${column} as board from duels where id=?`).get(duelId) as { board: string };
    db.prepare(`update duels set ${column}=? where id=?`).run(gzipSync(row.board), duelId);
  }
  const result = await post({ visibility: "public" }); expect(result.status).toBe(200); expect(result.body.verification).toBe("verified");
  expect(result.body.frames[0].view.seats[1].hand[0].code).toBeUndefined();
});
it.each([null, 0, 1])("refuses and caches a difference in saved projection %s", async seat => {
  cross(); changeSaved(seat, view => { view.seats[seat ?? 0]!.lp--; });
  const result = await post({ visibility: "public" });
  expect(result).toMatchObject({ status: 409, body: { code: "REPLAY_UNVERIFIED", finalBoard: "available", canOpenUnchecked: false, reason: "board_mismatch" } });
  expect(result.body).not.toHaveProperty("frames"); expect(checks()[0]).toMatchObject({ result: "unverified", reason: "board_mismatch" });
  await host.close(); start(); expect((await post({ op: "owner-replay", ...owner })).body.canOpenUnchecked).toBe(true);
  expect(workers).toHaveLength(1);
});
it("records command mismatch and never re-runs it for this version", async () => {
  cross(); db.prepare("update duel_commands set command_json=json_set(command_json,'$.revision',99) where duel_id=? and seq=2").run(duelId);
  expect(await post()).toMatchObject({ status: 409, body: { code: "REPLAY_UNVERIFIED", reason: "command_mismatch" } });
  expect(await post()).toMatchObject({ status: 409, body: { code: "REPLAY_UNVERIFIED", reason: "command_mismatch" } });
  expect(workers).toHaveLength(1); expect(workers[0]!.running).toBe(false);
});
it.each(["completed", "interrupted"])("requires a saved board for a cross-version %s source", async status => {
  cross(); db.prepare("update duels set status=?,snapshot_public_json=null,snapshot_seat0_json=null,snapshot_seat1_json=null,snapshot_seats_json=null where id=?").run(status, duelId);
  expect(await post({ op: "owner-replay", ...owner })).toMatchObject({ status: 409, body: {
    code: "REPLAY_UNVERIFIED", finalBoard: "none", reason: "no_saved_board", canOpenUnchecked: true } });
  expect(workers).toHaveLength(0); expect(checks()[0]).toMatchObject({ result: "unverified", reason: "no_saved_board" });
});
it("requires every seat's saved own view", async () => {
  cross(); db.prepare("update duels set snapshot_seat1_json=null where id=?").run(duelId);
  expect(await post()).toMatchObject({ status: 409, body: { code: "REPLAY_UNVERIFIED", reason: "no_saved_board" } });
  expect(workers).toHaveLength(0);
});
it("opens unchecked for the owner, separates cache entries, and denies a member or forged identity", async () => {
  cross();
  expect(await post({ unchecked: true })).toMatchObject({ status: 403, body: { code: "ACCESS_DENIED" } });
  expect(await post({ unchecked: true, userId: 101 })).toMatchObject({ status: 403 });
  expect(workers).toHaveLength(0);
  expect(await post({ op: "owner-replay", ...owner, unchecked: true })).toMatchObject({ status: 200, body: { verification: "unverified" } });
  expect(checks()).toEqual([]);
  expect(await post({ op: "owner-replay", ...owner })).toMatchObject({ status: 200, body: { verification: "verified" } });
  expect(workers).toHaveLength(2);
  expect((await post({ op: "owner-replay", ...owner, unchecked: true })).status).toBe(200); expect(workers).toHaveLength(2);
});
it("allows unchecked with no saved board but keeps command checks", async () => {
  cross(); db.prepare("update duels set snapshot_public_json=null,snapshot_seat0_json=null,snapshot_seat1_json=null where id=?").run(duelId);
  expect(await post({ op: "owner-replay", ...owner, unchecked: true })).toMatchObject({ status: 200, body: { verification: "unverified" } });
  db.prepare("update duel_commands set command_json=json_set(command_json,'$.promptId','changed') where duel_id=? and seq=2").run(duelId);
  expect(await post({ op: "owner-replay", ...owner, unchecked: true })).toMatchObject({ status: 409, body: { code: "REPLAY_UNVERIFIED", reason: "command_mismatch" } });
});
it("rechecks changed private snapshots and journals after a stored pass", async () => {
  cross(); expect((await post()).status).toBe(200);
  changeSaved(1, view => { view.seats[1]!.hand[0]!.code = 999; });
  expect((await post()).body.reason).toBe("board_mismatch"); expect(workers).toHaveLength(2);
});
it("runs one new verification after a new package version, including a previous failure", async () => {
  cross(); configure = worker => {
    const view = worker.view.bind(worker); worker.view = async seat => {
      const state = await view(seat); state.seats[0]!.lp--; return state;
    };
  };
  expect((await post()).body.reason).toBe("board_mismatch"); expect(workers).toHaveLength(1);
  expect((await post()).body.reason).toBe("board_mismatch"); expect(workers).toHaveLength(1);
  currentBundleVersion = "next-bundle"; configure = () => {};
  expect((await post()).body.verification).toBe("verified"); expect(workers).toHaveLength(2);
  expect((await post()).body.verification).toBe("verified"); expect(workers).toHaveLength(2);
  expect(checks()).toHaveLength(2);
});
it("keeps unchecked cache use owner-only after the allowlist changes", async () => {
  cross(); expect((await post({ ...owner, unchecked: true })).status).toBe(200);
  vi.stubEnv("OWNER_USER_IDS", "");
  expect((await post({ ...owner, unchecked: true })).status).toBe(403); expect(workers).toHaveLength(1);
});
it("reports owner availability as false if the owner is revoked during a failed check", async () => {
  cross(); changeSaved(null, view => { view.seats[0]!.lp--; });
  configure = () => { vi.stubEnv("OWNER_USER_IDS", ""); };
  expect(await post({ op: "owner-replay", ...owner })).toMatchObject({ status: 409,
    body: { code: "REPLAY_UNVERIFIED", canOpenUnchecked: false, reason: "board_mismatch" } });
});
it("keeps a missing-core failure separate from an unverified replay", async () => {
  cross(); vi.mocked(EngineResourceCache.prototype.get).mockRejectedValueOnce(new Error("private resource path"));
  const result = await post();
  expect(result.body).not.toHaveProperty("frames"); expect(JSON.stringify(result.body)).not.toContain("private resource path");
  expect(workers).toHaveLength(0); expect(checks()).toEqual([]);
});
it("checks identity-only changes with the same bundle label", async () => {
  db.prepare("update duels set setup_json=json_set(setup_json,'$.engineIdentity',json(?)) where id=?")
    .run(JSON.stringify({ ...identity, cardScriptsHash: "e".repeat(64) }), duelId);
  expect(await post()).toMatchObject({ status: 200, body: { verification: "verified" } });
});
it.each([false, true])("forks a verified cross-version source (previous replay=%s) and pins current identity", async viewFirst => {
  cross();
  const replay = await post({ op: "owner-replay", ...owner, ...(viewFirst ? {} : { unchecked: true }) });
  const result = await post({ op: "replay-fork", ...owner, cursor: replay.body.frames[1].cursor,
    sourceVersion: replay.body.sourceVersion, requestId: "verified-fork" });
  expect(result.status).toBe(200);
  const state = createDuelService(db).privateState(result.body.slug, owner.guildId);
  expect(state.bundleVersion).toBe("test-bundle"); expect(state.setup?.engineIdentity).toEqual(identity);
  expect(workers).toHaveLength(viewFirst ? 2 : 3);
  expect(db.prepare("select bundle_version from duels where id=?").get(duelId)).toEqual({ bundle_version: "older-bundle" });
});
it("refuses an unverified fork unless the owner explicitly requests unchecked", async () => {
  cross(); changeSaved(null, view => { view.seats[0]!.lp--; });
  const replay = await post({ op: "owner-replay", ...owner, unchecked: true });
  const input = { op: "replay-fork", ...owner, cursor: replay.body.frames[1].cursor,
    sourceVersion: replay.body.sourceVersion, requestId: "unverified-fork" };
  expect(await post(input)).toMatchObject({ status: 409, body: { code: "REPLAY_UNVERIFIED", reason: "board_mismatch", canOpenUnchecked: true } });
  expect(db.prepare("select * from replay_fork_requests").all()).toEqual([]);
  expect((await post({ ...input, unchecked: true })).status).toBe(200);
  expect((await post({ ...input, unchecked: true, playerId: 64, userId: 201, requestId: "member-fork" })).status).toBe(403);
});
