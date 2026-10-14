import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelService, createReplayForkService } from "@yugidraft/shared/services";
import { seatCountFor, type DuelEngineView, type DuelFormat, type ReplaySource } from "@yugidraft/shared/duels";
import { EngineResourceCache } from "../src/engine-resource-cache.js";
import { EngineResourceUnavailableError } from "../src/engine-resource-resolver.js";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { createReplayCursorCodec, replayFrameId, replayPrefixHash, replaySourceVersion } from "../src/replay-cursor.js";
import { activeMultiScriptsHash, pinnedEngineVersion } from "../src/multi-scripts.js";
import { seedIdentity } from "./helpers/identity.js";
import { ReplayWorker, replaySource, replayFixtureResources } from "./support/replay-fixtures.js";

const resourceRead = vi.hoisted(() => vi.fn());
vi.mock("../src/engine-resource-resolver.js", async original => ({
  ...await original<typeof import("../src/engine-resource-resolver.js")>(), resolveEngineResourcesForSource: resourceRead,
}));
const secret = "fork-launch-test-secret";
const owner = { guildId: "test-guild", playerId: 61, userId: 101 };
let db: Database.Database, dir: string, host: DuelHost, slug: string;
let workers: ForkWorker[], onChange: ReturnType<typeof vi.fn<(slug: string, guildId: string) => void>>, makeWorker: () => ForkWorker;

class ForkWorker extends ReplayWorker {
  promptSeat = 0;
  announce = false;
  pending: number | null = null;
  eliminated: number | null = null;
  async eliminate(seat: number) { this.eliminated = seat; this.revision++; }
  async view(viewer: number | null): Promise<DuelEngineView> {
    const view = await super.view(viewer);
    view.prioritySeat = this.result ? null : this.promptSeat;
    view.prompt = viewer === this.promptSeat && !this.result
      ? this.announce ? { id: `p${this.revision}`, seat: this.promptSeat, kind: "announce-card", title: "Card", options: [] }
        : { id: `p${this.revision}`, seat: this.promptSeat, kind: "choice", title: "Next", options: [{ id: "next", label: "Next" }] }
      : null;
    for (const seat of view.seats) {
      if (seat.seat === this.pending) seat.pendingElimination = true;
      if (seat.seat === this.eliminated) seat.eliminated = true;
    }
    return view;
  }
}

function startHost(extra: Partial<Parameters<typeof createDuelHost>[0]> = {}) {
  host = createDuelHost({ db, dataDirectory: dir, secret, searchCards: () => [], pollIntervalMs: 60_000,
    // Fork quota tests exercise the four-fork storage contract independently of worker admission.
    maxTablesPerPlayer: 8,
    onChange, createWorker: () => { const w = makeWorker(); workers.push(w); return w; }, ...extra });
}
function source(format: DuelFormat = "1v1", mode: "normal" | "domain" = "normal") {
  const duels = createDuelService(db), fixture = replaySource(format);
  const session = duels.create({ guildId: owner.guildId, organizerPlayerId: 64, name: "Private prod source", mode, format,
    settings: { visibility: "private" } });
  slug = session.slug;
  db.prepare("delete from duel_seats where duel_id = ?").run(session.id);
  for (let seat = 0; seat < seatCountFor(format); seat++) {
    db.prepare("insert into duel_seats(duel_id,seat,player_id,is_bot,ready,deck_json) values(?,?,?,0,1,?)")
      .run(session.id, seat, 64 + seat, JSON.stringify(fixture.decks[seat]));
  }
  const bundle = pinnedEngineVersion("test-bundle", seatCountFor(format), activeMultiScriptsHash(dir));
  db.prepare("update duels set status = 'interrupted', seed_json = ?, bundle_version = ?, setup_json = ?, ended_at = datetime('now') where id = ?")
    .run(JSON.stringify(fixture.seed), bundle, JSON.stringify({ ...fixture.setup, engine: "legacy", engineIdentity: replayFixtureResources(dir, format, mode).identity }), session.id);
  for (const entry of fixture.commands) db.prepare("insert into duel_commands(duel_id,seq,seat,command_json) values(?,?,?,?)")
    .run(session.id, entry.storedSeq, entry.seat, JSON.stringify(entry.command));
}
function sourceState(): ReplaySource {
  const s = createDuelService(db).privateState(slug, owner.guildId);
  const { engineIdentity, replayFork: _fork, ...setup } = s.setup ?? {};
  return { session: s.session, setup, commands: s.commands, decks: s.decks, seed: s.seed as ReplaySource["seed"],
    bundleVersion: s.bundleVersion!, engineIdentity: engineIdentity ?? null };
}
function request(prefixCount = 1) {
  const s = sourceState(), sourceVersion = replaySourceVersion(s), step = prefixCount === 0 ? 0 : prefixCount === 3 ? 2 : 1;
  return { sourceVersion, requestId: "request-1", cursor: createReplayCursorCodec(secret).seal({
    sourceId: s.session.id, sourceSlug: slug, guildId: owner.guildId, sourceVersion,
    frameId: replayFrameId(sourceVersion, step), step, prefixCount, prefixHash: replayPrefixHash(s, prefixCount),
    revision: prefixCount === 0 ? 1 : prefixCount === 3 ? 3 : 2,
  }) };
}
async function post(input: Record<string, unknown>, signed = true) {
  const raw = JSON.stringify({ slug, ...owner, ...input });
  const response = await host.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
    headers: { "x-announce-signature": signed ? "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") : "bad" } }));
  return { response, body: await response.json() as any };
}
const sourceRows = () => [db.prepare("select * from duels where web_slug = ?").get(slug),
  db.prepare("select * from duel_seats where duel_id = (select id from duels where web_slug = ?)").all(slug),
  db.prepare("select * from duel_commands where duel_id = (select id from duels where web_slug = ?)").all(slug)];
const forkLimitBody = { error: "Replay fork limit reached. Cancel a fork and try again.", code: "FORK_LIMIT",
  limit: 4, forksUrl: "/api/admin/duels/forks" };
