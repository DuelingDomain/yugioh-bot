import Database from "better-sqlite3";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { canReadDuel, createDuelService, createDuelSeriesService, createReplayForkService,
  createSeasonService, createTournamentService, findDuelEventTarget } from "@yugidraft/shared/services";
import { createDuelConnectionToken, type DuelJoinAck, type DuelConnectionTokenClaims } from "@yugidraft/shared/ws";
import type { DuelRoom, DuelReplayV2, ReplayForkResult, DuelSession } from "@yugidraft/shared/duels";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { seedIdentity } from "./helpers/identity.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";
import { ACCEPTANCE_CASES, acceptanceSource, fixedJournal, MASTER, POKI, RECALL_JOURNAL, rotationSource } from "./support/replay-acceptance.js";

const secret = "v1-real-host-acceptance";
// Load the real WS boundary without adding another package's sources to duel-server's TS rootDir.
const wsEventsPath = "../../ws/src/duel-events.js", wsHttpPath = "../../ws/src/internal-http.js";
const { registerDuelEventHandlers } = await import(wsEventsPath);
const { createInternalHttpHandler } = await import(wsHttpPath);
type TestSocket = EventEmitter & { id: string; data: { duel?: DuelConnectionTokenClaims }; rooms: Set<string>;
  join(room: string): void; leave(room: string): void };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function fixture(record: ReturnType<typeof acceptanceSource>, game2 = false) {
  vi.stubEnv("OWNER_USER_IDS", "101"); vi.stubEnv("MULTIPLAYER_TABLES", "1");
  const db = new Database(":memory:"); migrate(db);
  const owner = { guildId: "acceptance-guild", userId: 101, playerId: 61 };
  seedIdentity(db, owner);
  for (const seat of record.source.session.seats) seedIdentity(db, { guildId: owner.guildId, userId: seat.playerId!, playerId: seat.playerId! });
  const duels = createDuelService(db), forks = createReplayForkService(db), series = createDuelSeriesService(db);
  // Real ranked results and a running bracket make the isolation checks non-empty.
  for (const id of [301, 302]) seedIdentity(db, { guildId: owner.guildId, userId: id, playerId: id });
  createSeasonService(db).start(owner.guildId, owner.userId, "Acceptance season");
  const ranked = series.createChallenge({ guildId: owner.guildId, challengerPlayerId: 301, opponentPlayerId: 302,
    mode: "normal", bestOf: 1, ranked: true, settings: { validateDeck: false } });
  for (const player of [301, 302]) duels.setDeck(ranked.duel.slug, owner.guildId, player, record.source.decks[0]!);
  duels.activate(ranked.duel.slug, owner.guildId, null, ["11", "12", "13", "14"], "ranked-fixture", null);
  duels.complete(ranked.duel.slug, owner.guildId, 0, "Ranked fixture result");
  const tournaments = createTournamentService(db), cup = tournaments.create(owner.guildId, "Acceptance Cup", "single_elim", owner.userId);
  for (const player of [301, 302]) tournaments.join(cup.id, player);
  tournaments.start(cup.id);
  let source: DuelSession;
  if (game2) {
    const game = series.createChallenge({ guildId: owner.guildId, challengerPlayerId: 201, opponentPlayerId: 202,
      mode: record.source.session.mode, bestOf: 3, ranked: false, settings: record.source.session.settings });
    for (const player of [201, 202]) duels.setDeck(game.duel.slug, owner.guildId, player, record.source.decks[player === 202 ? 0 : 1]!);
    duels.activate(game.duel.slug, owner.guildId, null, ["11", "12", "13", "14"], "game-1-fixture", null);
    duels.complete(game.duel.slug, owner.guildId, game.duel.seats.find(seat => seat.playerId === 201)!.seat, "Game 1 result");
    const sided = structuredClone(record.source.decks[0]!);
    [sided.main[39], sided.side[0]] = [sided.side[0]!, sided.main[39]!];
    series.setSideDeck(game.series.id, owner.guildId, 202, sided);
    series.setFirstChoice(game.series.id, owner.guildId, 202, "first");
    for (const player of [201, 202]) series.setSideReady(game.series.id, owner.guildId, player);
    source = series.createNextGame(game.series.id, owner.guildId);
    expect(source.seats[0]!.playerId).toBe(202);
    record.source.decks = duels.privateState(source.slug, owner.guildId).decks;
  } else {
    source = duels.create({ guildId: owner.guildId, organizerPlayerId: record.source.session.organizerPlayerId,
      name: record.source.session.name, mode: record.source.session.mode, format: record.source.session.format,
      settings: record.source.session.settings });
  }
  db.prepare("delete from duel_seats where duel_id = ?").run(source.id);
  for (const seat of record.source.session.seats) db.prepare("insert into duel_seats(duel_id,seat,player_id,ready,deck_json) values(?,?,?,1,?)")
    .run(source.id, seat.seat, seat.playerId, JSON.stringify(record.source.decks[seat.seat]));
  db.prepare("update duels set status='interrupted', seed_json=?, bundle_version=?, setup_json=? where id=?")
    .run(JSON.stringify(record.source.seed), record.source.bundleVersion,
      JSON.stringify({ ...record.source.setup, engineIdentity: record.source.engineIdentity }), source.id);
  for (const input of record.source.commands) db.prepare("insert into duel_commands(duel_id,seq,seat,command_json) values(?,?,?,?)")
    .run(source.id, input.storedSeq, input.seat, JSON.stringify(input.command));
  let host: DuelHost | undefined;
  const sockets: TestSocket[] = [];
  const io = Object.assign(new EventEmitter(), { to: (room: string) => ({ emit: (event: string, payload: unknown) => {
    for (const socket of sockets) if (socket.rooms.has(room)) socket.emit(event, payload);
  } }) });
  const events = registerDuelEventHandlers(io, { secret, canReadDuel: (claims: DuelConnectionTokenClaims) => canReadDuel(db, claims) });
  const wsHandler = createInternalHttpHandler({ io, secret, beforeDuelBroadcast: (slug: string, guildId: string) => {
    if (!findDuelEventTarget(db, slug, guildId)) return false;
    events.pruneDuelRoom(slug, guildId); return true;
  } });
  function connect(): TestSocket {
    const socket: TestSocket = Object.assign(new EventEmitter(), { id: `socket-${sockets.length}`, data: {}, rooms: new Set<string>(),
      join(room: string) { this.rooms.add(room); }, leave(room: string) { this.rooms.delete(room); } });
    sockets.push(socket); io.emit("connection", socket); return socket;
  }
  function joinRoom(slug: string, playerId: number, seat: number) {
    const socket = connect(); let result: DuelJoinAck | undefined;
    socket.emit("duel:join", { token: createDuelConnectionToken({ slug, guildId: owner.guildId, playerId, seat, expiresAt: Date.now() + 300_000 }, secret) },
      (ack: DuelJoinAck) => { result = ack; });
    expect(result?.ok).toBe(true); return socket;
  }
  const sourceSocket = joinRoom(source.slug, record.source.session.seats[0]!.playerId!, 0), guildSocket = connect();
  guildSocket.join(`guild:${owner.guildId}`);
  const leaked = vi.fn(); for (const socket of [sourceSocket, guildSocket]) {
    socket.on("duel:changed", leaked); socket.on("duel:presence", leaked);
  }
  const changes = vi.fn(async (slug: string, guildId: string) => {
    const body = JSON.stringify({ slug, guildId });
    const response = await wsHandler(new Request("http://localhost/internal/duel/changed", { method: "POST", body,
      headers: { "x-announce-signature": "sha256=" + createHmac("sha256", secret).update(body).digest("hex") } }));
    expect(response.status).toBe(204);
  });
  const notifyTournament = vi.fn(), network = vi.fn(() => { throw new Error("Unexpected external request"); });
  vi.stubGlobal("fetch", network);
  const start = () => { host = createDuelHost({ db, dataDirectory: DATA, secret, searchCards: () => [],
    pollIntervalMs: 60_000, onChange: changes, notifyTournament }); };
  async function post<T>(input: Record<string, unknown>, actor = owner, status = 200): Promise<T> {
    const raw = JSON.stringify({ ...actor, ...input });
    const response = await host!.handle(new Request("http://localhost/internal/duel", { method: "POST", body: raw,
      headers: { "x-announce-signature": "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") } }));
    const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(status); return body as T;
  }
  async function restartHost() { await host!.close(); start(); }
  async function launch(step?: number) {
    const replay = await post<DuelReplayV2>({ op: "owner-replay", slug: source.slug });
    const frame = step === undefined ? replay.frames.at(-2)! : replay.frames[step]!;
    return { replay, frame, result: await post<ReplayForkResult>({ op: "replay-fork", slug: source.slug,
      sourceVersion: replay.sourceVersion, cursor: frame.cursor, requestId: "v1-fixed-request" }) };
  }
  start(); cleanups.push(async () => { await host?.close(); for (const socket of sockets) socket.emit("disconnecting"); db.close(); });
  return { db, owner, duels, forks, source, changes, notifyTournament, network, leaked, joinRoom, post, launch, restartHost };
}

