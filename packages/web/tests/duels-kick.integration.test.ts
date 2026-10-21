import Database from "better-sqlite3";
import { rmSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { canReadDuel, createDuelService, createDuelSeriesService, createLiveNowService, createTournamentService,
  createUserService, deleteUserAccount, userHistory } from "@yugidraft/shared/services";
import { seatCountFor, teamOfSeat, type DuelAnswer, type DuelEngineView, type DuelFormat } from "@yugidraft/shared/duels";
import { readSignedRequest } from "@yugidraft/shared/internal-auth";
import type { DuelGameWorker, GameOptions } from "../../duel-server/src/worker-client";
import { createDuelHost, type DuelHost } from "../../duel-server/src/host";
import { createHostDataFixture } from "../../duel-server/tests/helpers/host-data-fixture";
import { seedIdentity } from "../../duel-server/tests/helpers/identity";
import { signedHeaders } from "../../duel-server/tests/helpers/signed-request";
import { activeMultiScriptsHash, pinnedEngineVersion } from "../../duel-server/src/multi-scripts";

const SECRET = "kick-integration-secret";
const state = vi.hoisted(() => ({ db: null as Database.Database | null, auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));
vi.mock("@/lib/env", () => ({ env: { discordGuildId: "g", duelInternalUrl: "http://duel.test",
  duelInternalSecret: "kick-integration-secret", wsInternalUrl: "http://ws.test", wsInternalSecret: "kick-ws-secret" } }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(state.auth);
});

// Only the native engine boundary is substituted. Routes, auth-to-player mapping, signed
// internal HTTP, host queue, surrender orchestration, migrations and services are real.
class FixtureWorker implements DuelGameWorker {
  running = true;
  format: DuelFormat = "1v1";
  revision = 1;
  eliminated = new Set<number>();
  eliminations: number[] = [];
  failElimination = false;
  failActiveView = false;
  beforeEliminate?: () => Promise<void>;
  answers = 0;
  result: DuelEngineView["result"] = null;
  async create(options: GameOptions) { this.format = options.format ?? "1v1"; }
  async view(viewer: number | null): Promise<DuelEngineView> {
    if (this.failActiveView && duels.get(slug, "g").status === "active") throw new Error("Fixture worker view failed after activation");
    const promptSeat = Array.from({ length: seatCountFor(this.format) }, (_, i) => i).find(i => !this.eliminated.has(i)) ?? 0;
    return { revision: this.revision, format: this.format, turn: 1, turnSeat: promptSeat, phase: "main1",
      seats: Array.from({ length: seatCountFor(this.format) }, (_, seat) => ({ seat, lp: 8000, hand: [],
        deckCount: 35, extraCount: 0, extra: [], monsters: [], spells: [], graveyard: [], banished: [],
        team: teamOfSeat(this.format, seat), eliminated: this.eliminated.has(seat) })),
      prompt: viewer === promptSeat && !this.result ? { id: `p${this.revision}`, seat: promptSeat, kind: "choice", title: "Main",
        options: [{ id: "to_ep", label: "End" }], context: { type: "action", phase: "main" } } : null,
      chain: [], events: [], log: [], result: this.result };
  }
  async answer(_seat: number, _promptId: string, _answer: DuelAnswer) { this.answers++; this.revision++; }
  async eliminate(seat: number) {
    await this.beforeEliminate?.();
    if (this.failElimination) throw new Error("This duel core has no Debug.EliminateDuelist");
    this.eliminations.push(seat);
    for (let i = 0; i < seatCountFor(this.format); i++) {
      if (i === seat || (this.format === "tag" && teamOfSeat(this.format, i) === teamOfSeat(this.format, seat))) this.eliminated.add(i);
    }
    this.revision++;
    const living = Array.from({ length: seatCountFor(this.format) }, (_, i) => i).filter(i => !this.eliminated.has(i));
    if (new Set(living.map(i => teamOfSeat(this.format, i) ?? i)).size === 1) {
      this.result = { winnerSeat: living[0]!, reason: "Surrender", ...(this.format === "tag" ? { winnerTeam: teamOfSeat(this.format, living[0]!) } : {}) };
    }
  }
  async search() { return []; }
  async close() { this.running = false; }
}
let db: Database.Database;
let host: DuelHost;
let directory: string;
let duels: ReturnType<typeof createDuelService>;
let owner: ReturnType<typeof seedIdentity>;
let guest: ReturnType<typeof seedIdentity>;
let slug: string;
let worker: FixtureWorker;
const broadcasts: unknown[] = [];
const deck = { main: new Array<number>(40).fill(1), extra: [], side: [] };

beforeAll(() => { directory = createHostDataFixture([{ code: 1, name: "Fixture monster" }]); });
afterAll(() => { rmSync(directory, { recursive: true, force: true }); });
beforeEach(() => {
  db = new Database(":memory:"); state.db = db; migrate(db);
  owner = seedIdentity(db, { name: "Host" }); guest = seedIdentity(db, { name: "Guest" });
  duels = createDuelService(db);
  slug = duels.create({ guildId: "g", organizerPlayerId: owner.playerId, name: "Kick table", mode: "normal" }).slug;
  state.auth.mockResolvedValue({ user: { id: String(owner.userId), name: "Host" } });
  worker = new FixtureWorker(); broadcasts.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url === "http://duel.test/internal/duel") return host.handle(request);
    if (request.url === "http://ws.test/internal/duel/changed") {
      const signed = await readSignedRequest(request, { secret: "kick-ws-secret", purpose: "ws-broadcast" });
      expect(signed.ok).toBe(true);
      if (signed.ok) broadcasts.push(signed.body);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected network request: ${request.url}`);
  }));
  host = openHost();
});
function openHost() {
  return createDuelHost({ db, dataDirectory: directory, secret: SECRET, searchCards: () => [], pollIntervalMs: 60_000,
    createWorker: () => { if (!worker.running) worker = new FixtureWorker(); return worker; }, onChange: async (slug, guildId) => {
      const { notifyDuelChange } = await import("../src/lib/notify-duel");
      await notifyDuelChange(slug, guildId);
    } });
}
afterEach(async () => { await host.close(); db.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function internal(body: Record<string, unknown>) {
  const url = "http://duel.test/internal/duel";
  const raw = JSON.stringify({ slug, guildId: "g", playerId: owner.playerId, ...body });
  return host.handle(new Request(url, { method: "POST", body: raw,
    headers: await signedHeaders(raw, SECRET, url, "duel-host") }));
}

async function kick(playerId: unknown = guest.playerId, query = "") {
  const { POST } = await import("../app/api/duels/[slug]/kick/route");
  return POST(new Request(`http://web.test/api/duels/${slug}/kick${query}`, { method: "POST",
    body: JSON.stringify({ playerId }), headers: { "Content-Type": "application/json" } }), { params: Promise.resolve({ slug }) });
}
async function invite(body: unknown) {
  const { POST } = await import("../app/api/duels/[slug]/invite/route");
  return POST(new NextRequest(`http://web.test/api/duels/${slug}/invite`, { method: "POST",
    body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }), { params: Promise.resolve({ slug }) });
}
function signedInAs(identity: typeof owner) { state.auth.mockResolvedValue({ user: { id: String(identity.userId), name: "Fixture" } }); }
function table(format: DuelFormat, active = false, bestOf: 1 | 3 = 1) {
  slug = duels.create({ guildId: "g", organizerPlayerId: owner.playerId, name: "Table", mode: "normal", format,
    bestOf, settings: { validateDeck: false } }).slug;
  const players = [owner, guest];
  for (let i = 2; i < seatCountFor(format); i++) players.push(seedIdentity(db, { name: `P${i}` }));
  for (const player of players.slice(1)) duels.takeSeat(slug, "g", player.playerId);
  for (const player of players) duels.setDeck(slug, "g", player.playerId, deck);
  if (active) duels.activate(slug, "g", owner.playerId, ["1", "2", "3", "4"],
    pinnedEngineVersion("fixture", seatCountFor(format), format === "1v1" ? null : activeMultiScriptsHash(directory)), null,
    { firstTurnDraw: false });
  return players;
}
function tournamentLobby() {
  const tournaments = createTournamentService(db);
  const tournament = tournaments.create("g", "Kick cup", "round_robin", owner.userId);
  tournaments.join(tournament.id, owner.playerId); tournaments.join(tournament.id, guest.playerId);
  tournaments.start(tournament.id);
  db.prepare("update tournament_participants set deck_json=? where tournament_id=?").run(JSON.stringify(deck), tournament.id);
  const slot = db.prepare("select id from tournament_matches where tournament_id=? limit 1").get(tournament.id) as { id: number };
  const game = createDuelSeriesService(db).startTournamentMatch({ guildId: "g", tournamentMatchId: slot.id, actorPlayerId: owner.playerId });
  slug = game.duel.slug;
  // Registered deck validation is covered by tournament suites; this fixture has one vanilla card.
  db.prepare("update duels set settings_json=json_set(settings_json,'$.validateDeck',json('false')) where web_slug=?").run(slug);
  return game;
}