beforeEach(() => {
  vi.stubEnv("OWNER_USER_IDS", "101,102"); vi.stubEnv("MULTIPLAYER_TABLES", "1");
  db = new Database(":memory:"); migrate(db);
  dir = mkdtempSync(join(tmpdir(), "host-fork-"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ bundleVersion: "test-bundle" }));
  vi.spyOn(EngineResourceCache.prototype, "get").mockImplementation(async (_directory, options) =>
    replayFixtureResources(dir, options.format, options.mode));
  resourceRead.mockReset().mockImplementation((_directory, _source, current) => current);
  for (const [playerId, userId] of [[61, 101], [62, 102], [63, 103], [64, 201], [65, 202], [66, 203], [67, 204]]) {
    seedIdentity(db, { guildId: owner.guildId, playerId, userId });
  }
  source(); workers = []; onChange = vi.fn(); makeWorker = () => new ForkWorker(); startHost();
});
afterEach(async () => { await host.close(); db.close(); rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("lists only the caller's active forks with exact metadata and deterministic creation order", async () => {
  const input = request(), before = sourceRows();
  const first = (await post({ op: "replay-fork", ...input, requestId: "list-first" })).body.slug;
  const second = (await post({ op: "replay-fork", ...input, requestId: "list-second" })).body.slug;
  const otherOwner = (await post({ op: "replay-fork", ...input, requestId: "list-other", playerId: 62, userId: 102 })).body.slug;
  const otherGuild = (await post({ op: "replay-fork", ...input, requestId: "list-other-guild" })).body.slug;
  seedIdentity(db, { guildId: "other-guild", playerId: 71, userId: 101 });
  db.prepare("update duels set guild_id = 'other-guild', organizer_player_id = 71 where web_slug = ?").run(otherGuild);
  db.prepare("update duel_seats set player_id = 71 where duel_id = (select id from duels where web_slug = ?) and seat = 0").run(otherGuild);
  db.prepare("update duels set created_at = '2020-01-01 00:00:00', last_activity_at = '2020-01-02 00:00:00' where web_slug in (?, ?)")
    .run(first, second);
  const workerCount = workers.length, reads = workers.map(w => vi.spyOn(w, "view"));
  const result = await post({ op: "fork-list", slug: undefined });
  expect(result.response.status).toBe(200);
  expect(result.body).toEqual({ limit: 4, forks: [second, first].map(forkSlug => ({ slug: forkSlug, sourceSlug: slug,
    format: "1v1", createdAt: "2020-01-01 00:00:00", lastActivityAt: "2020-01-02 00:00:00" })) });
  expect((await post({ op: "fork-list", slug: undefined, playerId: 62, userId: 102 })).body.forks.map((f: any) => f.slug)).toEqual([otherOwner]);
  expect((await post({ op: "fork-list", slug: undefined, guildId: "other-guild", playerId: 71 })).body.forks.map((f: any) => f.slug)).toEqual([otherGuild]);
  expect(workers).toHaveLength(workerCount); for (const read of reads) expect(read).not.toHaveBeenCalled();
  expect(sourceRows()).toEqual(before);
});
it("returns an empty fork list without a source or worker", async () => {
  db.prepare("delete from duels where web_slug = ?").run(slug);
  const result = await post({ op: "fork-list", slug: undefined });
  expect(result.response.status).toBe(200); expect(result.body).toEqual({ forks: [], limit: 4 }); expect(workers).toHaveLength(0);
});
it.each(["cancelled", "completed", "interrupted"] as const)("excludes %s forks from the active list", async status => {
  const fork = (await post({ op: "replay-fork", ...request() })).body.slug;
  db.prepare("update duels set status = ? where web_slug = ?").run(status, fork);
  expect((await post({ op: "fork-list", slug: undefined })).body).toEqual({ forks: [], limit: 4 });
});
it("lists formats and stored origins after source deletion with activity fallback", async () => {
  source("ffa4");
  const sourceSlug = slug, fork = (await post({ op: "replay-fork", ...request() })).body.slug;
  db.prepare("update duels set created_at = '2020-01-01 00:00:00', last_activity_at = null where web_slug = ?").run(fork);
  db.prepare("delete from duels where web_slug = ?").run(sourceSlug);
  expect((await post({ op: "fork-list", slug: undefined })).body).toEqual({ limit: 4, forks: [{ slug: fork, sourceSlug,
    format: "ffa4", createdAt: "2020-01-01 00:00:00", lastActivityAt: "2020-01-01 00:00:00" }] });
  expect((await post({ op: "fork-cancel", slug: fork })).response.status).toBe(200);
  expect((await post({ op: "fork-list", slug: undefined })).body.forks).toEqual([]);
  expect(workers[0]!.running).toBe(false);
});
it("reports accepted answers as activity without changing timestamps on list reads", async () => {
  const fork = (await post({ op: "replay-fork", ...request() })).body.slug;
  db.prepare("update duels set last_activity_at = '2020-01-01 00:00:00' where web_slug = ?").run(fork);
  expect((await post({ op: "fork-list", slug: undefined })).body.forks[0].lastActivityAt).toBe("2020-01-01 00:00:00");
  const room = (await post({ op: "view", slug: fork })).body;
  expect((await post({ op: "respond", slug: fork, command: { promptId: room.engine.prompt.id,
    revision: room.engine.revision, answer: { choice: "next" } } })).response.status).toBe(200);
  const activity = db.prepare("select last_activity_at from duels where web_slug = ?").get(fork) as { last_activity_at: string };
  expect(activity.last_activity_at).not.toBe("2020-01-01 00:00:00");
  expect((await post({ op: "fork-list", slug: undefined })).body.forks[0].lastActivityAt).toBe(activity.last_activity_at);
});
it("counts a restarted fork as one in-progress Table for worker admission", async () => {
  await host.close(); startHost({ maxWorkers: 3, maxTablesPerPlayer: 1 });
  const input = request();
  const launched = await post({ op: "replay-fork", ...input });
  expect(launched.response.status).toBe(200);
  const forkSlug = launched.body.slug;
  expect((await post({ op: "fork-restart", slug: forkSlug })).response.status).toBe(200);
  const limited = await post({ op: "replay-fork", ...input, requestId: "second-table" });
  expect(limited.response.status).toBe(429);
  expect(limited.body).toEqual({ error: "You already have 1 live duels. Finish one first." });
  expect((await post({ op: "fork-list", slug: undefined })).body.forks.map((fork: { slug: string }) => fork.slug)).toEqual([forkSlug]);
  expect((await post({ op: "fork-cancel", slug: forkSlug })).response.status).toBe(200);
  expect((await post({ op: "replay-fork", ...input, requestId: "second-table" })).response.status).toBe(200);
});
it("removes an expired replay from the shared worker queue before capacity returns", async () => {
  await host.close(); startHost({ maxWorkers: 1, replayRequestTimeoutMs: 200 });
  const input = request();
  const launched = await post({ op: "replay-fork", ...input });
  expect(launched.response.status).toBe(200);
  const replay = await post({ op: "owner-replay" });
  expect(replay.response.status).toBe(503);
  expect(replay.body.code).toBe("ENGINE_BUSY");
  expect((await post({ op: "fork-cancel", slug: launched.body.slug })).response.status).toBe(200);
  expect((await post({ op: "replay-fork", ...input, requestId: "after-timeout" })).response.status).toBe(200);
  // Only the two successful forks allocate engines; the expired replay never starts later.
  expect(workers).toHaveLength(2);
});
it("rejects malformed acting-seat answers without advancing or journaling a fork", async () => {
  const launched = await post({ op: "replay-fork", ...request() });
  expect(launched.response.status).toBe(200);
  const forkSlug = launched.body.slug;
  const before = createReplayForkService(db).privateState(forkSlug, owner).commands;
  const command = { promptId: "p2", revision: 2, answer: { selected: [12] } };
  const invalid = await post({ op: "respond", slug: forkSlug, as: 0, command });
  expect(invalid.response.status).toBe(400);
  expect(invalid.body).toEqual({ error: "Invalid answer" });
  expect(createReplayForkService(db).privateState(forkSlug, owner).commands).toEqual(before);
  expect((await post({ op: "view", slug: forkSlug })).body.engine.revision).toBe(2);
  expect((await post({ op: "respond", slug: forkSlug, as: 0, command: { ...command, answer: { choice: "next" } } })).response.status).toBe(200);
  expect(createReplayForkService(db).privateState(forkSlug, owner).commands).toHaveLength(before.length + 1);
});
it("denies fork listing for unsigned, non-owner, forged, wrong-guild and revoked callers", async () => {
  expect((await post({ op: "fork-list", slug: undefined }, false)).response.status).toBe(401);
  for (const actor of [{ playerId: 63, userId: 103 }, { playerId: 62, userId: 101 }, { guildId: "other-guild" }]) {
    const result = await post({ op: "fork-list", slug: undefined, ...actor });
    expect(result.response.status).toBe(404); expect(result.body).toEqual({ error: "Not found", code: "ACCESS_DENIED" });
  }
  vi.stubEnv("OWNER_USER_IDS", "102");
  expect((await post({ op: "fork-list", slug: undefined })).body).toEqual({ error: "Not found", code: "ACCESS_DENIED" });
  expect(workers).toHaveLength(0);
});
it.each(["invalid creator metadata", "malformed JSON"])("skips and logs %s while retaining healthy active forks", async damage => {
  const healthy = (await post({ op: "replay-fork", ...request(), requestId: "healthy" })).body.slug;
  const bad = (await post({ op: "replay-fork", ...request(), requestId: "bad" })).body.slug;
  if (damage === "malformed JSON") db.prepare("update duels set setup_json = '{invalid' where web_slug = ?").run(bad);
  else db.prepare("update duels set setup_json = json_set(setup_json, '$.replayFork.control', 'invalid') where web_slug = ?").run(bad);
  const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const result = await post({ op: "fork-list", slug: undefined });
    expect(result.response.status).toBe(200);
    expect(result.body.forks.map((fork: any) => fork.slug)).toEqual([healthy]);
    expect(warnings).toHaveBeenCalledWith("[replay-fork] Skipping invalid active fork", { slug: bad, code: "ACCESS_DENIED" });
  } finally { warnings.mockRestore(); }
});

it.each(["1v1", "tag", "ffa3", "ffa4"] as const)("launches a private Manual %s fork with defaults after the unchanged prefix", async format => {
  source(format);
  const before = sourceRows(), result = await post({ op: "replay-fork", ...request(3) });
  expect(result.response.status).toBe(200);
  const room = result.body.room;
  expect(room).toMatchObject({ mySeat: 0, session: { kind: "replay-fork", status: "active", bestOf: 1, ranked: false },
    fork: { identitySeat: 0, actingSeat: 0, revealHands: true, manualSeats: Array.from({ length: seatCountFor(format) }, (_, i) => i) } });
  expect(room.engine.seats.map((s: any) => s.hand[0].code)).toEqual(Array.from({ length: seatCountFor(format) }, (_, i) => 900 + i));
  expect(room.engine.seats[1].monsters[0].code).toBeUndefined();
  const state = createReplayForkService(db).privateState(result.body.slug, owner);
  expect(state.commands.slice(0, 3)).toEqual(sourceState().commands);
  expect(state.commands.slice(3).map(c => [c.seat, c.command.promptId])).toEqual(
    Array.from({ length: seatCountFor(format) }, (_, i) => [i, "chain-mode:always"]));
  expect(state.setup).not.toHaveProperty("botPolicies"); expect(state.clock).toBeNull();
  expect(workers[0]!.created).toMatchObject({ seed: ["1", "2", "3", "4"], firstTurnDraw: false });
  if (format === "1v1") expect(workers[0]!.created!.engine).toBe("legacy");
  expect(sourceRows()).toEqual(before);
  expect(db.prepare("select * from duel_series").all()).toEqual([]);
  expect(db.prepare("select * from duel_invite_grants").all()).toEqual([]);
  expect(onChange.mock.calls.every(c => c[0] === result.body.slug)).toBe(true);
});
it.each([0, 1, 3])("launches prefix %s with no opening or scenario phase scripts", async count => {
  const result = await post({ op: "replay-fork", ...request(count) }); expect(result.response.status).toBe(200);
  expect(workers[0]!.created).not.toHaveProperty("startupScripts");
  expect(result.body.room.opening).toBeNull(); expect(result.body.room.engine.revision).toBe(count === 0 ? 1 : count === 3 ? 3 : 2);
});
it("follows a pending-loss prompt and asks at every living seat after launch", async () => {
  source("ffa4");
  makeWorker = () => { const w = new ForkWorker(); w.promptSeat = 2; w.pending = 2; w.eliminated = 1; return w; };
  const result = await post({ op: "replay-fork", ...request(0) });
  expect(result.response.status).toBe(200);
  expect(result.body).toMatchObject({ initialSeat: 2, room: { mySeat: 0, fork: { actingSeat: 2,
    chainModes: { 0: "always", 2: "always", 3: "always" } }, engine: { prompt: { seat: 2 } } } });
  expect(createReplayForkService(db).privateState(result.body.slug, owner).commands.map(c => c.seat)).toEqual([0, 2, 3]);
});
it("reuses a retry after source deletion and rejects a different cursor for the same key", async () => {
  const input = request(), result = await post({ op: "replay-fork", ...input });
  expect(result.response.status).toBe(200);
  expect((await post({ op: "replay-fork", ...request(0) })).body.code).toBe("REQUEST_CONFLICT");
  db.prepare("delete from duels where web_slug = ?").run(slug);
  const retry = await post({ op: "replay-fork", ...input }); expect(retry.response.status).toBe(200);
  expect(retry.body.slug).toBe(result.body.slug); expect(workers).toHaveLength(1);
});
it("does not offer checkpoints to fork a fork's owner replay", async () => {
  const fork = await post({ op: "replay-fork", ...request() });
  expect(fork.response.status).toBe(200);
  createDuelService(db).interrupt(fork.body.slug, owner.guildId, "Owner replay fixture");
  const replay = await post({ op: "owner-replay", slug: fork.body.slug });
  expect(replay.response.status).toBe(200);
  expect(replay.body.capabilities.canFork).toBe(false);
  expect(replay.body.frames.length).toBeGreaterThan(0);
  expect(replay.body.frames.every((frame: { cursor: string | null }) => frame.cursor === null)).toBe(true);
});
it.each([0, 4])("rejects a fork source before engine work or quota checks with %s active forks", async count => {
  const sourceSlug = slug, input = request();
  const sourceFork = await post({ op: "replay-fork", ...input, requestId: "source-fork" });
  expect(sourceFork.response.status).toBe(200);
  const forkSlug = sourceFork.body.slug;
  createDuelService(db).interrupt(forkSlug, owner.guildId, "Fork source fixture");
  for (let index = 0; index < count; index++) {
    const fork = await post({ op: "replay-fork", ...input, requestId: `seed-fork-${index}` });
    expect(fork.response.status).toBe(200);
  }
  slug = forkSlug;
  const nested = { ...request(), requestId: "nested-fork" };
  resourceRead.mockClear();
  const result = await post({ op: "replay-fork", ...nested });
  expect(result.response.status).toBe(409);
  expect(result.body).toEqual({ error: "A replay fork cannot be forked", code: "NOT_PLAYABLE" });
  expect(resourceRead).not.toHaveBeenCalled();
  expect(workers).toHaveLength(count + 1);
  if (count === 0) {
    const valid = await post({ op: "replay-fork", slug: sourceSlug, ...input, requestId: "valid-after-refusal" });
    expect(valid.response.status).toBe(200);
  }
});
it("deduplicates concurrent launch retries", async () => {
  const input = request(); const results = await Promise.all([post({ op: "replay-fork", ...input }), post({ op: "replay-fork", ...input })]);
  expect(results.map(r => r.response.status)).toEqual([200, 200]); expect(results[0]!.body.slug).toBe(results[1]!.body.slug);
  expect(workers.filter(w => w.running)).toHaveLength(1);
});
it("rejects bad cursor, changed source/version, active source and terminal engine", async () => {
  expect((await post({ op: "replay-fork", ...request(), cursor: "bad" })).body.code).toBe("INVALID_CURSOR");
  expect((await post({ op: "replay-fork", ...request(), sourceVersion: "other" })).body.code).toBe("SOURCE_CHANGED");
  const old = request(); db.prepare("update duels set master_rule = 4 where web_slug = ?").run(slug);
  expect((await post({ op: "replay-fork", ...old })).body.code).toBe("SOURCE_CHANGED");
  db.prepare("update duels set status = 'active' where web_slug = ?").run(slug);
  expect((await post({ op: "replay-fork", ...request() })).body.code).toBe("NOT_PLAYABLE");
  db.prepare("update duels set status = 'interrupted' where web_slug = ?").run(slug);
  makeWorker = () => { const w = new ForkWorker(); w.result = { winnerSeat: 0, reason: "Won" }; return w; };
  expect((await post({ op: "replay-fork", ...request(0) })).body.code).toBe("NOT_PLAYABLE");
  expect(workers.every(w => !w.running)).toBe(true);
});
it("denies alpha, host forgery, wrong guild, revoked owner and unsigned launch before worker creation", async () => {
  const input = request();
  for (const actor of [{ playerId: 63, userId: 103 }, { playerId: 63, userId: 101 }, { guildId: "other-guild" }]) {
    expect((await post({ op: "replay-fork", ...input, ...actor })).response.status).toBe(404);
  }
  expect((await post({ op: "replay-fork", ...input }, false)).response.status).toBe(401);
  vi.stubEnv("OWNER_USER_IDS", ""); expect((await post({ op: "replay-fork", ...input })).response.status).toBe(404);
  expect(workers).toHaveLength(0);
});
it("cleans up on resource, target, transaction and registration failures", async () => {
  vi.mocked(EngineResourceCache.prototype.get).mockRejectedValueOnce(new EngineResourceUnavailableError("source core is missing"));
  expect((await post({ op: "replay-fork", ...request() })).body.code).toBe("ENGINE_UNAVAILABLE_FOR_SOURCE");
  db.prepare("update duels set bundle_version = ? where web_slug = ?").run("test-bundle", slug);
  makeWorker = () => { const w = new ForkWorker(); w.revision = 90; return w; };
  expect((await post({ op: "replay-fork", ...request(0) })).body.code).toBe("REPLAY_MISMATCH");
  makeWorker = () => new ForkWorker();
  db.exec("create trigger fail_fork before insert on replay_fork_requests begin select raise(abort, 'fixture failure'); end");
  expect((await post({ op: "replay-fork", ...request() })).response.status).toBe(503);
  expect(db.prepare("select * from duels where kind = 'replay-fork'").all()).toEqual([]);
  db.exec("drop trigger fail_fork");
  makeWorker = () => {
    const w = new ForkWorker(); let alive = true;
    Object.defineProperty(w, "running", { get: () => alive && !db.prepare("select id from duels where kind = 'replay-fork'").get(),
      set: value => { alive = value; } });
    return w;
  };
  const failed = await post({ op: "replay-fork", ...request() }); expect(failed.response.status).toBe(503);
  expect(db.prepare("select status from duels where kind = 'replay-fork'").get()).toEqual({ status: "cancelled" });
  expect(workers.every(w => !w.running)).toBe(true); expect(createDuelService(db).get(slug, owner.guildId).status).toBe("interrupted");
});
it("bounds a stuck detached worker and leaves no stored fork", async () => {
  await host.close(); startHost({ forkTimeoutMs: 20 });
  makeWorker = () => { const w = new ForkWorker(); w.create = async () => new Promise(() => {}); return w; };
  const result = await post({ op: "replay-fork", ...request() });
  expect(result.response.status).toBe(503); expect(result.body.code).toBe("ENGINE_BUSY");
  expect(workers[0]!.running).toBe(false); expect(db.prepare("select * from replay_fork_requests").all()).toEqual([]);
});
it("closes an expired launch and prevents a late fork commit", async () => {
  await host.close(); startHost({ replayRequestTimeoutMs: 20 });
  let release!: () => void;
  makeWorker = () => {
    const worker = new ForkWorker();
    worker.create = async () => new Promise<void>(resolve => { release = resolve; });
    return worker;
  };
  const result = await post({ op: "replay-fork", ...request() });
  expect(result.response.status).toBe(503); expect(result.body.code).toBe("ENGINE_BUSY");
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(workers[0]!.running).toBe(false);
  release(); await new Promise<void>(resolve => setImmediate(resolve));
  expect(db.prepare("select * from replay_fork_requests").all()).toEqual([]);
  expect(db.prepare("select * from duels where kind = 'replay-fork'").all()).toEqual([]);
});
it.each(["fork-restart", "fork-cancel"])("expires queued %s before the web deadline and never mutates it later", async op => {
  await host.close(); startHost({ replayRequestTimeoutMs: 20 });
  const launch = await post({ op: "replay-fork", ...request() });
  expect(launch.response.status).toBe(200);
  const worker = workers[0]!, answer = worker.answer.bind(worker);
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  worker.answer = async (...args) => {
    started(); await new Promise<void>(resolve => { release = resolve; }); await answer(...args);
  };
  const responding = post({ op: "respond", slug: launch.body.slug,
    command: { promptId: "p2", revision: 2, answer: { choice: "next" } } });
  await ready;
  try {
    const result = await Promise.race([post({ op, slug: launch.body.slug }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${op} missed its request deadline`)), 500))]);
    expect(result.response.status).toBe(503); expect(result.body.code).toBe("ENGINE_BUSY");
  } finally { release(); await responding; }
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(workers).toHaveLength(1);
  expect((await post({ op: "view", slug: launch.body.slug })).body.engine.revision).toBe(3);
  expect(createDuelService(db).get(launch.body.slug, owner.guildId).status).toBe("active");
});
it.each([0, 1, 2, 3])("binds views, answers and announcement search to acting seat %s", async seat => {
  source("ffa4"); const launch = await post({ op: "replay-fork", ...request() }); expect(launch.response.status).toBe(200);
  const forkSlug = launch.body.slug, worker = workers[0]!; worker.promptSeat = seat; worker.announce = true; worker.pending = seat;
  const view = await post({ op: "view", slug: forkSlug, as: seat, reveal: false });
  expect(view.body).toMatchObject({ mySeat: 0, fork: { actingSeat: seat, revealHands: false }, engine: { prompt: { seat, kind: "announce-card" } } });
  expect(view.body.engine.seats.filter((s: any) => s.hand[0].code !== undefined).map((s: any) => s.seat)).toEqual([seat]);
  const binding = { slug: forkSlug, as: seat, promptId: "p2", revision: 2 };
  expect((await post({ op: "cards", query: "Card", ...binding })).response.status).toBe(200);
  for (const bad of [{ as: (seat + 1) % 4 }, { promptId: "old" }, { revision: 1 }, { as: 4 }, { playerId: 63, userId: 103 }]) {
    expect((await post({ op: "cards", query: "Card", ...binding, ...bad })).response.status).toBeGreaterThanOrEqual(400);
  }
  expect((await post({ op: "respond", slug: forkSlug, as: seat, command: { promptId: "old", revision: 2, answer: {} } })).response.status).toBe(409);
  expect((await post({ op: "respond", slug: forkSlug, as: seat, command: { promptId: "p2", revision: 2, answer: { card: 100 } } })).response.status).toBe(200);
  expect(worker.revision).toBe(3);
});
it("recovers and restarts from its copied prefix after source deletion with all seats Manual", async () => {
  source("ffa4"); const result = await post({ op: "replay-fork", ...request(3) }); expect(result.response.status).toBe(200);
  const forkSlug = result.body.slug;
  await post({ op: "respond", slug: forkSlug, command: { promptId: "p3", revision: 3, answer: { choice: "next" } } });
  db.prepare("delete from duels where web_slug = ?").run(slug); await host.close(); startHost();
  const recovered = await post({ op: "view", slug: forkSlug }); expect(recovered.body.engine.revision).toBe(4);
  const restart = await post({ op: "fork-restart", slug: forkSlug }); expect(restart.response.status).toBe(200);
  expect(restart.body.engine.revision).toBe(3); expect(restart.body.fork.manualSeats).toEqual([0, 1, 2, 3]);
  expect(createReplayForkService(db).privateState(forkSlug, owner).commands).toHaveLength(7);
  expect((await post({ op: "fork-restart", slug: forkSlug, playerId: 62, userId: 102 })).response.status).toBe(404);
  expect((await post({ op: "view", slug: forkSlug, userId: 102 })).response.status).toBe(404);
  expect((await post({ op: "fork-cancel", slug: forkSlug })).response.status).toBe(200);
  expect(createDuelService(db).get(forkSlug, owner.guildId).status).toBe("cancelled");
  expect((await post({ op: "fork-restart", slug: forkSlug })).response.status).toBe(200);
});
it("rejects fork admission/series operations and rejects acting seats on real play", async () => {
  const launch = await post({ op: "replay-fork", ...request() }); expect(launch.response.status).toBe(200);
  for (const op of ["start", "ready", "unready", "deck", "validate-deck", "add-bot", "opening-pick", "opening-choose", "series-first", "series-side", "series-ready", "series-unready"]) {
    expect((await post({ op, slug: launch.body.slug })).response.status).toBe(409);
  }
  for (const op of ["view", "respond", "chain-mode", "cards", "surrender"]) {
    expect((await post({ op, slug, playerId: 64, userId: 201, as: 1 })).response.status).toBe(400);
  }
});

it("refuses a changed source or revoked owner during the detached run", async () => {
  const before = sourceRows(), input = request();
  makeWorker = () => {
    const w = new ForkWorker(), create = w.create.bind(w);
    w.create = async options => { await create(options); db.prepare("update duels set master_rule = 4 where web_slug = ?").run(slug); };
    return w;
  };
  expect((await post({ op: "replay-fork", ...input })).body.code).toBe("SOURCE_CHANGED");
  expect(db.prepare("select * from replay_fork_requests").all()).toEqual([]);
  expect(sourceRows().slice(1)).toEqual(before.slice(1)); expect(workers[0]!.running).toBe(false);
  makeWorker = () => {
    const w = new ForkWorker(), create = w.create.bind(w);
    w.create = async options => { await create(options); vi.stubEnv("OWNER_USER_IDS", ""); };
    return w;
  };
  const result = await post({ op: "replay-fork", ...request() });
  expect(result.response.status).toBe(404); expect(result.body.code).toBe("ACCESS_DENIED");
  expect(db.prepare("select * from replay_fork_requests").all()).toEqual([]); expect(workers.every(w => !w.running)).toBe(true);
});
it.each(["replay-fork", "fork-restart", "fork-cancel"])("rechecks creator access after the %s event wait", async op => {
  const launch = op !== "replay-fork" ? await post({ op: "replay-fork", ...request() }) : null;
  onChange.mockImplementation(() => { vi.stubEnv("OWNER_USER_IDS", ""); });
  const result = await post(op === "replay-fork" ? { op, ...request() } : { op, slug: launch!.body.slug });
  expect(result.response.status).toBe(404); expect(result.body.code).toBe("ACCESS_DENIED");
  expect(result.body).not.toHaveProperty("engine"); expect(result.body).not.toHaveProperty("room");
});
it.each(["debug-trace", "bug-context"])("rechecks creator access after %s reads the worker", async op => {
  vi.stubEnv("DUEL_SCENARIOS", "1");
  const launch = await post({ op: "replay-fork", ...request() });
  const w = workers[0]!, view = w.view.bind(w);
  w.view = async seat => { const result = await view(seat); vi.stubEnv("OWNER_USER_IDS", ""); return result; };
  const result = await post({ op, slug: launch.body.slug });
  expect(result.response.status).toBe(404); expect(result.body).toMatchObject({ code: "ACCESS_DENIED" });
});
it("refuses unsequenced old losses instead of applying the source final losses to a prefix", async () => {
  db.prepare("update duels set setup_json = json_set(setup_json, '$.surrenderedSeats', json('[1]')) where web_slug = ?").run(slug);
  expect((await post({ op: "replay-fork", ...request(0) })).body.code).toBe("NOT_PLAYABLE"); expect(workers).toHaveLength(0);
});
it("limits active forks, permits exact retries at the limit, and allows a new fork after cancel", async () => {
  const input = request(); let first: any;
  for (let i = 0; i < 4; i++) {
    const result = await post({ op: "replay-fork", ...input, requestId: `limit-${i}` });
    expect(result.response.status).toBe(200); first ??= result.body;
  }
  const limited = await post({ op: "replay-fork", ...input, requestId: "limit-4" });
  expect(limited.response.status).toBe(429); expect(limited.body).toEqual(forkLimitBody);
  expect((await post({ op: "replay-fork", ...input, requestId: "limit-0" })).body.slug).toBe(first.slug);
  const listed = (await post({ op: "fork-list", slug: undefined })).body.forks;
  expect(listed).toHaveLength(4);
  await post({ op: "fork-cancel", slug: listed.find((fork: any) => fork.slug === first.slug).slug });
  expect((await post({ op: "fork-list", slug: undefined })).body.forks).toHaveLength(3);
  expect((await post({ op: "replay-fork", ...input, requestId: "limit-4" })).response.status).toBe(200);
  const restart = await post({ op: "fork-restart", slug: first.slug });
  expect(restart.response.status).toBe(429); expect(restart.body).toEqual(forkLimitBody);
  const active = db.prepare("select web_slug as slug from duels where kind = 'replay-fork' and status = 'active' limit 1").get() as { slug: string };
  expect((await post({ op: "fork-restart", slug: active.slug })).response.status).toBe(200);
});
it.each(["invalid creator metadata", "malformed JSON"])("excludes %s from the launch and restart quota", async damage => {
  const input = request(), before = sourceRows();
  for (let i = 0; i < 3; i++) {
    expect((await post({ op: "replay-fork", ...input, requestId: `healthy-${i}` })).response.status).toBe(200);
  }
  const bad = await post({ op: "replay-fork", ...input, requestId: "bad-quota",
    ...(damage === "malformed JSON" ? { playerId: 62, userId: 102 } : {}) });
  expect(bad.response.status).toBe(200);
  if (damage === "malformed JSON") db.prepare("update duels set setup_json = '{invalid' where web_slug = ?").run(bad.body.slug);
  else db.prepare("update duels set setup_json = json_set(setup_json, '$.replayFork.control', 'invalid') where web_slug = ?").run(bad.body.slug);
  const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect((await post({ op: "fork-list", slug: undefined })).body.forks).toHaveLength(3);
    expect((await post({ op: "fork-cancel", slug: bad.body.slug })).response.status).toBe(404);
    const launched = await post({ op: "replay-fork", ...input, requestId: "healthy-fourth" });
    expect(launched.response.status).toBe(200);
    expect((await post({ op: "fork-list", slug: undefined })).body.forks).toHaveLength(4);
    const limited = await post({ op: "replay-fork", ...input, requestId: "healthy-fifth" });
    expect(limited.response.status).toBe(429); expect(limited.body).toEqual(forkLimitBody);
    expect((await post({ op: "fork-restart", slug: launched.body.slug })).response.status).toBe(200);
    expect((await post({ op: "fork-cancel", slug: launched.body.slug })).response.status).toBe(200);
    expect((await post({ op: "fork-restart", slug: launched.body.slug })).response.status).toBe(200);
    expect((await post({ op: "fork-list", slug: undefined })).body.forks).toHaveLength(4);
    expect(sourceRows()).toEqual(before);
  } finally { warnings.mockRestore(); }
});
it.each(["replay-fork", "fork-restart"])("returns fork recovery data when the quota fills during detached %s", async op => {
  const input = request(); let first: string | undefined;
  for (let i = 0; i < 4; i++) {
    const result = await post({ op: "replay-fork", ...input, requestId: `race-${i}` });
    expect(result.response.status).toBe(200); first ??= result.body.slug;
  }
  await post({ op: "fork-cancel", slug: first });
  const state = createReplayForkService(db).privateState(first!, owner);
  makeWorker = () => {
    createReplayForkService(db).create({ actor: owner, requestId: "concurrent-quota", cursorDigest: "b".repeat(64),
      source: sourceState(), origin: state.setup!.replayFork!.origin });
    return new ForkWorker();
  };
  const result = await post(op === "replay-fork" ? { op, ...input, requestId: "late-quota" } : { op, slug: first });
  expect(result.response.status).toBe(429); expect(result.body).toEqual(forkLimitBody);
  expect((await post({ op: "fork-list", slug: undefined })).body.forks).toHaveLength(4);
  expect(workers.at(-1)!.running).toBe(false);
  expect(createReplayForkService(db).privateState(first!, owner)).toEqual(state);
});
it("keeps the fork's previous journal and worker if restart validation fails", async () => {
  const launch = await post({ op: "replay-fork", ...request() });
  const forkSlug = launch.body.slug, before = createReplayForkService(db).privateState(forkSlug, owner);
  makeWorker = () => { const w = new ForkWorker(); w.revision = 90; return w; };
  expect((await post({ op: "fork-restart", slug: forkSlug })).body.code).toBe("REPLAY_MISMATCH");
  expect(createReplayForkService(db).privateState(forkSlug, owner)).toEqual(before);
  expect(workers[0]!.running).toBe(true); expect(workers[1]!.running).toBe(false);
});
it("restores the exact previous branch and board when restart registration fails", async () => {
  const launch = await post({ op: "replay-fork", ...request() }), forkSlug = launch.body.slug;
  await post({ op: "respond", slug: forkSlug, command: { promptId: "p2", revision: 2, answer: { choice: "next" } } });
  const before = [db.prepare("select * from duels where web_slug = ?").get(forkSlug),
    db.prepare("select * from duel_commands where duel_id = (select id from duels where web_slug = ?) order by seq").all(forkSlug)];
  makeWorker = () => {
    const w = new ForkWorker(); let alive = true;
    Object.defineProperty(w, "running", { get: () => alive && createReplayForkService(db).privateState(forkSlug, owner).commands.length > 3,
      set: value => { alive = value; } });
    return w;
  };
  expect((await post({ op: "fork-restart", slug: forkSlug })).body.code).toBe("ENGINE_BUSY");
  expect([db.prepare("select * from duels where web_slug = ?").get(forkSlug),
    db.prepare("select * from duel_commands where duel_id = (select id from duels where web_slug = ?) order by seq").all(forkSlug)]).toEqual(before);
  expect(workers[0]!.running).toBe(true); expect(workers[1]!.running).toBe(false);
  expect((await post({ op: "view", slug: forkSlug })).body.engine.revision).toBe(3);
});
it("does not commit after a detached worker completes past the deadline", async () => {
  await host.close(); startHost({ forkTimeoutMs: 20 });
  let complete!: () => void;
  makeWorker = () => {
    const w = new ForkWorker(), create = w.create.bind(w);
    w.create = async options => { await create(options); await new Promise<void>(resolve => { complete = resolve; }); };
    return w;
  };
  expect((await post({ op: "replay-fork", ...request() })).body.code).toBe("ENGINE_BUSY");
  complete(); await new Promise(resolve => setTimeout(resolve, 10));
  expect(db.prepare("select * from replay_fork_requests").all()).toEqual([]);
  expect(workers[0]!.running).toBe(false);
});
it("binds fork chain-mode changes to the current revision and optional prompt", async () => {
  const launch = await post({ op: "replay-fork", ...request() }), forkSlug = launch.body.slug;
  const command = { op: "chain-mode", slug: forkSlug, as: 1, mode: "off", revision: 2 };
  expect((await post({ ...command, revision: 1 })).response.status).toBe(409);
  expect((await post({ ...command, promptId: "p2" })).response.status).toBe(409);
  expect((await post({ ...command, revision: undefined })).response.status).toBe(400);
  const result = await post(command); expect(result.response.status).toBe(200);
  expect(result.body.fork).toMatchObject({ actingSeat: 1, chainModes: { 0: "always", 1: "off" } });
});
it("keeps acting-seat controls and creator checks in a blocked queue fallback", async () => {
  await host.close(); startHost({ queueBlockedMs: 20 });
  const launch = await post({ op: "replay-fork", ...request() }), forkSlug = launch.body.slug;
  const w = workers[0]!, answer = w.answer.bind(w);
  let complete!: () => void;
  w.answer = async (seat, id, input) => { await new Promise<void>(resolve => { complete = resolve; }); await answer(seat, id, input); };
  const waiting = post({ op: "respond", slug: forkSlug, command: { revision: 2, promptId: "p2", answer: { choice: "next" } } });
  await new Promise(resolve => setTimeout(resolve, 5));
  try {
    const stale = await post({ op: "view", slug: forkSlug, as: 1, reveal: false });
    expect(stale.body).toMatchObject({ stale: true, mySeat: 0, fork: { actingSeat: 1, revealHands: false } });
    expect(stale.body.engine.seats[0].hand[0].code).toBeUndefined(); expect(stale.body.engine.seats[1].hand[0].code).toBe(901);
    const forged = await post({ op: "view", slug: forkSlug, as: 1, userId: 102 });
    expect(forged.response.status).toBe(404); expect(forged.body).not.toHaveProperty("engine");
  } finally { complete(); await waiting; }
});

it("recovers a committed fork without the detached launch time limit", async () => {
  const launch = await post({ op: "replay-fork", ...request() }); expect(launch.response.status).toBe(200);
  await host.close(); startHost({ forkTimeoutMs: 10 });
  makeWorker = () => {
    const worker = new ForkWorker(), answer = worker.answer.bind(worker);
    worker.answer = async (...args) => { await new Promise(resolve => setTimeout(resolve, 30)); await answer(...args); };
    return worker;
  };
  const view = await post({ op: "view", slug: launch.body.slug });
  expect(view.response.status).toBe(200); expect(view.body.engine.revision).toBe(2);
});

it("launches an open cursor after the source is archived and players are renamed", async () => {
  const input = request();
  db.prepare("update duels set archived_at = datetime('now'), name = 'New name' where web_slug = ?").run(slug);
  db.prepare("update players set display_name = 'Renamed' where id = 64").run();
  expect((await post({ op: "replay-fork", ...input })).response.status).toBe(200);
});
it("serializes launch retry recovery with a normal view and keeps one fork worker", async () => {
  const input = request(), launch = await post({ op: "replay-fork", ...input });
  expect(launch.response.status).toBe(200); await workers[0]!.close();
  const results = await Promise.all([post({ op: "replay-fork", ...input }), post({ op: "view", slug: launch.body.slug })]);
  expect(results.map(result => result.response.status)).toEqual([200, 200]);
  expect(workers).toHaveLength(2); expect(workers.filter(worker => worker.running)).toHaveLength(1);
});
it("reports ENGINE_BUSY when restart overlaps the same owner's detached launch", async () => {
  const first = await post({ op: "replay-fork", ...request() }); expect(first.response.status).toBe(200);
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  makeWorker = () => {
    const worker = new ForkWorker(), create = worker.create.bind(worker);
    worker.create = async options => { started(); await new Promise<void>(resolve => { release = resolve; }); await create(options); };
    return worker;
  };
  const launch = post({ op: "replay-fork", ...request(), requestId: "second-launch" }); await ready;
  try {
    const restart = await post({ op: "fork-restart", slug: first.body.slug });
    expect(restart.response.status).toBe(503); expect(restart.body.code).toBe("ENGINE_BUSY");
  } finally { release(); await launch; }
});

it.each([0, 1, 2, 3])("surrenders acting seat %s in a fork with creator and seat checks", async seat => {
  source("ffa4"); const launch = await post({ op: "replay-fork", ...request() });
  expect(launch.response.status).toBe(200);
  const forkSlug = launch.body.slug;
  expect((await post({ op: "surrender", slug: forkSlug, as: 4 })).response.status).toBe(400);
  expect((await post({ op: "surrender", slug: forkSlug, as: seat, playerId: 62, userId: 102 })).response.status).toBe(404);
  const result = await post({ op: "surrender", slug: forkSlug, as: seat });
  expect(result.response.status).toBe(200); expect(workers[0]!.eliminated).toBe(seat);
  expect(result.body.fork.actingSeat).toBe(seat);
  expect(createReplayForkService(db).privateState(forkSlug, owner).commands.at(-1)!.seat).toBe(seat);
});
it("surrenders seat one of a two-seat fork", async () => {
  const launch = await post({ op: "replay-fork", ...request() });
  const result = await post({ op: "surrender", slug: launch.body.slug, as: 1 });
  expect(result.response.status).toBe(200); expect(result.body.session.winnerSeat).toBe(0);
});
it("stops an in-flight launch before commit during shutdown and permits its retry", async () => {
  const input = request();
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  makeWorker = () => {
    const worker = new ForkWorker(), create = worker.create.bind(worker);
    worker.create = async options => { await create(options); started(); await new Promise<void>(resolve => { release = resolve; }); };
    return worker;
  };
  const launch = post({ op: "replay-fork", ...input }); await ready;
  const closing = host.close(); release();
  const result = await launch; await closing;
  expect(result.response.status).toBe(503); expect(result.body.code).toBe("ENGINE_BUSY");
  expect(db.prepare("select * from duels where kind = 'replay-fork'").all()).toEqual([]);
  expect(db.prepare("select * from replay_fork_requests").all()).toEqual([]);
  expect(workers.every(worker => !worker.running)).toBe(true);
  makeWorker = () => new ForkWorker(); startHost();
  expect((await post({ op: "replay-fork", ...input })).response.status).toBe(200);
});
it("preserves a committed fork when shutdown interrupts its restart", async () => {
  const launch = await post({ op: "replay-fork", ...request() }), forkSlug = launch.body.slug;
  const before = createReplayForkService(db).privateState(forkSlug, owner);
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  makeWorker = () => {
    const worker = new ForkWorker(), create = worker.create.bind(worker);
    worker.create = async options => { await create(options); started(); await new Promise<void>(resolve => { release = resolve; }); };
    return worker;
  };
  const restart = post({ op: "fork-restart", slug: forkSlug }); await ready;
  const closing = host.close(); release();
  expect((await restart).response.status).toBe(503); await closing;
  expect(createReplayForkService(db).privateState(forkSlug, owner)).toEqual(before);
  expect(workers.every(worker => !worker.running)).toBe(true);
  makeWorker = () => new ForkWorker(); startHost();
  expect((await post({ op: "view", slug: forkSlug })).response.status).toBe(200);
});

it.each(["fork-restart", "replay-fork"])("keeps an expired cancelled fork while %s is queued", async op => {
  vi.stubEnv("DUEL_SNAPSHOT_RETENTION_ENABLED", "1");
  db.pragma("foreign_keys=on");
  const jobs = await import("@yugidraft/shared/services");
  const job = vi.spyOn(jobs, "runDuelSnapshotRetention");
  const input = request();
  const launched = await post({ op: "replay-fork", ...input });
  const forkSlug = launched.body.slug;
  expect((await post({ op: "fork-cancel", slug: forkSlug })).response.status).toBe(200);
  db.prepare("update duels set ended_at=datetime('now','-8 days'),turn_count=12,snapshot_compacted_at='2026-10-01' where web_slug=?").run(forkSlug);
  const control = await post({ op: "replay-fork", ...request(), playerId: 62, userId: 102, requestId: "retention-control" });
  expect(control.response.status).toBe(200);
  expect((await post({ op: "fork-cancel", slug: control.body.slug, playerId: 62, userId: 102 })).response.status).toBe(200);
  db.prepare("update duels set ended_at=datetime('now','-8 days'),turn_count=12 where web_slug=?").run(control.body.slug);
  await host.close();
  vi.useFakeTimers();
  startHost();
  await vi.advanceTimersByTimeAsync(59_000);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { started = resolve; });
  makeWorker = () => {
    const worker = new ForkWorker(), create = worker.create.bind(worker);
    worker.create = async options => { await create(options); started(); await gate; };
    return worker;
  };
  if (op === "replay-fork") onChange.mockImplementation(async eventSlug => { if (eventSlug === forkSlug) { started(); await gate; } });
  const restarting = op === "fork-restart" ? post({ op, slug: forkSlug }) : post({ op, ...input });
  try {
    await Promise.race([ready, restarting.then(result => { throw new Error(`Queued request finished early: ${JSON.stringify(result.body)}`); })]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(job).toHaveBeenCalledTimes(1);
    expect(db.prepare("select id from duels where web_slug=?").get(control.body.slug)).toBeUndefined();
    expect(db.prepare("select status from duels where web_slug=?").get(forkSlug)).toEqual({ status: "cancelled" });
    expect(db.prepare("select * from replay_fork_requests where fork_duel_id=(select id from duels where web_slug=?)").all(forkSlug)).toHaveLength(1);
    release();
    expect((await restarting).response.status).toBe(200);
    expect(createDuelService(db).get(forkSlug, owner.guildId).status).toBe(op === "fork-restart" ? "active" : "cancelled");
    expect(db.prepare("select turn_count,snapshot_compacted_at from duels where web_slug=?").get(forkSlug))
      .toEqual(op === "fork-restart" ? { turn_count: null, snapshot_compacted_at: null } : { turn_count: 12, snapshot_compacted_at: "2026-10-01" });
  } finally {
    release(); await restarting; await host.close(); job.mockRestore(); vi.useRealTimers();
  }
});

it.each(["ffa4", "tag"] as const)("decodes a gzip %s fork seat list once for a terminal reveal", async format => {
  const { gzipSync } = await import("node:zlib");
  source(format); const launched = await post({ op: "replay-fork", ...request() });
  expect(launched.response.status).toBe(200);
  const forkSlug = launched.body.slug, worker = workers.at(-1)!;
  const views = await Promise.all(Array.from({ length: seatCountFor(format) }, (_, seat) => worker.view(seat)));
  createDuelService(db).complete(forkSlug, owner.guildId, 0, "Finished", { public: await worker.view(null), seats: views });
  const row = db.prepare("select snapshot_public_json,snapshot_seats_json from duels where web_slug=?").get(forkSlug) as { snapshot_public_json: string; snapshot_seats_json: string };
  db.prepare("update duels set snapshot_public_json=?,snapshot_seats_json=? where web_slug=?").run(gzipSync(row.snapshot_public_json), gzipSync(row.snapshot_seats_json), forkSlug);
  const parse = vi.spyOn(JSON, "parse");
  try {
    const result = await post({ op: "view", slug: forkSlug, as: 3, reveal: true });
    expect(result.response.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.engine.seats.map((s: any) => s.hand[0].code)).toEqual([900, 901, 902, 903]);
    expect(parse.mock.calls.filter(([raw]) => raw === row.snapshot_seats_json)).toHaveLength(1);
  } finally { parse.mockRestore(); }
});