/** Every real-play row and every other application table. Only new marked fork storage can change. */
function protectedRows(db: Database.Database) {
  const tables = db.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name").all() as Array<{ name: string }>;
  return Object.fromEntries(tables.filter(({ name }) => name !== "replay_fork_requests").map(({ name }) => {
    const query = name === "duels" ? "select * from duels where kind='play' order by id"
      : ["duel_seats", "duel_commands"].includes(name) ? `select t.* from ${name} t join duels d on d.id=t.duel_id where d.kind='play' order by t.rowid`
      : `select * from ${name} order by rowid`;
    return [name, db.prepare(query).all()];
  }));
}
function checkIsolation(app: ReturnType<typeof fixture>, before: ReturnType<typeof protectedRows>, slug: string) {
  expect(protectedRows(app.db)).toEqual(before);
  expect(app.changes.mock.calls.every(([changedSlug]) => changedSlug === slug)).toBe(true);
  expect(app.leaked).not.toHaveBeenCalled(); expect(app.notifyTournament).not.toHaveBeenCalled(); expect(app.network).not.toHaveBeenCalled();
}

describeWithCores("V1 host fork acceptance", [needs.cards(DATA), needs.scripts(DATA), needs.standard(DATA), needs.domain(DATA),
  needs.installedMulti(DATA), needs.file("Domain multi core", join(DATA, "ocgcore.multi-domain.wasm")),
  needs.file("legacy Domain core", join(DATA, "ocgcore.domain.legacy.wasm")),
  needs.file("legacy Domain script", join(DATA, "card-scripts/domain.legacy.lua"))], () => {
  it.each(ACCEPTANCE_CASES)("$mode $format $engine forks a different answer, then recovers, restarts and cancels in isolation", async entry => {
    vi.stubEnv("DUEL_1V1_ENGINE", entry.engine === "legacy" ? "pinned" : "legacy");
    const app = fixture(acceptanceSource(entry)), before = protectedRows(app.db);
    expect(before.matches).toHaveLength(1); expect(before.point_awards.length).toBeGreaterThan(0);
    expect(before.player_ratings.length).toBeGreaterThan(0);
    expect(before.tournament_matches.length).toBeGreaterThan(0);
    const { replay, frame, result } = await app.launch(0);
    const request = { op: "replay-fork", slug: app.source.slug, sourceVersion: replay.sourceVersion, cursor: frame.cursor, requestId: "v1-fixed-request" };
    expect((await app.post<ReplayForkResult>(request)).slug).toBe(result.slug);
    const forkSocket = app.joinRoom(result.slug, app.owner.playerId, 0), changed = vi.fn(); forkSocket.on("duel:changed", changed);
    expect(result.room.session).toMatchObject({ kind: "replay-fork", status: "active", seriesId: null, gameNumber: null, bestOf: 1, ranked: false });
    expect(result.room.mySeat).toBe(0); expect(result.room.fork!.manualSeats).toHaveLength(entry.format === "ffa3" ? 3 : entry.format === "1v1" ? 2 : 4);
    const prompt = result.room.engine!.prompt!, summon = prompt.options.find(option => option.id.startsWith("summon:") && option.card?.code === POKI)!;
    expect(summon).toBeDefined(); expect({ choice: summon.id }).not.toEqual({ choice: "activate:0" });
    let answered = await app.post<DuelRoom>({ op: "respond", slug: result.slug, as: 0,
      command: { promptId: prompt.id, revision: result.room.engine!.revision, answer: { choice: summon.id } } });
    const placement = answered.engine!.prompt!;
    answered = await app.post<DuelRoom>({ op: "respond", slug: result.slug, as: 0,
      command: { promptId: placement.id, revision: answered.engine!.revision, answer: { selected: ["place:1"] } } });
    expect(answered.engine!.seats[0]!.monsters.some(card => card?.code === POKI)).toBe(true);
    checkIsolation(app, before, result.slug);
    await app.restartHost();
    const recovered = await app.post<DuelRoom>({ op: "view", slug: result.slug, as: answered.fork!.actingSeat });
    expect(recovered.engine).toEqual(answered.engine); expect(recovered.fork!.manualSeats).toEqual(result.room.fork!.manualSeats);
    checkIsolation(app, before, result.slug);
    const restarted = await app.post<DuelRoom>({ op: "fork-restart", slug: result.slug });
    expect(restarted.engine).toEqual(result.room.engine);
    expect(app.forks.privateState(result.slug, app.owner).commands.map(input => input.command.promptId))
      .toEqual(result.room.fork!.manualSeats.map(() => "chain-mode:always"));
    await app.post({ op: "fork-cancel", slug: result.slug }); await app.post({ op: "fork-cancel", slug: result.slug });
    expect(changed.mock.calls.length).toBeGreaterThan(0); checkIsolation(app, before, result.slug);
  }, 60_000);

  it.each(ACCEPTANCE_CASES)("$mode $format $engine keeps surrender/result/retry and restart local", async entry => {
    const record = acceptanceSource(entry);
    // A stable source with two living seats lets the creator's own surrender end FFA too.
    if (entry.format === "ffa3" || entry.format === "ffa4") record.source.commands =
      fixedJournal(Array.from({ length: record.source.decks.length - 2 }, () => ({})))
        .map((input, index) => ({ ...input, seat: index + 1, command: { ...input.command, promptId: "eliminate:0" } }));
    else record.source.commands = [];
    const app = fixture(record), before = protectedRows(app.db), { replay, frame, result } = await app.launch();
    const count = result.room.session.seats.length;
    await app.post({ op: "surrender", slug: result.slug });
    const final = await app.post<DuelRoom>({ op: "view", slug: result.slug, as: count - 1 });
    expect(final.session).toMatchObject({ status: "completed", winnerPlayerId: null, seriesId: null });
    expect(final.engine!.result).not.toBeNull();
    expect(final.engine!.prompt).toBeNull();
    const retry = await app.post<ReplayForkResult>({ op: "replay-fork", slug: app.source.slug,
      sourceVersion: replay.sourceVersion, cursor: frame.cursor, requestId: "v1-fixed-request" });
    expect(retry.slug).toBe(result.slug); expect(retry.room.session.status).toBe("completed");
    await app.restartHost();
    expect((await app.post<DuelRoom>({ op: "view", slug: result.slug, as: count - 1 })).engine).toEqual(final.engine);
    const restarted = await app.post<DuelRoom>({ op: "fork-restart", slug: result.slug }); expect(restarted.engine).toEqual(result.room.engine);
    checkIsolation(app, before, result.slug);
  }, 60_000);

  it("interrupts only the fork on failed engine recovery", async () => {
    const app = fixture(acceptanceSource({ mode: "normal", format: "1v1", engine: "legacy" }));
    const { result } = await app.launch(0), before = protectedRows(app.db);
    app.db.prepare("update duels set setup_json=json_set(setup_json, '$.engineIdentity.wrapperHash', ?) where web_slug=?")
      .run("0".repeat(64), result.slug);
    await app.restartHost();
    const error = await app.post<{ code: string }>({ op: "view", slug: result.slug }, app.owner, 409);
    expect(error.code).toBe("ENGINE_UNAVAILABLE_FOR_SOURCE");
    expect(app.duels.get(result.slug, app.owner.guildId).status).toBe("interrupted");
    // An interrupted duel uses the existing archive path; cancellation is limited to active forks.
    await app.post({ op: "fork-cancel", slug: result.slug }, app.owner, 409);
    await app.post({ op: "archive", slug: result.slug });
    checkIsolation(app, before, result.slug);
  }, 30_000);

  it.each(ACCEPTANCE_CASES.filter(entry => entry.mode === "domain"))
  ("Domain $format $engine copies the recall prefix, accepts No, and recovers that new answer", async entry => {
    const record = acceptanceSource(entry); record.source.commands = structuredClone(RECALL_JOURNAL);
    const app = fixture(record), before = protectedRows(app.db), { result } = await app.launch(4);
    const copied = app.forks.privateState(result.slug, app.owner);
    expect(copied.commands.slice(0, 4)).toEqual(record.source.commands.slice(0, 4));
    expect(copied.decks).toEqual(record.source.decks); expect(copied.seed).toEqual(record.source.seed);
    expect(copied.setup!.scriptErrorMode).toBe("strict"); expect(copied.setup!.firstTurnDraw).toBe(false);
    const prompt = result.room.engine!.prompt!; expect(prompt.context?.type).toBe("deck-master-recall");
    const answered = await app.post<DuelRoom>({ op: "respond", slug: result.slug, as: 0,
      command: { promptId: prompt.id, revision: result.room.engine!.revision, answer: { choice: "no" } } });
    expect(answered.engine!.seats[0]!.deckMaster).toMatchObject({ inZone: false, returns: 0 });
    expect(answered.engine!.seats[0]!.graveyard.map(card => card.code)).toContain(MASTER);
    await app.restartHost();
    expect((await app.post<DuelRoom>({ op: "view", slug: result.slug, as: answered.fork!.actingSeat })).engine).toEqual(answered.engine);
    const restarted = await app.post<DuelRoom>({ op: "fork-restart", slug: result.slug });
    expect(restarted.engine).toEqual(result.room.engine);
    expect(app.forks.privateState(result.slug, app.owner).commands.slice(0, 4)).toEqual(copied.commands.slice(0, 4));
    checkIsolation(app, before, result.slug);
  }, 60_000);

  it("uses the actual game-2 side decks and swapped seats, then keeps them after source deletion", async () => {
    const record = acceptanceSource({ mode: "normal", format: "1v1", engine: "legacy" });
    const app = fixture(record, true), before = protectedRows(app.db), { result } = await app.launch(1);
    const original = app.duels.privateState(app.source.slug, app.owner.guildId);
    expect(original.session).toMatchObject({ gameNumber: 2 }); expect(original.session.seats[0]!.playerId).toBe(202);
    expect(app.forks.privateState(result.slug, app.owner).decks).toEqual(original.decks);
    expect(original.decks[0]!.main[39]).toBe(POKI);
    checkIsolation(app, before, result.slug);
    app.db.prepare("delete from duel_commands where duel_id=?").run(app.source.id);
    app.db.prepare("delete from duel_seats where duel_id=?").run(app.source.id);
    app.db.prepare("delete from duels where id=?").run(app.source.id);
    const deleted = protectedRows(app.db);
    await app.restartHost();
    expect((await app.post<DuelRoom>({ op: "view", slug: result.slug })).engine).toEqual(result.room.engine);
    const restarted = await app.post<DuelRoom>({ op: "fork-restart", slug: result.slug }); expect(restarted.engine).toEqual(result.room.engine);
    checkIsolation(app, deleted, result.slug);
  }, 60_000);

  it.each(["normal", "domain"] as const)("%s lets the owner answer the pending-loss seat's required placement", async mode => {
    const app = fixture(rotationSource(mode)), before = protectedRows(app.db);
    const { result } = await app.launch();
    let room = result.room;
    expect(room.engine!.seats[1]).toMatchObject({ eliminated: false, pendingElimination: true });
    expect(room.engine!.chain).toMatchObject([{ code: 31036355, index: 1 }]);
    for (const [seat, answer] of [[2, { selected: ["card:0"] }], [3, { selected: ["card:0"] }],
      [0, { selected: ["place:0"] }]] as const) {
      const own = await app.post<DuelRoom>({ op: "view", slug: result.slug, as: seat });
      room = await app.post<DuelRoom>({ op: "respond", slug: result.slug, as: seat,
        command: { revision: own.engine!.revision, promptId: own.engine!.prompt!.id, answer } });
    }
    expect(room.engine!.prioritySeat).toBe(1);
    const pending = await app.post<DuelRoom>({ op: "view", slug: result.slug, as: 1 });
    expect(pending.engine!.prompt).toMatchObject({ seat: 1, kind: "places" });
    expect(pending.engine!.seats[1]).toMatchObject({ eliminated: false, pendingElimination: true });
    const answered = await app.post<DuelRoom>({ op: "respond", slug: result.slug, as: 1,
      command: { promptId: pending.engine!.prompt!.id, revision: pending.engine!.revision, answer: { selected: ["place:1"] } } });
    await app.restartHost();
    expect((await app.post<DuelRoom>({ op: "view", slug: result.slug, as: answered.fork!.actingSeat })).engine).toEqual(answered.engine);
    checkIsolation(app, before, result.slug);
    // Owner replay must preserve the Manual boundary for the explicitly answered loss prompt.
    app.duels.interrupt(result.slug, app.owner.guildId, "Owner replay fixture");
    const forkReplay = await app.post<DuelReplayV2>({ op: "owner-replay", slug: result.slug });
    expect(forkReplay.frames.at(-2)!.view).toEqual(answered.engine);
    expect(forkReplay.frames.at(-1)).toMatchObject({ kind: "result", cursor: null,
      view: { result: { reason: "Owner replay fixture" } } });
    expect(JSON.stringify(forkReplay)).not.toContain("manualLossAnswersAfter");
    expect(protectedRows(app.db)).toEqual(before); expect(app.leaked).not.toHaveBeenCalled(); expect(app.network).not.toHaveBeenCalled();
  }, 60_000);
});
