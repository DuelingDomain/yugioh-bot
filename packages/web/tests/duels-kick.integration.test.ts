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
// internal HTTP, host queue, opening cancellation, migrations and services are real.
class FixtureWorker implements DuelGameWorker {
  running = true;
  format: DuelFormat = "1v1";
  revision = 1;
  eliminated = new Set<number>();
  eliminations: number[] = [];
  failElimination = false;
  answers = 0;
  result: DuelEngineView["result"] = null;
  async create(options: GameOptions) { this.format = options.format ?? "1v1"; }
  async view(viewer: number | null): Promise<DuelEngineView> {
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
function table(format: DuelFormat, active = false, bestOf: 1 | 3 = 1, ranked = false) {
  slug = duels.create({ guildId: "g", organizerPlayerId: owner.playerId, name: "Table", mode: "normal", format,
    bestOf, ranked, settings: { validateDeck: false } }).slug;
  const players = [owner, guest];
  for (let i = 2; i < seatCountFor(format); i++) players.push(seedIdentity(db, { name: `P${i}` }));
  for (const player of players.slice(1)) duels.takeSeat(slug, "g", player.playerId);
  for (const player of players) duels.setDeck(slug, "g", player.playerId, deck);
  if (active) duels.activate(slug, "g", owner.playerId, ["1", "2", "3", "4"],
    pinnedEngineVersion("fixture", seatCountFor(format), format === "1v1" ? null : activeMultiScriptsHash(directory)),
    ranked ? { turn: 1, activeSeat: 0, startedAt: Date.now(), remainingMs: [180_000, 180_000] } : null,
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

  it.each([
    { ranked: false, opening: false }, { ranked: true, opening: false },
    { ranked: false, opening: true }, { ranked: true, opening: true },
  ])("cancels a pending challenge while preserving the host lobby ($ranked, opening=$opening)", async ({ ranked, opening }) => {
    const series = createDuelSeriesService(db);
    const challenge = series.createChallenge({ guildId: "g", challengerPlayerId: owner.playerId,
      opponentPlayerId: guest.playerId, bestOf: 3, ranked, mode: "normal" });
    slug = challenge.duel.slug;
    if (opening) {
      duels.setDeck(slug, "g", owner.playerId, deck); duels.setDeck(slug, "g", guest.playerId, deck);
      duels.startOpening(slug, "g", owner.playerId, Date.now());
    }
    expect((await kick()).status).toBe(200);
    expect(series.get(challenge.series.id, "g")).toMatchObject({ status: "cancelled", wins: [0, 0], winnerPlayerId: null });
    expect(db.prepare("select count(*) as count from matches").get()).toEqual({ count: 0 });
    expect(duels.get(slug, "g")).toMatchObject({ status: "lobby", seriesId: null, seats: [{ playerId: owner.playerId }] });
    expect(duels.room(slug, "g", owner.playerId).opening).toBeNull();
  });

  it.each([1, 3] as const)("cancels an unseated invitation in a best-of-%s lobby and permits only a host re-invite", async bestOf => {
    slug = duels.create({ guildId: "g", organizerPlayerId: owner.playerId, name: "Private", mode: "normal", bestOf, settings: { visibility: "private" } }).slug;
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

  it.each(["1v1", "ffa3", "ffa4"] as const)("cancels the %s opening back to the lobby without a result", async format => {
    table(format); duels.startOpening(slug, "g", owner.playerId, Date.now());
    expect((await kick()).status).toBe(200);
    expect(duels.room(slug, "g", owner.playerId).opening).toBeNull();
    expect(duels.get(slug, "g")).toMatchObject({ status: "lobby", winnerPlayerId: null, resultReason: null });
    expect(duels.get(slug, "g").seats.some(seat => seat.playerId === guest.playerId)).toBe(false);
    expect(db.prepare("select started_at from duels where web_slug=?").get(slug)).toEqual({ started_at: null });
    expect(db.prepare("select count(*) as count from matches").get()).toEqual({ count: 0 });
    expect(() => duels.takeSeat(slug, "g", guest.playerId)).toThrow(/removed.*host/i);
    expect((await internal({ op: "opening-pick", playerId: guest.playerId, pick: "rock" })).status).toBe(403);
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

  it("refuses a kick queued after the duel starts without blocking the player's view", async () => {
    table("ffa3", true);
    const before = duels.get(slug, "g");
    const kicking = internal({ op: "kick", targetPlayerId: guest.playerId });
    const viewing = internal({ op: "view", playerId: guest.playerId });
    expect((await kicking).status).toBe(409);
    expect((await viewing).status).toBe(200);
    expect(duels.get(slug, "g")).toEqual(before);
    expect(worker.eliminations).toEqual([]);
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

  it.each(["1v1", "ffa3", "ffa4", "tag"] as const)("refuses kicks in an active %s duel at every API boundary", async format => {
    table(format, true);
    const before = duels.get(slug, "g");
    for (const response of [await kick(), await internal({ op: "kick", targetPlayerId: guest.playerId })]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: expect.stringMatching(/only.*before.*duel starts/i) });
    }
    expect(() => duels.kickPlayer(slug, "g", owner.playerId, guest.playerId)).toThrow(/only.*before.*duel starts/i);
    expect(duels.get(slug, "g")).toEqual(before);
    expect(duels.privateState(slug, "g").commands).toEqual([]);
    expect(worker.eliminations).toEqual([]);
    expect(broadcasts).toEqual([]);
    expect(duels.room(slug, "g", owner.playerId).kickedPlayers).toEqual([]);
    expect((await internal({ op: "view", playerId: guest.playerId })).status).toBe(200);
    expect(canReadDuel(db, { slug, guildId: "g", playerId: guest.playerId, seat: 1 })).toBe(true);
  });

  it("preserves live access and finished history after refusing an active kick", async () => {
    table("ffa3", true);
    const live = createLiveNowService(db);
    expect(live.forPlayer("g", guest.playerId).yourDuel).toMatchObject({ href: `/duels/${slug}` });
    expect((await kick()).status).toBe(409);
    expect(live.forPlayer("g", guest.playerId).yourDuel).toMatchObject({ href: `/duels/${slug}` });
    expect(live.forPlayer("g", owner.playerId).liveCount).toBe(1);
    duels.complete(slug, "g", 0, "Finished");
    expect(duels.listHistory("g", guest.playerId, { scope: "mine" }).duels).toContainEqual(expect.objectContaining({ slug }));
    expect(duels.room(slug, "g", guest.playerId).mySeat).toBe(1);
  });

  it("refuses to revoke a pending invitation after the duel starts", async () => {
    table("ffa3");
    const invited = seedIdentity(db, { name: "Invited spectator" });
    duels.invitePlayer(slug, "g", owner.playerId, invited.playerId);
    duels.activate(slug, "g", owner.playerId, ["1", "2", "3", "4"],
      pinnedEngineVersion("fixture", 3, activeMultiScriptsHash(directory)), null, { firstTurnDraw: false });
    worker.failElimination = true;
    for (const response of [await kick(invited.playerId), await internal({ op: "kick", targetPlayerId: invited.playerId })]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: expect.stringMatching(/only.*before.*duel starts/i) });
    }
    expect(duels.room(slug, "g", owner.playerId).invitedPlayers).toContainEqual({ playerId: invited.playerId, displayName: "Invited spectator" });
    expect(canReadDuel(db, { slug, guildId: "g", playerId: invited.playerId, seat: null })).toBe(true);
    expect(worker.eliminations).toEqual([]);
    expect(duels.room(slug, "g", guest.playerId).mySeat).toBe(1);
    expect(duels.room(slug, "g", owner.playerId).kickedPlayers).toEqual([]);
  });

  it.each([false, true])("refuses an active series kick without changing wins or match records (ranked=%s)", async ranked => {
    table("1v1", true, 3, ranked);
    const series = createDuelSeriesService(db);
    const seriesId = duels.get(slug, "g").seriesId!;
    const before = series.get(seriesId, "g");
    const matches = db.prepare("select * from matches").all();
    for (const response of [await kick(), await internal({ op: "kick", targetPlayerId: guest.playerId })]) {
      expect(response.status).toBe(409);
    }
    expect(series.get(seriesId, "g")).toEqual(before);
    expect(db.prepare("select * from matches").all()).toEqual(matches);
    expect(duels.get(slug, "g")).toMatchObject({ status: "active", winnerPlayerId: null });
    expect(duels.room(slug, "g", guest.playerId).mySeat).toBe(1);
  });

  it.each([
    { ranked: false, winnerSeat: 0, opening: false },
    { ranked: true, winnerSeat: 0, opening: false },
    { ranked: false, winnerSeat: null, opening: true },
  ])("refuses a later series lobby kick (ranked=$ranked, winner=$winnerSeat, opening=$opening)", async ({ ranked, winnerSeat, opening }) => {
    table("1v1", true, 3, ranked);
    const series = createDuelSeriesService(db);
    const seriesId = duels.get(slug, "g").seriesId!;
    duels.complete(slug, "g", winnerSeat, winnerSeat === null ? "Draw" : "Surrender");
    slug = series.createNextGame(seriesId, "g").slug;
    if (opening) duels.startOpening(slug, "g", owner.playerId, Date.now());
    const before = series.get(seriesId, "g");
    const room = duels.room(slug, "g", owner.playerId);
    const matches = db.prepare("select * from matches").all();
    for (const response of [await kick(), await internal({ op: "kick", targetPlayerId: guest.playerId })]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: expect.stringMatching(/only.*before.*game 1.*series starts/i) });
    }
    expect(() => duels.kickPlayer(slug, "g", owner.playerId, guest.playerId)).toThrow(/only.*before.*game 1.*series starts/i);
    expect(duels.room(slug, "g", owner.playerId)).toEqual({ ...room,
      opening: room.opening ? { ...room.opening, serverNow: expect.any(Number) } : null });
    expect(duels.room(slug, "g", guest.playerId).role).toBe("player");
    expect(series.get(seriesId, "g")).toEqual(before);
    expect(db.prepare("select * from matches").all()).toEqual(matches);
    expect(broadcasts).toEqual([]);
  });

  it("broadcasts a first-lobby kick without auto-starting a best-of-three with an illegal deck", async () => {
    table("1v1", false, 3);
    db.prepare("update duel_seats set deck_json=? where duel_id=? and player_id=?")
      .run(JSON.stringify({ ...deck, extra: [999999] }), duels.get(slug, "g").id, owner.playerId);
    const response = await kick();
    expect(response.status).toBe(200);
    expect(broadcasts).toContainEqual({ slug, guildId: "g" });
    expect(duels.get(slug, "g").status).toBe("lobby");
    expect(() => duels.room(slug, "g", guest.playerId)).toThrow(/removed.*host/i);
  });

  it.each([false, true])("refuses a tournament lobby kick without changing the bracket or awarding a win (opening=%s)", async opening => {
    const game = tournamentLobby();
    if (opening) {
      duels.markReady(slug, "g", owner.playerId); duels.markReady(slug, "g", guest.playerId);
      duels.startOpening(slug, "g", owner.playerId, Date.now());
    }
    const series = createDuelSeriesService(db);
    const before = series.get(game.series.id, "g");
    const room = duels.room(slug, "g", owner.playerId);
    const bracket = db.prepare("select * from tournament_matches").all();
    for (const response of [await kick(), await internal({ op: "kick", targetPlayerId: guest.playerId })]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: expect.stringMatching(/cannot.*kick.*tournament match/i) });
    }
    expect(() => duels.kickPlayer(slug, "g", owner.playerId, guest.playerId)).toThrow(/cannot.*kick.*tournament match/i);
    expect(duels.room(slug, "g", owner.playerId)).toEqual({ ...room,
      opening: room.opening ? { ...room.opening, serverNow: expect.any(Number) } : null });
    expect(duels.room(slug, "g", guest.playerId).role).toBe("player");
    expect(series.get(game.series.id, "g")).toEqual(before);
    expect(db.prepare("select * from tournament_matches").all()).toEqual(bracket);
    expect(db.prepare("select count(*) as count from matches").get()).toEqual({ count: 0 });
    expect(broadcasts).toEqual([]);
  });

  it("lets tournament players ready and start after a refused kick", async () => {
    tournamentLobby();
    expect((await kick()).status).toBe(409);
    expect(duels.get(slug, "g").seats.find(seat => seat.playerId === guest.playerId)?.ready).toBe(false);
    expect((await internal({ op: "ready" })).status).toBe(200);
    expect(duels.get(slug, "g").status).toBe("lobby");
    expect((await internal({ op: "ready", playerId: guest.playerId })).status).toBe(200);
    expect(duels.get(slug, "g").status).toBe("active");
    expect(duels.room(slug, "g", guest.playerId).role).toBe("player");
  });

  it("lets a later series game auto-start after a refused kick and host restart", async () => {
    table("1v1", true, 3);
    const series = createDuelSeriesService(db);
    const seriesId = duels.get(slug, "g").seriesId!;
    duels.complete(slug, "g", 0, "Surrender");
    slug = series.createNextGame(seriesId, "g").slug;
    expect((await kick()).status).toBe(409);
    await host.close(); worker = new FixtureWorker(); host = openHost();
    expect((await internal({ op: "view" })).status).toBe(200);
    await vi.waitFor(() => expect(duels.get(slug, "g")).toMatchObject({ status: "active", winnerPlayerId: null }));
    expect(series.get(seriesId, "g").wins).toEqual([1, 0]);
    expect((await internal({ op: "view", playerId: guest.playerId })).status).toBe(200);
    expect(worker.eliminations).toEqual([]);
  });

  it("refuses kicks during side decking without changing the series or either player's access", async () => {
    table("1v1", true, 3);
    const series = createDuelSeriesService(db);
    const seriesId = duels.get(slug, "g").seriesId!;
    duels.complete(slug, "g", 0, "Surrender");
    const before = series.get(seriesId, "g");
    expect(before.status).toBe("between_games");
    const room = duels.room(slug, "g", owner.playerId);
    const matches = db.prepare("select * from matches").all();
    for (const response of [await kick(), await internal({ op: "kick", targetPlayerId: guest.playerId })]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: expect.stringMatching(/only.*before.*duel starts/i) });
    }
    expect(series.get(seriesId, "g")).toEqual(before);
    expect(db.prepare("select * from matches").all()).toEqual(matches);
    expect(duels.room(slug, "g", owner.playerId)).toEqual(room);
    expect(duels.room(slug, "g", guest.playerId).role).toBe("player");
    expect(broadcasts).toEqual([]);
  });

  it("refuses active tournament kicks without changing match or bracket records", async () => {
    const game = tournamentLobby();
    duels.markReady(slug, "g", owner.playerId); duels.markReady(slug, "g", guest.playerId);
    duels.activate(slug, "g", owner.playerId, ["1", "2", "3", "4"], pinnedEngineVersion("fixture", 2, null), null,
      { firstTurnDraw: false });
    const series = createDuelSeriesService(db);
    const before = series.get(game.series.id, "g");
    const bracket = db.prepare("select * from tournament_matches").all();
    const matches = db.prepare("select * from matches").all();
    for (const response of [await kick(), await internal({ op: "kick", targetPlayerId: guest.playerId })]) {
      expect(response.status).toBe(409);
    }
    expect(series.get(game.series.id, "g")).toEqual(before);
    expect(db.prepare("select * from tournament_matches").all()).toEqual(bracket);
    expect(db.prepare("select * from matches").all()).toEqual(matches);
    expect(duels.get(slug, "g")).toMatchObject({ status: "active", winnerPlayerId: null });
    expect(duels.room(slug, "g", guest.playerId).role).toBe("player");
  });
});
