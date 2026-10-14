import Database from "better-sqlite3";
import { signedRequestHeaders } from "@yugidraft/shared/internal-auth";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService } from "@yugidraft/shared/services";
import { seatCountFor, type DuelEngineView, type EngineIdentity, type ReplaySource } from "@yugidraft/shared/duels";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { createReplayCursorCodec, replayFrameId, replayPrefixHash, replaySourceVersion } from "../src/replay-cursor.js";
import { EngineResourceCache } from "../src/engine-resource-cache.js";
import { EngineResourceUnavailableError } from "../src/engine-resource-resolver.js";
import { EngineLoopError } from "../src/engine-loop-error.js";
import { ReplayBuildCache, type ReplayBuildData } from "../src/replay-builder.js";
import { multiScriptsFolderHash, pinnedEngineVersion, repoMultiScriptsDirectory } from "../src/multi-scripts.js";
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
function start(extra: Partial<Parameters<typeof createDuelHost>[0]> = {}) {
  host = createDuelHost({ db, dataDirectory: dir, secret, searchCards: () => [], pollIntervalMs: 60_000,
    createWorker: () => { const worker = new ReplayWorker(); configure(worker); workers.push(worker); return worker; }, ...extra });
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
    .run(JSON.stringify(source.seed), source.bundleVersion, JSON.stringify({ ...source.setup, engineIdentity: identity }), duelId);
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
    headers: { ...signedRequestHeaders({ url: "http://localhost/internal/duel", method: "POST", body: raw, secret: secret, purpose: "duel-host" }) } }));
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

function unknownChoice() {
  db.prepare("update duels set setup_json=json_remove(setup_json,'$.engine','$.engineIdentity') where id=?").run(duelId);
  vi.mocked(EngineResourceCache.prototype.get).mockImplementation(async (_directory, choice) => ({ dataDirectory: dir,
    bundleVersion: currentBundleVersion, rawBundleVersion: currentBundleVersion,
    identity: { ...identity, coreFamily: choice.engine ?? "legacy" } }));
}
function failFamily(worker: ReplayWorker, family: "legacy" | "pinned", reason: "command_mismatch" | "board_mismatch") {
  const view = worker.view.bind(worker);
  worker.view = async seat => {
    const state = await view(seat);
    if (worker.created?.engine === family) {
      if (reason === "board_mismatch") state.seats[0]!.lp--;
      else if (state.prompt) state.prompt.id = "different-prompt";
    }
    return state;
  };
}