describe("host player removal through the signed duel API and SQLite", () => {
  it("removes a joined human and persists refusal of another seat claim", async () => {
    duels.takeSeat(slug, "g", guest.playerId, 1);
    const response = await internal({ op: "kick", targetPlayerId: guest.playerId });
    expect(response.status).toBe(200);
    expect(duels.get(slug, "g").seats.map(seat => seat.playerId)).toEqual([owner.playerId]);
    expect(() => duels.takeSeat(slug, "g", guest.playerId, 1)).toThrow(/removed.*host/i);
  });

  it.each(["1v1", "ffa3", "ffa4", "tag"] as const)("releases a ready %s lobby seat, its deck and its invite, and broadcasts", async format => {
    table(format);
    const response = await kick();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(duels.get(slug, "g").seats.some(seat => seat.playerId === guest.playerId)).toBe(false);
    expect(db.prepare("select 1 from duel_seats where player_id=?").get(guest.playerId)).toBeUndefined();
    expect(broadcasts).toContainEqual({ slug, guildId: "g" });
    expect(canReadDuel(db, { slug, guildId: "g", playerId: guest.playerId, seat: 1 })).toBe(false);
    expect(() => duels.room(slug, "g", guest.playerId)).toThrow(/removed.*host/i);
  });

  it("cancels a pending challenge while preserving the host lobby", async () => {
    const series = createDuelSeriesService(db);
    const challenge = series.createChallenge({ guildId: "g", challengerPlayerId: owner.playerId,
      opponentPlayerId: guest.playerId, bestOf: 3, ranked: false, mode: "normal" });
    slug = challenge.duel.slug;
    expect((await kick()).status).toBe(200);
    expect(series.get(challenge.series.id, "g").status).toBe("cancelled");
    expect(duels.get(slug, "g")).toMatchObject({ status: "lobby", seriesId: null, seats: [{ playerId: owner.playerId }] });
  });

  it("cancels an unseated invitation, refuses the old link, and permits only a host re-invite", async () => {
    slug = duels.create({ guildId: "g", organizerPlayerId: owner.playerId, name: "Private", mode: "normal", settings: { visibility: "private" } }).slug;
    const inviteCode = duels.room(slug, "g", owner.playerId).inviteCode!;
    duels.admit(slug, "g", guest.playerId, inviteCode);
    expect(duels.room(slug, "g", owner.playerId).invitedPlayers).toEqual([{ playerId: guest.playerId, displayName: "Guest" }]);
    expect((await kick()).status).toBe(200);
    signedInAs(guest);
    const refused = await invite({ inviteCode });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "DUEL_KICKED" });
    expect((await invite({ playerId: guest.playerId })).status).toBe(403);
    signedInAs(owner);
    expect((await invite({ playerId: guest.playerId })).status).toBe(200);
    duels.takeSeat(slug, "g", guest.playerId, 1);
    expect(duels.room(slug, "g", guest.playerId).mySeat).toBe(1);
  });

  it("counts a revoked invitation as history and permits account deletion without foreign key failures", async () => {
    db.pragma("foreign_keys=on");
    duels.invitePlayer(slug, "g", owner.playerId, guest.playerId);
    expect((await kick()).status).toBe(200);
    expect(userHistory(db, guest.userId)).toEqual({ "duel_kicked_players.player_id": 1 });
    expect(deleteUserAccount(db, guest.userId)).toMatchObject({ mode: "anonymised" });
    expect(db.prepare("select display_name from players where id=?").get(guest.playerId)).toEqual({ display_name: "Deleted player" });
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.pragma("foreign_key_list(duel_kicked_players)")).toContainEqual(expect.objectContaining({ from: "player_id", on_delete: "CASCADE" }));
    expect(db.pragma("index_list(duel_kicked_players)")).toContainEqual(expect.objectContaining({ name: "duel_kicked_players_player_idx" }));
    db.prepare("delete from players where id=?").run(guest.playerId);
    expect(db.prepare("select 1 from duel_kicked_players where player_id=?").get(guest.playerId)).toBeUndefined();
  });

  it.each(["clerk", "discord"])("preserves a kicked %s identity and its block when linking accounts", async provider => {
    db.pragma("foreign_keys=on");
    const users = createUserService(db);
    const discordId = "900000000000000101";
    const profile = { clerkUserId: "kick-link-user", username: "guest", displayName: "Guest", email: null,
      emailVerified: false, discordUserId: null, imageUrl: null };
    const clerkUser = users.resolveClerkProfile(profile).user;
    const discordUser = users.ensureDiscord({ discordUserId: discordId, displayName: "Imported guest" });
    const keptUser = provider === "clerk" ? clerkUser : discordUser;
    const keptPlayer = seedIdentity(db, { userId: keptUser.id });
    duels.invitePlayer(slug, "g", owner.playerId, keptPlayer.playerId);
    expect((await kick(keptPlayer.playerId)).status).toBe(200);
    const outcome = users.resolveClerkProfile({ ...profile, discordUserId: discordId });
    expect(outcome).toMatchObject({ user: { id: keptUser.id, clerkUserId: profile.clerkUserId, discordUserId: discordId },
      conflict: null, foldedUserId: provider === "clerk" ? discordUser.id : clerkUser.id });
    expect(() => duels.room(slug, "g", keptPlayer.playerId)).toThrow(/removed.*host/i);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("interrupts the opening before releasing a seat", async () => {
    table("1v1"); duels.startOpening(slug, "g", owner.playerId, Date.now());
    expect((await kick()).status).toBe(200);
    expect(duels.room(slug, "g", owner.playerId).opening).toBeNull();
    expect(duels.get(slug, "g").status).toBe("lobby");
  });

  it.each([undefined, null, "2", -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects malformed target %j", async playerId => {
    duels.takeSeat(slug, "g", guest.playerId, 1);
    expect((await kick(playerId === undefined ? null : playerId)).status).toBe(400);
    expect(duels.get(slug, "g").seats).toHaveLength(2);
  });

  it("enforces the session, host, self-kick and guild boundaries without mutations", async () => {
    duels.takeSeat(slug, "g", guest.playerId, 1);
    state.auth.mockResolvedValue(null); expect((await kick()).status).toBe(401);
    signedInAs(guest); expect((await kick(owner.playerId)).status).toBe(403);
    expect((await internal({ op: "kick", playerId: guest.playerId, targetPlayerId: owner.playerId })).status).toBe(403);
    signedInAs(owner); expect((await kick(owner.playerId)).status).toBe(400);
    const other = seedIdentity(db, { guildId: "other" });
    expect((await kick(other.playerId)).status).toBe(400);
    expect((await internal({ op: "kick", guildId: "other", targetPlayerId: guest.playerId })).status).toBe(404);
    expect((await kick(guest.playerId, "?as=1")).status).toBe(400);
    expect(duels.get(slug, "g").seats).toHaveLength(2);
    expect(broadcasts).toHaveLength(0);
  });

  it("allows a public-room re-invite only from its host and survives a fresh service instance", async () => {
    table("1v1"); expect((await kick()).status).toBe(200);
    expect(() => createDuelService(db).takeSeat(slug, "g", guest.playerId, 1)).toThrow(/removed.*host/i);
    expect(duels.list("g", guest.playerId).some(duel => duel.slug === slug)).toBe(false);
    signedInAs(guest); expect((await invite({ playerId: guest.playerId })).status).toBe(403);
    signedInAs(owner); expect((await invite({ playerId: guest.playerId })).status).toBe(200);
    duels.takeSeat(slug, "g", guest.playerId, 1);
    expect(duels.room(slug, "g", guest.playerId).mySeat).toBe(1);
  });

  it("serializes an in-flight kick before the removed player's queued action", async () => {
    table("ffa3", true);
    let release!: () => void; let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    worker.beforeEliminate = async () => { entered(); await held; };
    const kicking = kick();
    await started;
    const action = internal({ op: "respond", playerId: guest.playerId,
      command: { promptId: "p1", revision: 1, answer: { choice: "to_ep" } } });
    release();
    expect((await kicking).status).toBe(200);
    const rejected = await action;
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toMatchObject({ code: "DUEL_KICKED" });
    expect(worker.answers).toBe(0);
  });

  it("returns the removal code from both browser room and subscription routes", async () => {
    table("1v1"); expect((await kick()).status).toBe(200);
    signedInAs(guest);
    const { GET } = await import("../app/api/duels/[slug]/route");
    const { GET: connection } = await import("../app/api/duels/[slug]/connection/route");
    for (const get of [GET, connection]) {
      const response = await get(new Request(`http://web.test/api/duels/${slug}`), { params: Promise.resolve({ slug }) });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "DUEL_KICKED", error: expect.stringMatching(/removed.*host/i) });
    }
  });

  it.each(["1v1", "ffa3", "ffa4", "tag"] as const)("uses the existing surrender path in an active %s duel", async format => {
    table(format, true);
    const response = await kick();
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    const session = duels.get(slug, "g");
    if (format === "ffa3" || format === "ffa4") {
      expect(session.status).toBe("active");
      expect(worker.eliminations).toEqual([1]);
      expect(duels.privateState(slug, "g").commands.some(entry => entry.seat === 1 && entry.command.promptId.startsWith("eliminate:"))).toBe(true);
      const view = await internal({ op: "view" });
      expect(view.status).toBe(200);
      expect((await view.json()).engine.seats[1].eliminated).toBe(true);
    } else {
      expect(session).toMatchObject({ status: "completed", winnerPlayerId: owner.playerId, resultReason: "Surrender" });
    }
    const result = await internal({ op: "view", playerId: guest.playerId });
    const terminal = session.status === "completed";
    expect(result.status).toBe(terminal ? 200 : 403);
    if (terminal) {
      expect(await result.json()).toMatchObject({ mySeat: 1, session: { status: "completed" }, engine: { result: { reason: "Surrender" } } });
      const replay = await internal({ op: "replay", playerId: guest.playerId });
      expect(replay.status, JSON.stringify(await replay.clone().json())).toBe(200);
    } else expect(await result.json()).toMatchObject({ code: "DUEL_KICKED" });
    expect(canReadDuel(db, { slug, guildId: "g", playerId: guest.playerId, seat: null })).toBe(terminal);
    expect(broadcasts).toContainEqual({ slug, guildId: "g" });
  });

  it("hides a kicked live seat from Live now while retaining its finished history", async () => {
    table("ffa3", true);
    const live = createLiveNowService(db);
    expect(live.forPlayer("g", guest.playerId).yourDuel).toMatchObject({ href: `/duels/${slug}` });
    expect((await kick()).status).toBe(200);
    expect(live.forPlayer("g", guest.playerId)).toEqual({ yourDuel: null, liveCount: 0 });
    expect(live.forPlayer("g", owner.playerId).liveCount).toBe(1);
    duels.complete(slug, "g", 0, "Finished");
    expect(duels.listHistory("g", guest.playerId, { scope: "mine" }).duels).toContainEqual(expect.objectContaining({ slug }));
    expect(duels.room(slug, "g", guest.playerId).mySeat).toBe(1);
  });

  it("does not ban or release a seat when surrender fails", async () => {
    table("ffa3", true); worker.failElimination = true;
    const response = await kick();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "This engine cannot eliminate a surrendering duelist" });
    expect(duels.room(slug, "g", guest.playerId).mySeat).toBe(1);
    expect(duels.room(slug, "g", owner.playerId).kickedPlayers).toEqual([]);
  });

  it("keeps a removed player out of a BO3 successor and concedes the seat through normal game results", async () => {
    table("1v1", true, 3);
    const series = createDuelSeriesService(db);
    const seriesId = duels.get(slug, "g").seriesId!;
    expect((await kick()).status).toBe(200);
    expect(series.get(seriesId, "g").status).toBe("between_games");
    expect(createLiveNowService(db).forPlayer("g", guest.playerId).yourDuel).toBeNull();
    const before = series.get(seriesId, "g");
    for (const op of ["series-side", "series-ready", "series-unready", "series-first"]) {
      const refused = await internal({ op, playerId: guest.playerId, deck, choice: "second" });
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ code: "DUEL_KICKED" });
    }
    expect(series.get(seriesId, "g")).toEqual(before);
    const next = series.createNextGame(seriesId, "g");
    expect(canReadDuel(db, { slug: next.slug, guildId: "g", playerId: guest.playerId, seat: 1 })).toBe(false);
    expect(() => duels.room(next.slug, "g", guest.playerId)).toThrow(/removed.*host/i);
    const started = await internal({ op: "start", slug: next.slug });
    expect(started.status, JSON.stringify(await started.clone().json())).toBe(200);
    expect(duels.get(next.slug, "g")).toMatchObject({ status: "completed", winnerPlayerId: owner.playerId, resultReason: "Surrender" });
    expect(series.get(seriesId, "g")).toMatchObject({ status: "completed", winnerPlayerId: owner.playerId });
    expect((await internal({ op: "view", slug: next.slug, playerId: guest.playerId })).status).toBe(200);
  });

  it("supports kicking from a later fixed-seat series lobby", async () => {
    table("1v1", true, 3);
    const series = createDuelSeriesService(db);
    const seriesId = duels.get(slug, "g").seriesId!;
    duels.complete(slug, "g", 0, "Surrender");
    slug = series.createNextGame(seriesId, "g").slug;
    const response = await kick();
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect(duels.get(slug, "g")).toMatchObject({ status: "completed", winnerPlayerId: owner.playerId });
    expect(duels.room(slug, "g", guest.playerId)).toMatchObject({ mySeat: 0, role: "player" });
  });

  it("broadcasts a committed kick even when a series auto-start rejects an illegal deck", async () => {
    table("1v1", true, 3);
    const seriesId = duels.get(slug, "g").seriesId!;
    duels.complete(slug, "g", 0, "Surrender");
    slug = createDuelSeriesService(db).createNextGame(seriesId, "g").slug;
    db.prepare("update duel_seats set deck_json=? where duel_id=? and player_id=?")
      .run(JSON.stringify({ ...deck, extra: [999999] }), duels.get(slug, "g").id, owner.playerId);
    const response = await kick();
    expect(response.status).toBe(400);
    expect(broadcasts).toContainEqual({ slug, guildId: "g" });
    expect(() => duels.room(slug, "g", guest.playerId)).toThrow(/removed.*host/i);
  });

  it("revokes a fixed tournament lobby seat and surrenders it when the host is ready", async () => {
    tournamentLobby();
    const response = await kick();
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect(() => duels.room(slug, "g", guest.playerId)).toThrow(/removed.*host/i);
    const ready = await internal({ op: "ready" });
    expect(ready.status, JSON.stringify(await ready.clone().json())).toBe(200);
    expect(duels.get(slug, "g")).toMatchObject({ status: "completed", winnerPlayerId: owner.playerId, resultReason: "Surrender" });
  });

  it("requires a reinstated fixed-seat player to confirm readiness again", async () => {
    tournamentLobby();
    expect((await kick()).status).toBe(200);
    expect((await invite({ playerId: guest.playerId })).status).toBe(200);
    expect(duels.get(slug, "g").seats.find(seat => seat.playerId === guest.playerId)?.ready).toBe(false);
    expect((await internal({ op: "ready" })).status).toBe(200);
    expect(duels.get(slug, "g").status).toBe("lobby");
    expect((await internal({ op: "ready", playerId: guest.playerId })).status).toBe(200);
    expect(duels.get(slug, "g").status).toBe("active");
    expect(duels.room(slug, "g", guest.playerId).role).toBe("player");
  });

  it("interrupts a failed pending concession once and keeps room reads available after restart", async () => {
    table("1v1", true, 3);
    const series = createDuelSeriesService(db);
    const seriesId = duels.get(slug, "g").seriesId!;
    duels.complete(slug, "g", 0, "Surrender");
    slug = series.createNextGame(seriesId, "g").slug;
    duels.kickPlayer(slug, "g", owner.playerId, guest.playerId);
    worker.failActiveView = true;
    expect((await internal({ op: "start" })).status).toBe(200);
    expect(duels.get(slug, "g").status).toBe("interrupted");
    expect(db.prepare("select needs_surrender from duel_kicked_players where duel_id=? and player_id=?")
      .get(duels.get(slug, "g").id, guest.playerId)).toEqual({ needs_surrender: 0 });
    await host.close(); worker = new FixtureWorker(); host = openHost();
    expect((await internal({ op: "view" })).status).toBe(200);
    expect((await internal({ op: "view" })).status).toBe(200);
    expect(duels.get(slug, "g").status).toBe("interrupted");
    expect(series.get(seriesId, "g").wins).toEqual([1, 0]);
    expect(db.prepare("select needs_surrender from duel_kicked_players where duel_id=? and player_id=?")
      .get(duels.get(slug, "g").id, guest.playerId)).toEqual({ needs_surrender: 0 });
  });

  it("clears an unsupported pending multiplayer concession during recovery without blocking other players", async () => {
    table("ffa3", true);
    duels.kickPlayer(slug, "g", owner.playerId, guest.playerId);
    db.prepare("update duel_kicked_players set needs_surrender=1 where player_id=?").run(guest.playerId);
    worker.failElimination = true;
    expect((await internal({ op: "view" })).status).toBe(200);
    expect(duels.get(slug, "g").status).toBe("interrupted");
    expect(db.prepare("select needs_surrender from duel_kicked_players where player_id=?").get(guest.playerId)).toEqual({ needs_surrender: 0 });
    expect((await internal({ op: "view" })).status).toBe(200);
  });
});