it.each(["command_mismatch", "board_mismatch"] as const)("verifies an unknown choice on pinned after legacy %s", async reason => {
  unknownChoice(); configure = worker => failFamily(worker, "legacy", reason);
  const before = createDuelService(db).privateState(slug, owner.guildId);
  const results = await Promise.all([post(), post(), post()]);
  expect(results.every(result => result.status === 200 && result.body.verification === "verified")).toBe(true);
  expect(workers.map(worker => worker.created?.engine)).toEqual(["legacy", "pinned"]);
  expect(workers.every(worker => !worker.running)).toBe(true);
  expect(db.prepare("select result,reason,core_family from duel_replay_verifications where duel_id=?").get(duelId))
    .toEqual({ result: "verified", reason: null, core_family: "pinned" });
  expect(createDuelService(db).privateState(slug, owner.guildId)).toEqual(before);
});
it.each(["command_mismatch", "board_mismatch"] as const)("refuses an unknown choice when both families have %s", async reason => {
  unknownChoice(); configure = worker => { failFamily(worker, "legacy", reason); failFamily(worker, "pinned", reason); };
  for (let request = 0; request < 2; request++) {
    expect(await post()).toMatchObject({ status: 409, body: { code: "REPLAY_UNVERIFIED", reason } });
  }
  await host.close(); start();
  expect((await post()).body.code).toBe("REPLAY_UNVERIFIED");
  expect(workers.map(worker => worker.created?.engine)).toEqual(["legacy", "pinned"]);
  expect(checks()).toHaveLength(1);
});
it.each(["legacy", "pinned"] as const)("never tries another family for saved choice %s without an identity", async engine => {
  unknownChoice(); db.prepare("update duels set setup_json=json_set(setup_json,'$.engine',?) where id=?").run(engine, duelId);
  configure = worker => failFamily(worker, engine, "board_mismatch");
  expect(await post()).toMatchObject({ status: 409, body: { code: "REPLAY_UNVERIFIED", reason: "board_mismatch" } });
  expect(workers.map(worker => worker.created?.engine)).toEqual([engine]);
});
it("never tries another family for a recorded identity without a saved choice", async () => {
  cross(); configure = worker => failFamily(worker, "legacy", "command_mismatch");
  expect(await post()).toMatchObject({ status: 409, body: { code: "REPLAY_UNVERIFIED", reason: "command_mismatch" } });
  expect(workers.map(worker => worker.created?.engine)).toEqual(["legacy"]);
});
it("keeps startup-script rows pinned-only without a saved choice or identity", async () => {
  unknownChoice();
  db.prepare("update duels set setup_json=json_set(setup_json,'$.startupScripts',json(?)) where id=?")
    .run(JSON.stringify(["-- fixture startup"]), duelId);
  configure = worker => failFamily(worker, "pinned", "board_mismatch");
  expect(await post()).toMatchObject({ status: 409, body: { code: "REPLAY_UNVERIFIED", reason: "board_mismatch" } });
  expect(workers.map(worker => worker.created?.engine)).toEqual(["pinned"]);
});
it("does not try either family for an unknown choice without all saved boards", async () => {
  unknownChoice(); db.prepare("update duels set snapshot_seat1_json=null where id=?").run(duelId);
  expect(await post()).toMatchObject({ status: 409, body: { code: "REPLAY_UNVERIFIED", reason: "no_saved_board" } });
  expect(workers).toHaveLength(0);
});
it("reuses the recorded family for another projection, after restart, and for a fork", async () => {
  unknownChoice(); configure = worker => failFamily(worker, "legacy", "command_mismatch");
  const replay = await post({ op: "owner-replay", ...owner }); expect(replay.status).toBe(200);
  expect((await post({ visibility: "public" })).status).toBe(200);
  await host.close(); start();
  expect((await post()).status).toBe(200);
  const fork = await post({ op: "replay-fork", ...owner, cursor: replay.body.frames[1].cursor,
    sourceVersion: replay.body.sourceVersion, requestId: "unknown-choice-fork" });
  expect(fork.status).toBe(200);
  expect(workers.map(worker => worker.created?.engine)).toEqual(["legacy", "pinned", "pinned", "pinned", "pinned"]);
  expect(createDuelService(db).privateState(fork.body.slug, owner.guildId).setup)
    .toMatchObject({ engine: "pinned", engineIdentity: { coreFamily: "pinned" } });
  expect((await post({ op: "fork-restart", slug: fork.body.slug, ...owner })).status).toBe(200);
});
it.each(["command_mismatch", "board_mismatch"] as const)("keeps unchecked unknown-choice views on default legacy after %s without replacing a stored pinned pass", async reason => {
  unknownChoice(); configure = worker => failFamily(worker, "legacy", reason);
  expect((await post()).status).toBe(200);
  expect(await post({ op: "owner-replay", ...owner, unchecked: true }))
    .toMatchObject(reason === "command_mismatch" ? { status: 409, body: { code: "REPLAY_UNVERIFIED", reason } }
      : { status: 200, body: { verification: "unverified" } });
  expect((await post()).status).toBe(200);
  expect(workers.map(worker => worker.created?.engine)).toEqual(["legacy", "pinned", "legacy"]);
  expect(checks()[0]).toMatchObject({ result: "verified" });
});
it("retains the first mismatch so a time-budget retry builds only pinned and verifies", async () => {
  unknownChoice();
  const realNow = Date.now.bind(Date); let elapsed = 0;
  vi.spyOn(Date, "now").mockImplementation(() => realNow() + elapsed);
  configure = worker => {
    const create = worker.create.bind(worker);
    worker.create = async options => { await create(options); if (options.engine === "legacy") elapsed += 14_000; };
    failFamily(worker, "legacy", "command_mismatch");
  };
  expect(await post()).toMatchObject({ status: 503, body: { code: "REPLAY_VERIFIED_RETRY" } });
  expect(workers.map(worker => worker.created?.engine)).toEqual(["legacy"]);
  expect(checks()).toEqual([]);
  expect(await post()).toMatchObject({ status: 200, body: { verification: "verified" } });
  expect(workers.map(worker => worker.created?.engine)).toEqual(["legacy", "pinned"]);
  expect(db.prepare("select result,core_family from duel_replay_verifications where duel_id=?").get(duelId))
    .toEqual({ result: "verified", core_family: "pinned" });
});
it("invalidates the recorded family when its installed identity changes under the same bundle", async () => {
  unknownChoice(); configure = worker => failFamily(worker, "legacy", "command_mismatch");
  expect((await post()).status).toBe(200);
  const before = db.prepare("select resource_stamp from duel_replay_verifications where duel_id=?").get(duelId);
  vi.mocked(EngineResourceCache.prototype.get).mockImplementation(async (_directory, choice) => ({ dataDirectory: dir,
    bundleVersion: currentBundleVersion, rawBundleVersion: currentBundleVersion,
    identity: { ...identity, coreFamily: choice.engine ?? "legacy", ...(choice.engine === "pinned" ? { wasmHash: "e".repeat(64) } : {}) } }));
  expect((await post()).status).toBe(200);
  expect(workers.map(worker => worker.created?.engine)).toEqual(["legacy", "pinned", "legacy", "pinned"]);
  expect(db.prepare("select resource_stamp from duel_replay_verifications where duel_id=?").get(duelId)).not.toEqual(before);
});
it("does not retry transient worker failures on the other family", async () => {
  unknownChoice(); configure = worker => { worker.create = async () => { throw new Error("Worker unavailable"); }; };
  expect(await post()).toMatchObject({ status: 503, body: { code: "ENGINE_BUSY" } });
  expect(workers).toHaveLength(1); expect(workers[0]!.running).toBe(false); expect(checks()).toEqual([]);
});
it.each(["crash", "loop-limit"] as const)("tries pinned after a legacy %s", async failure => {
  unknownChoice(); configure = worker => {
    const answer = worker.answer.bind(worker);
    worker.answer = async (...args) => {
      if (worker.created?.engine === "legacy") {
        if (failure === "loop-limit") throw new EngineLoopError();
        worker.running = false; throw new Error("Fixture worker exited");
      }
      return answer(...args);
    };
  };
  expect(await post()).toMatchObject({ status: 200, body: { verification: "verified" } });
  expect(workers.map(worker => worker.created?.engine)).toEqual(["legacy", "pinned"]);
  expect(db.prepare("select core_family from duel_replay_verifications where duel_id=?").get(duelId))
    .toEqual({ core_family: "pinned" });
});
it.each((["crash", "loop-limit"] as const).flatMap(failure =>
  (["command_mismatch", "board_mismatch", "crash", "missing", "unavailable"] as const).map(alternateFailure => ({ failure, alternateFailure }))))(
  "retries legacy in the same host after a legacy $failure and pinned $alternateFailure", async ({ failure, alternateFailure }) => {
  unknownChoice();
  const get = vi.mocked(EngineResourceCache.prototype.get).getMockImplementation()!;
  vi.mocked(EngineResourceCache.prototype.get).mockImplementation(async (directory, choice) => {
    if (choice.engine === "pinned" && alternateFailure === "missing") throw new EngineResourceUnavailableError("fixture family is not installed");
    return get(directory, choice);
  });
  configure = worker => {
    if (alternateFailure === "command_mismatch" || alternateFailure === "board_mismatch") failFamily(worker, "pinned", alternateFailure);
    if (alternateFailure === "unavailable") {
      const create = worker.create.bind(worker);
      worker.create = async options => {
        await create(options);
        if (options.engine === "pinned") throw new EngineResourceUnavailableError("fixture resources disappeared after selection");
      };
    }
    const answer = worker.answer.bind(worker);
    worker.answer = async (...args) => {
      if (worker.created?.engine === "legacy" || alternateFailure === "crash") {
        if (failure === "loop-limit") throw new EngineLoopError();
        worker.running = false; throw new Error("Fixture worker exited");
      }
      return answer(...args);
    };
  };
  expect(await post()).toMatchObject({ status: 503, body: { code: "ENGINE_BUSY" } });
  expect(checks()).toEqual([]);
  expect(workers.map(worker => worker.created?.engine)).toEqual(alternateFailure === "missing" ? ["legacy"] : ["legacy", "pinned"]);
  expect(workers.every(worker => !worker.running)).toBe(true);
  workers = [];
  vi.mocked(EngineResourceCache.prototype.get).mockImplementation(get); configure = () => {};
  expect(await post()).toMatchObject({ status: 200, body: { verification: "verified" } });
  expect(workers.map(worker => worker.created?.engine)).toEqual(["legacy"]);
});
it.each(["crash", "loop-limit"] as const)("keeps a pinned %s transient after a legacy command mismatch", async failure => {
  unknownChoice(); configure = worker => {
    failFamily(worker, "legacy", "command_mismatch");
    const answer = worker.answer.bind(worker);
    worker.answer = async (...args) => {
      if (worker.created?.engine === "pinned") {
        if (failure === "loop-limit") throw new EngineLoopError();
        worker.running = false; throw new Error("Fixture pinned worker exited");
      }
      return answer(...args);
    };
  };
  expect(await post()).toMatchObject({ status: 503, body: { code: "ENGINE_BUSY" } });
  expect(checks()).toEqual([]);
  expect(workers.map(worker => worker.created?.engine)).toEqual(["legacy", "pinned"]);
  configure = () => {};
  expect(await post()).toMatchObject({ status: 200, body: { verification: "verified" } });
  expect(workers.map(worker => worker.created?.engine)).toEqual(["legacy", "pinned", "pinned"]);
});
it("tries pinned after a legacy crash during owner reveal reads", async () => {
  unknownChoice(); configure = worker => {
    const view = worker.view.bind(worker);
    worker.view = async seat => {
      if (worker.created?.engine === "legacy" && seat === 1) {
        worker.running = false; throw new Error("Fixture reveal worker exited");
      }
      return view(seat);
    };
  };
  expect(await post({ op: "owner-replay", ...owner, visibility: "public", reveal: true }))
    .toMatchObject({ status: 200, body: { verification: "verified" } });
  expect(workers.map(worker => worker.created?.engine)).toEqual(["legacy", "pinned"]);
});
it("preserves a concurrent verified pass after a pinned crash and retries that projection", async () => {
  unknownChoice();
  let release!: () => void, crash = true;
  const verified = new Promise<void>(resolve => { release = resolve; });
  configure = worker => {
    failFamily(worker, "legacy", "command_mismatch");
    const view = worker.view.bind(worker);
    worker.view = async seat => {
      if (worker.created?.engine === "pinned" && seat === null && crash) {
        // Only the public projection's opening capture runs before its first own-seat read.
        const isOpening = worker.revision === 1;
        if (isOpening) {
          await verified; crash = false; worker.running = false; throw new Error("Fixture pinned worker exited");
        }
      }
      return view(seat);
    };
  };
  const failedProjection = post({ visibility: "public" });
  try {
    expect(await post()).toMatchObject({ status: 200, body: { verification: "verified" } });
  } finally { release(); }
  expect(await failedProjection).toMatchObject({ status: 503, body: { code: "ENGINE_BUSY" } });
  expect(db.prepare("select result,reason,core_family from duel_replay_verifications where duel_id=?").get(duelId))
    .toEqual({ result: "verified", reason: null, core_family: "pinned" });
  expect(await post({ visibility: "public" })).toMatchObject({ status: 200, body: { verification: "verified" } });
});
it("lets an in-flight pinned check verify after a concurrent transient crash", async () => {
  unknownChoice();
  let reached!: () => void, release!: () => void, crash = true;
  const comparing = new Promise<void>(resolve => { reached = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  configure = worker => {
    failFamily(worker, "legacy", "command_mismatch");
    const view = worker.view.bind(worker);
    worker.view = async seat => {
      if (worker.created?.engine === "pinned") {
        if (seat === 0 && worker.revision === 3) { reached(); await resume; }
        if (seat === null && worker.revision === 1 && crash) {
          crash = false; worker.running = false; throw new Error("Fixture pinned worker exited");
        }
      }
      return view(seat);
    };
  };
  const healthyProjection = post();
  try {
    await comparing;
    expect(await post({ visibility: "public" })).toMatchObject({ status: 503, body: { code: "ENGINE_BUSY" } });
    expect(checks()).toEqual([]);
  } finally { release(); }
  expect(await healthyProjection).toMatchObject({ status: 200, body: { verification: "verified" } });
  expect(db.prepare("select result,reason,core_family from duel_replay_verifications where duel_id=?").get(duelId))
    .toEqual({ result: "verified", reason: null, core_family: "pinned" });
  expect(await post({ visibility: "public" })).toMatchObject({ status: 200, body: { verification: "verified" } });
});
it("returns ENGINE_BUSY without a family fallback when the replay queue is full", async () => {
  unknownChoice();
  const busy = new ReplayBuildCache<ReplayBuildData>(value => value.cacheBytes,
    { maxBytes: 100, maxEntries: 1, maxConcurrent: 0, maxWaiting: 0 });
  const getOrBuild = ReplayBuildCache.prototype.getOrBuild;
  vi.spyOn(ReplayBuildCache.prototype, "getOrBuild").mockImplementation(function (...args) {
    return getOrBuild.apply(busy, args);
  });
  for (let retry = 0; retry < 2; retry++) expect(await post()).toMatchObject({ status: 503, body: { code: "ENGINE_BUSY" } });
  expect(workers).toHaveLength(0); expect(checks()).toEqual([]);
});
it.each(["legacy", "pinned"] as const)("offers unchecked on %s when only that family's commands run", async playable => {
  unknownChoice(); configure = worker => {
    failFamily(worker, "legacy", playable === "legacy" ? "board_mismatch" : "command_mismatch");
    failFamily(worker, "pinned", playable === "pinned" ? "board_mismatch" : "command_mismatch");
  };
  expect(await post({ op: "owner-replay", ...owner }))
    .toMatchObject({ status: 409, body: { code: "REPLAY_UNVERIFIED", reason: "board_mismatch", canOpenUnchecked: true } });
  expect(db.prepare("select result,reason,core_family from duel_replay_verifications where duel_id=?").get(duelId))
    .toEqual({ result: "unverified", reason: "board_mismatch", core_family: playable });
  await host.close(); start();
  expect(await post({ op: "owner-replay", ...owner, unchecked: true }))
    .toMatchObject({ status: 200, body: { verification: "unverified" } });
  expect(workers.map(worker => worker.created?.engine)).toEqual(["legacy", "pinned", playable]);
  const replay = await post({ op: "owner-replay", ...owner, unchecked: true });
  const fork = await post({ op: "replay-fork", ...owner, unchecked: true, cursor: replay.body.frames[0].cursor,
    sourceVersion: replay.body.sourceVersion, requestId: `unchecked-${playable}-fork` });
  expect(fork.status).toBe(200);
  expect(createDuelService(db).privateState(fork.body.slug, owner.guildId).setup?.engine).toBe(playable);
});
it("rechecks a failed unknown choice when the other family becomes installed", async () => {
  unknownChoice(); const get = vi.mocked(EngineResourceCache.prototype.get).getMockImplementation()!;
  vi.mocked(EngineResourceCache.prototype.get).mockImplementation(async (directory, choice) => {
    if (choice.engine === "pinned") throw new EngineResourceUnavailableError("fixture family is not installed");
    return get(directory, choice);
  });
  configure = worker => failFamily(worker, "legacy", "command_mismatch");
  expect(await post()).toMatchObject({ status: 409, body: { code: "REPLAY_UNVERIFIED", reason: "command_mismatch" } });
  expect(workers).toHaveLength(1);
  vi.mocked(EngineResourceCache.prototype.get).mockImplementation(get);
  expect((await post()).status).toBe(200);
  expect(workers.map(worker => worker.created?.engine)).toEqual(["legacy", "legacy", "pinned"]);
});
it("checks both families before a cold fork and launches pinned only on retry", async () => {
  unknownChoice(); configure = worker => failFamily(worker, "legacy", "command_mismatch");
  const state = createDuelService(db).privateState(slug, owner.guildId);
  const { engineIdentity, ...setup } = state.setup!;
  const source: ReplaySource = { session: state.session, decks: state.decks, seed: state.seed as ReplaySource["seed"],
    bundleVersion: state.bundleVersion!, engineIdentity: engineIdentity ?? null, setup, commands: state.commands };
  const sourceVersion = replaySourceVersion(source);
  const cursor = createReplayCursorCodec(secret).seal({ sourceId: duelId, sourceSlug: slug, guildId: owner.guildId,
    sourceVersion, frameId: replayFrameId(sourceVersion, 0), step: 0, prefixCount: 0, prefixHash: replayPrefixHash(source, 0), revision: 1 });
  const input = { op: "replay-fork", ...owner, cursor, sourceVersion, requestId: "cold-unknown-choice-fork" };
  expect(await post(input)).toMatchObject({ status: 503, body: { code: "REPLAY_VERIFIED_RETRY" } });
  expect(workers.map(worker => worker.created?.engine)).toEqual(["legacy", "pinned"]);
  expect(db.prepare("select * from replay_fork_requests").all()).toEqual([]);
  const fork = await post(input); expect(fork.status).toBe(200);
  expect(workers.map(worker => worker.created?.engine)).toEqual(["legacy", "pinned", "pinned"]);
  expect(createDuelService(db).privateState(fork.body.slug, owner.guildId).setup?.engine).toBe("pinned");
});
it("uses the recorded verified family for a fork even when unchecked is requested", async () => {
  unknownChoice(); configure = worker => failFamily(worker, "legacy", "command_mismatch");
  const replay = await post({ op: "owner-replay", ...owner }); expect(replay.status).toBe(200);
  const fork = await post({ op: "replay-fork", ...owner, cursor: replay.body.frames[1].cursor,
    sourceVersion: replay.body.sourceVersion, requestId: "verified-unknown-unchecked-fork", unchecked: true });
  expect(fork.status).toBe(200);
  expect(workers.map(worker => worker.created?.engine)).toEqual(["legacy", "pinned", "pinned"]);
});

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
  cross(); vi.mocked(EngineResourceCache.prototype.get).mockRejectedValueOnce(new EngineResourceUnavailableError("the source core is not installed"));
  const result = await post();
  expect(result).toMatchObject({ status: 409, body: { code: "ENGINE_UNAVAILABLE_FOR_SOURCE", finalBoard: "available" } });
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
  const input = { op: "replay-fork", ...owner, cursor: replay.body.frames[1].cursor,
    sourceVersion: replay.body.sourceVersion, requestId: "verified-fork" };
  if (!viewFirst) {
    expect(await post(input)).toMatchObject({ status: 503, body: { code: "REPLAY_VERIFIED_RETRY" } });
    expect(db.prepare("select * from replay_fork_requests").all()).toEqual([]);
    expect(workers).toHaveLength(2);
  }
  const result = await post(input);
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
it("pins the verified resource selection through detached fork launch", async () => {
  cross(); const replay = await post({ op: "owner-replay", ...owner });
  let reads = 0;
  vi.mocked(EngineResourceCache.prototype.get).mockImplementation(async () => ({ dataDirectory: dir,
    bundleVersion: "test-bundle", rawBundleVersion: "test-bundle",
    identity: ++reads === 1 ? identity : { ...identity, cardDatabaseHash: "e".repeat(64) } }));
  const result = await post({ op: "replay-fork", ...owner, cursor: replay.body.frames[1].cursor,
    sourceVersion: replay.body.sourceVersion, requestId: "resource-race" });
  expect(result.status).toBe(200);
  expect(workers.at(-1)!.created?.engineIdentity).toEqual(identity);
  expect(createDuelService(db).privateState(result.body.slug, owner.guildId).setup?.engineIdentity).toEqual(identity);
  expect(reads).toBe(1);
});
it("keeps restart pinned to the fork's stored identity after current resources change", async () => {
  cross(); const replay = await post({ op: "owner-replay", ...owner });
  const result = await post({ op: "replay-fork", ...owner, cursor: replay.body.frames[1].cursor,
    sourceVersion: replay.body.sourceVersion, requestId: "pinned-restart" });
  expect(result.status).toBe(200);
  const before = createDuelService(db).privateState(result.body.slug, owner.guildId);
  currentBundleVersion = "next-bundle";
  expect(await post({ op: "fork-restart", slug: result.body.slug, ...owner })).toMatchObject({ status: 409,
    body: { code: "ENGINE_UNAVAILABLE_FOR_SOURCE" } });
  expect(createDuelService(db).privateState(result.body.slug, owner.guildId)).toEqual(before);
  expect(workers).toHaveLength(2);
});
it("persists resolved old 1v1 rules on the new fork for restart and recovery", async () => {
  cross(); db.prepare("update duels set setup_json=json_remove(setup_json,'$.firstTurnDraw','$.scriptErrorMode') where id=?").run(duelId);
  const original = createDuelService(db).privateState(slug, owner.guildId);
  const replay = await post({ op: "owner-replay", ...owner }); expect(replay.status).toBe(200);
  const result = await post({ op: "replay-fork", ...owner, cursor: replay.body.frames[1].cursor,
    sourceVersion: replay.body.sourceVersion, requestId: "old-rules" });
  expect(result.status).toBe(200);
  expect(createDuelService(db).privateState(result.body.slug, owner.guildId).setup)
    .toMatchObject({ firstTurnDraw: false, scriptErrorMode: "tolerant", engineIdentity: identity });
  expect((await post({ op: "fork-restart", slug: result.body.slug, ...owner })).status).toBe(200);
  await host.close(); start();
  expect((await post({ op: "view", slug: result.body.slug, ...owner })).status).toBe(200);
  expect(createDuelService(db).privateState(slug, owner.guildId)).toEqual(original);
});
it.each([
  ["normal", "1v1", "legacy"], ["normal", "1v1", "pinned"],
  ["domain", "1v1", "legacy"], ["domain", "1v1", "pinned"],
  ["normal", "tag", "legacy"], ["domain", "tag", "pinned"],
  ["normal", "ffa3", "legacy"], ["domain", "ffa4", "pinned"],
] as const)("verifies saved %s %s %s projections with the original engine family", async (mode, format, engine) => {
  const count = seatCountFor(format), service = createDuelService(db), fixture = replaySource(format);
  for (const [playerId, userId] of [[66, 203], [67, 204]]) seedIdentity(db, { guildId: owner.guildId, playerId, userId });
  db.prepare("delete from duel_seats where duel_id=?").run(duelId);
  for (let seat = 0; seat < count; seat++) db.prepare("insert into duel_seats(duel_id,seat,player_id,is_bot,ready,deck_json) values(?,?,?,0,1,?)")
    .run(duelId, seat, 64 + seat, JSON.stringify(fixture.decks[seat]));
  db.prepare("update duels set status='active',mode=?,format=?,setup_json=? where id=?")
    .run(mode, format, JSON.stringify({ ...fixture.setup, engine }), duelId);
  const savedWorker = new ReplayWorker(); await savedWorker.create({ mode, decks: fixture.decks, seed: fixture.seed, dataDirectory: dir });
  savedWorker.revision = 3;
  service.complete(slug, owner.guildId, 0, "Finished", { public: await savedWorker.view(null),
    seats: await Promise.all(fixture.decks.map((_, seat) => savedWorker.view(seat))) });
  await savedWorker.close();
  const overlay = count > 2 ? repoMultiScriptsDirectory() : undefined;
  const overlayHash = overlay ? multiScriptsFolderHash(overlay) : null;
  const selectedIdentity: EngineIdentity = { ...identity, mode, coreFamily: count > 2 ? "multi" : engine,
    domainScriptHash: mode === "domain" ? "e".repeat(64) : null, multiOverlayHash: overlayHash };
  vi.mocked(EngineResourceCache.prototype.get).mockImplementation(async (_directory, choice) => {
    expect(choice).toMatchObject({ mode, format, engine });
    return { dataDirectory: dir, identity: selectedIdentity, rawBundleVersion: "test-bundle",
      bundleVersion: pinnedEngineVersion("test-bundle", count, overlayHash), ...(overlay ? { multiScriptsDirectory: overlay } : {}) };
  });
  cross();
  const result = await post(); expect(result).toMatchObject({ status: 200, body: { verification: "verified" } });
  expect(workers[0]!.created).toMatchObject({ mode, engineIdentity: selectedIdentity,
    ...(count > 2 ? { format } : { engine }) });
  expect(result.body.frames[0].view.seats[1].hand[0].code).toBeUndefined();
  expect(checks()[0]).toMatchObject({ result: "verified" });
});

it("checks a null identity at the same label and detects a changed saved board", async () => {
  db.prepare("update duels set setup_json=json_remove(setup_json,'$.engineIdentity') where id=?").run(duelId);
  expect(await post()).toMatchObject({ status: 200, body: { verification: "verified" } });
  changeSaved(null, view => { view.seats[0]!.lp--; });
  expect(await post()).toMatchObject({ status: 409, body: { code: "REPLAY_UNVERIFIED", reason: "board_mismatch" } });
});
it("ignores unchecked on an exact source and reuses its saved final frame", async () => {
  const exact = await post({ op: "owner-replay", ...owner });
  const unchecked = await post({ op: "owner-replay", ...owner, unchecked: true });
  expect(unchecked.body.verification).toBe("exact");
  expect(unchecked.body.frames.map((frame: any) => ({ ...frame, cursor: null })))
    .toEqual(exact.body.frames.map((frame: any) => ({ ...frame, cursor: null })));
  expect(unchecked.body.frames.at(-1).view.result).toEqual({ winnerSeat: 0, reason: "Finished" });
  expect(workers).toHaveLength(1); expect(checks()).toEqual([]);
});
it("does not offer unchecked for an owner command mismatch, including fork authorization", async () => {
  cross(); db.prepare("update duel_commands set command_json=json_set(command_json,'$.revision',99) where duel_id=? and seq=2").run(duelId);
  expect(await post({ op: "owner-replay", ...owner })).toMatchObject({ status: 409, body: {
    code: "REPLAY_UNVERIFIED", reason: "command_mismatch", canOpenUnchecked: false } });
  const state = createDuelService(db).privateState(slug, owner.guildId);
  const { engineIdentity, ...setup } = state.setup!;
  const source: ReplaySource = { session: state.session, decks: state.decks, seed: state.seed as ReplaySource["seed"],
    bundleVersion: state.bundleVersion!, engineIdentity: engineIdentity ?? null, setup, commands: state.commands };
  const sourceVersion = replaySourceVersion(source);
  const cursor = createReplayCursorCodec(secret).seal({ sourceId: duelId, sourceSlug: slug, guildId: owner.guildId,
    sourceVersion, frameId: replayFrameId(sourceVersion, 0), step: 0, prefixCount: 0, prefixHash: replayPrefixHash(source, 0), revision: 1 });
  expect(await post({ op: "replay-fork", ...owner, cursor, sourceVersion, requestId: "command-failure-fork" }))
    .toMatchObject({ status: 409, body: { code: "REPLAY_UNVERIFIED", reason: "command_mismatch", canOpenUnchecked: false } });
  expect(workers).toHaveLength(1);
  expect(db.prepare("select * from replay_fork_requests").all()).toEqual([]);
});
it.each([false, true])("retains a stored check after snapshot compaction (failed=%s)", async failed => {
  cross(); if (failed) changeSaved(null, view => { view.seats[0]!.lp--; });
  const before = await post();
  const row = db.prepare("select snapshot_public_json, snapshot_seat0_json, snapshot_seat1_json from duels where id=?").get(duelId) as any;
  db.prepare("update duels set snapshot_public_json=?,snapshot_seats_json=?,snapshot_seat0_json=null,snapshot_seat1_json=null where id=?")
    .run(gzipSync(row.snapshot_public_json), gzipSync(JSON.stringify([JSON.parse(row.snapshot_seat0_json), JSON.parse(row.snapshot_seat1_json)])), duelId);
  expect(await post()).toEqual(before); expect(workers).toHaveLength(1); expect(checks()).toHaveLength(1);
});
it("writes no verification record when the request deadline aborts the build", async () => {
  cross(); await host.close(); start({ replayRequestTimeoutMs: 30 });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  configure = worker => { const create = worker.create.bind(worker); worker.create = async options => { await create(options); await held; }; };
  const result = await post();
  expect(result).toMatchObject({ status: 503, body: { code: "ENGINE_BUSY" } });
  release(); await host.close();
  expect(checks()).toEqual([]); expect(workers[0]!.running).toBe(false);
});
it("writes no verification record when checkpoints exceed the build cap before the check", async () => {
  cross();
  configure = worker => { worker.includeLog = false; };
  const insert = db.prepare("insert into duel_commands(duel_id,seq,seat,command_json) values(?,?,?,?)");
  db.transaction(() => {
    for (let index = 0; index < 30_000; index++) insert.run(duelId, 20 + index, 0,
      JSON.stringify({ revision: 3 + index, promptId: `p${3 + index}`, answer: { choice: "next" } }));
  })();
  expect(await post()).toMatchObject({ status: 413, body: { code: "REPLAY_TOO_LARGE" } });
  expect(checks()).toEqual([]); expect(workers[0]!.running).toBe(false);
});
it.each([
  ["1v1", 0, false, "Finished"], ["tag", 1, false, "Finished"],
  ["ffa3", 2, false, "Finished"], ["ffa4", 3, true, "Finished"],
  ["ffa3", 2, true, "Time limit"],
] as const)("verifies a live engine %s win at seat %s (pending=%s, reason=%s)", async (format, winnerSeat, pending, reason) => {
  const fixture = replaySource(format), count = seatCountFor(format);
  for (const [playerId, userId] of [[66, 203], [67, 204]]) seedIdentity(db, { guildId: owner.guildId, playerId, userId });
  db.prepare("delete from duel_seats where duel_id=?").run(duelId);
  for (let seat = 0; seat < count; seat++) db.prepare("insert into duel_seats(duel_id,seat,player_id,is_bot,ready,deck_json) values(?,?,?,0,1,?)")
    .run(duelId, seat, 64 + seat, JSON.stringify(fixture.decks[seat]));
  const overlay = format === "1v1" ? undefined : repoMultiScriptsDirectory();
  const selectedIdentity = { ...identity, coreFamily: format === "1v1" ? "legacy" as const : "multi" as const,
    multiOverlayHash: overlay ? multiScriptsFolderHash(overlay) : null };
  const bundle = pinnedEngineVersion("test-bundle", count, selectedIdentity.multiOverlayHash);
  vi.mocked(EngineResourceCache.prototype.get).mockResolvedValue({ dataDirectory: dir,
    bundleVersion: bundle, rawBundleVersion: "test-bundle", identity: selectedIdentity, multiScriptsDirectory: overlay });
  db.prepare("update duels set status='active',format=?,bundle_version=?,setup_json=? where id=?")
    .run(format, bundle, JSON.stringify({ ...fixture.setup, engineIdentity: selectedIdentity }), duelId);
  configure = worker => {
    worker.result = { winnerSeat, ...(format === "1v1" ? {} : { winnerTeam: format === "tag" ? winnerSeat % 2 : winnerSeat }),
      reason: reason === "Time limit" ? "Time limit up" : reason };
    worker.resultAtRevision = reason === "Time limit" ? 4 : 3;
    if (reason === "Time limit") Object.assign(worker, { eliminate: async () => {
      worker.revision++; worker.pendingElimination = 0;
    } });
    else if (pending) worker.pendingElimination = 0;
  };
  if (reason === "Time limit") db.prepare("update duels set clock_json=? where id=?")
    .run(JSON.stringify({ turn: 1, remainingMs: [0, 100_000, 100_000], activeSeat: 0, startedAt: 0 }), duelId);
  const finished = await post({ op: "view", playerId: 64 });
  expect(finished).toMatchObject({ status: 200, body: { session: { status: "completed", winnerSeat } } });
  expect(finished.body.engine.result.reason).toBe(reason);
  expect(finished.body.engine.seats.every((seat: any) => !seat.pendingElimination)).toBe(true);
  cross(); expect(await post()).toMatchObject({ status: 200, body: { verification: "verified" } });
  await host.close(); start();
  configure = worker => {
    worker.result = { winnerSeat: winnerSeat === 0 ? 1 : 0, reason };
    worker.resultAtRevision = reason === "Time limit" ? 4 : 3;
    if (reason === "Time limit") Object.assign(worker, { eliminate: async () => { worker.revision++; } });
  };
  currentBundleVersion = "changed-bundle";
  vi.mocked(EngineResourceCache.prototype.get).mockResolvedValue({ dataDirectory: dir,
    bundleVersion: pinnedEngineVersion(currentBundleVersion, count, selectedIdentity.multiOverlayHash), rawBundleVersion: currentBundleVersion, identity: selectedIdentity, multiScriptsDirectory: overlay });
  expect(await post()).toMatchObject({ status: 409, body: { reason: "board_mismatch" } });
  if (format === "tag") {
    await host.close(); start();
    vi.mocked(EngineResourceCache.prototype.get).mockResolvedValue({ dataDirectory: dir,
      bundleVersion: "wrong-team-bundle", rawBundleVersion: "wrong-team-bundle", identity: selectedIdentity, multiScriptsDirectory: overlay });
    configure = worker => { worker.result = { winnerSeat, winnerTeam: 0, reason }; worker.resultAtRevision = 3; };
    expect(await post()).toMatchObject({ status: 409, body: { reason: "board_mismatch" } });
  }
});
