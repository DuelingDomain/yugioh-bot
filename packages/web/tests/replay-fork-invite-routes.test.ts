import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDuelSeriesService, createTournamentService, DuelInviteRefusalError } from "@yugidraft/shared/services";
import { forkEventFixture } from "../../shared/tests/helpers/replay-fork-events.js";
import { useConsoleObservability } from "../../shared/tests/helpers/recording-observability.mjs";

const mocks = vi.hoisted(() => ({ db: vi.fn(), actor: vi.fn(), session: vi.fn(), notify: vi.fn(),
  announce: vi.fn(), tournament: vi.fn(), identity: vi.fn(), linkDeck: vi.fn(), mapDecks: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/env", () => ({ env: { discordBotEnabled: true, discordGuildId: "fork-events-test", webUrl: "https://duel.example/app" } }));
vi.mock("@/lib/duel-host", async importOriginal => ({ ...await importOriginal<object>(),
  requireDuelActor: mocks.actor, callDuelHost: vi.fn() }));
vi.mock("@/lib/web-access", () => ({ requireWebAccess: mocks.session }));
vi.mock("@/lib/notify", () => ({ announcer: { announce: mocks.announce }, broadcaster: { tournament: mocks.tournament } }));
vi.mock("@/lib/notify-duel", () => ({ notifyDuelChange: mocks.notify }));
vi.mock("@/lib/player-lookup", () => ({ playerIdentity: mocks.identity }));
vi.mock("@/lib/draft-decks", () => ({ linkDraftDeck: mocks.linkDeck }));
vi.mock("@/lib/draft-deck-codes", () => ({ mapDraftTournamentDecks: mocks.mapDecks }));
import { POST as challenge } from "../app/api/duels/route";
import { POST as tournamentDuel } from "../app/api/tournaments/[slug]/matches/[tmId]/duel/route";
import { sendDuelInvite } from "../src/lib/announce-bot";
import { duelErrorResponse } from "../src/lib/duel-host";
import { env } from "../src/lib/env";

let app: ReturnType<typeof forkEventFixture>;
beforeEach(() => {
  vi.clearAllMocks(); app = forkEventFixture(); mocks.db.mockReturnValue(app.db);
  env.discordBotEnabled = true;
  env.webUrl = "https://duel.example/app";
  mocks.actor.mockResolvedValue({ ok: true, ...app.owner, duels: app.duels });
  mocks.session.mockResolvedValue({ ok: true, userId: app.owner.userId });
  mocks.notify.mockResolvedValue(undefined);
  mocks.mapDecks.mockResolvedValue({ ok: true });
  mocks.identity.mockImplementation((_, playerId) => ({ discordUserId: `discord-${playerId}`, displayName: "Test player" }));
});
afterEach(() => { app.db.close(); vi.restoreAllMocks(); });

const duelRows = () => app.db.prepare("select * from duels order by id").all();
const seriesRows = () => app.db.prepare("select * from duel_series order by id").all();
function tournamentSlot(registerDecks = true) {
  const tournaments = createTournamentService(app.db);
  const tournament = tournaments.create(app.guildId, "Test cup", "round_robin", app.owner.userId);
  app.db.prepare("update tournaments set web_slug='cup' where id=?").run(tournament.id);
  tournaments.join(tournament.id, app.owner.playerId); tournaments.join(tournament.id, app.alpha.playerId);
  if (registerDecks) app.db.prepare("update tournament_participants set deck_json=? where tournament_id=?")
    .run(JSON.stringify({ main: Array(40).fill(100), extra: [], side: [] }), tournament.id);
  tournaments.start(tournament.id);
  const slot = app.db.prepare("select id from tournament_matches where tournament_id=?").get(tournament.id) as { id: number };
  return { params: Promise.resolve({ slug: "cup", tmId: String(slot.id) }) };
}

it("creates and notifies a real challenge with a WEB_URL path prefix", async () => {
  const before = duelRows().length;
  const response = await challenge(new Request("https://duel.example/api/duels", { method: "POST",
    body: JSON.stringify({ mode: "normal", opponentPlayerId: app.alpha.playerId }) }) as never);
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.session.kind).toBe("play");
  expect(body.shareUrl).toBe(`https://duel.example/app/duels/${body.session.slug}`);
  expect(duelRows()).toHaveLength(before + 1); expect(seriesRows()).toHaveLength(1);
  expect(mocks.notify).toHaveBeenCalledWith(body.session.slug, app.guildId);
  expect(mocks.announce).toHaveBeenCalledWith(expect.objectContaining({ kind: "duel-invite", slug: body.session.slug }));
});

it("creates a real tournament duel and returns the same duel on retry with a WEB_URL path prefix", async () => {
  const context = tournamentSlot();
  const before = duelRows().length;
  const request = () => new Request("https://duel.example/api/tournaments/cup", { method: "POST" });
  const first = await tournamentDuel(request(), context);
  expect(first.status).toBe(201);
  const created = await first.json();
  const retry = await tournamentDuel(request(), context);
  expect(retry.status).toBe(200);
  const resumed = await retry.json();
  expect(created).toMatchObject({ created: true, duel: { kind: "play" } });
  expect(resumed).toMatchObject({ created: false, duel: { slug: created.duel.slug }, series: { id: created.series.id } });
  expect(resumed.shareUrl).toBe(`https://duel.example/app/duels/${created.duel.slug}`);
  expect(duelRows()).toHaveLength(before + 1); expect(seriesRows()).toHaveLength(1);
  expect(mocks.notify).toHaveBeenCalledTimes(2); expect(mocks.tournament).toHaveBeenCalledTimes(2);
  expect(mocks.announce).toHaveBeenCalledTimes(1);
});

const refusedWebUrls = [
  "not-a-url",
  "localhost:3000",
  "ftp://duel.example/app",
  "https://duel.example/app?view=private",
  "https://duel.example/app#private",
  "https://user:password@duel.example/app",
];

it.each(refusedWebUrls)("creates a challenge with the bot disabled for WEB_URL %s", async webUrl => {
  env.discordBotEnabled = false;
  env.webUrl = webUrl;
  const before = duelRows().length;
  const response = await challenge(new Request("https://duel.example/api/duels", { method: "POST",
    body: JSON.stringify({ mode: "normal", opponentPlayerId: app.alpha.playerId }) }) as never);
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.session.kind).toBe("play");
  expect(duelRows()).toHaveLength(before + 1); expect(seriesRows()).toHaveLength(1);
  expect(mocks.notify).toHaveBeenCalledWith(body.session.slug, app.guildId);
  expect(mocks.announce).not.toHaveBeenCalled(); expect(mocks.identity).not.toHaveBeenCalled();
});

it.each(refusedWebUrls)("creates a tournament duel with the bot disabled for WEB_URL %s", async webUrl => {
  env.discordBotEnabled = false;
  env.webUrl = webUrl;
  const context = tournamentSlot();
  const before = duelRows().length;
  const response = await tournamentDuel(new Request("https://duel.example/api/tournaments/cup", { method: "POST" }), context);
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body).toMatchObject({ created: true, duel: { kind: "play" } });
  expect(duelRows()).toHaveLength(before + 1); expect(seriesRows()).toHaveLength(1);
  expect(mocks.notify).toHaveBeenCalledWith(body.duel.slug, app.guildId);
  expect(mocks.tournament).toHaveBeenCalledTimes(1);
  expect(mocks.announce).not.toHaveBeenCalled(); expect(mocks.identity).not.toHaveBeenCalled();
});

it("creates a challenge with an invalid WEB_URL when the opponent has no Discord identity", async () => {
  env.webUrl = "localhost:3000";
  mocks.identity.mockReturnValue({ discordUserId: null, displayName: "Web player" });
  const before = duelRows().length;
  const response = await challenge(new Request("https://duel.example/api/duels", { method: "POST",
    body: JSON.stringify({ mode: "normal", opponentPlayerId: app.alpha.playerId }) }) as never);
  expect(response.status).toBe(201);
  expect(duelRows()).toHaveLength(before + 1); expect(seriesRows()).toHaveLength(1);
  expect(mocks.announce).not.toHaveBeenCalled();
});

it("creates a tournament duel with an invalid WEB_URL when there are no Discord recipients", async () => {
  env.webUrl = "localhost:3000";
  mocks.identity.mockReturnValue({ discordUserId: null, displayName: "Web player" });
  const context = tournamentSlot();
  const before = duelRows().length;
  const response = await tournamentDuel(new Request("https://duel.example/api/tournaments/cup", { method: "POST" }), context);
  expect(response.status).toBe(201);
  expect(duelRows()).toHaveLength(before + 1); expect(seriesRows()).toHaveLength(1);
  expect(mocks.announce).not.toHaveBeenCalled();
});

it("reuses a tournament duel with an invalid WEB_URL without sending another invite", async () => {
  const context = tournamentSlot();
  const request = () => new Request("https://duel.example/api/tournaments/cup", { method: "POST" });
  const first = await tournamentDuel(request(), context);
  expect(first.status).toBe(201);
  const created = await first.json();
  const before = duelRows();
  env.webUrl = "localhost:3000";
  const retry = await tournamentDuel(request(), context);
  expect(retry.status).toBe(200);
  expect(await retry.json()).toMatchObject({ created: false, duel: { slug: created.duel.slug }, series: { id: created.series.id } });
  expect(duelRows()).toEqual(before); expect(seriesRows()).toHaveLength(1);
  expect(mocks.announce).toHaveBeenCalledTimes(1);
});

it("checks the invite URL before saving if the existing series is cancelled during deck mapping", async () => {
  const context = tournamentSlot();
  const request = () => new Request("https://duel.example/api/tournaments/cup", { method: "POST" });
  const first = await tournamentDuel(request(), context);
  expect(first.status).toBe(201);
  const created = await first.json();
  env.webUrl = "localhost:3000";
  const before = { duels: duelRows(), series: seriesRows() };
  mocks.mapDecks.mockImplementationOnce(async () => {
    createDuelSeriesService(app.db).cancel(created.series.id, app.guildId);
    before.duels = duelRows(); before.series = seriesRows();
    return { ok: true };
  });
  const response = await tournamentDuel(request(), context);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "Invalid duel invite reference", code: "DUEL_INVITE_REFUSED" });
  expect(duelRows()).toEqual(before.duels); expect(seriesRows()).toEqual(before.series);
  expect(mocks.announce).toHaveBeenCalledTimes(1);
});

it.each(refusedWebUrls)("refuses a challenge before saving for WEB_URL %s and succeeds after correction", async webUrl => {
  env.webUrl = webUrl;
  const before = duelRows();
  const request = () => new Request("https://duel.example/api/duels", { method: "POST",
    body: JSON.stringify({ mode: "normal", opponentPlayerId: app.alpha.playerId }) }) as never;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await challenge(request());
    expect(duelRows()).toEqual(before); expect(seriesRows()).toEqual([]);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Invalid duel invite reference", code: "DUEL_INVITE_REFUSED" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
  expect(mocks.announce).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled();

  env.webUrl = "https://duel.example/app";
  expect((await challenge(request())).status).toBe(201);
  expect(duelRows()).toHaveLength(before.length + 1); expect(seriesRows()).toHaveLength(1);
  expect(mocks.announce).toHaveBeenCalledTimes(1);
});

it.each(refusedWebUrls)("refuses a tournament duel before saving for WEB_URL %s and succeeds after correction", async webUrl => {
  env.webUrl = webUrl;
  const context = tournamentSlot();
  const before = duelRows();
  const participants = () => app.db.prepare("select * from tournament_participants order by player_id").all();
  const beforeParticipants = participants();
  const request = () => new Request("https://duel.example/api/tournaments/cup", { method: "POST" });
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await tournamentDuel(request(), context);
    expect(duelRows()).toEqual(before); expect(seriesRows()).toEqual([]);
    expect(participants()).toEqual(beforeParticipants);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Invalid duel invite reference", code: "DUEL_INVITE_REFUSED" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
  expect(mocks.announce).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled();
  expect(mocks.tournament).not.toHaveBeenCalled();
  expect(mocks.linkDeck).not.toHaveBeenCalled(); expect(mocks.mapDecks).not.toHaveBeenCalled();

  env.webUrl = "https://duel.example/app";
  const created = await tournamentDuel(request(), context);
  expect(created.status).toBe(201);
  expect((await tournamentDuel(request(), context)).status).toBe(200);
  expect(duelRows()).toHaveLength(before.length + 1); expect(seriesRows()).toHaveLength(1);
  expect(mocks.announce).toHaveBeenCalledTimes(1);
});

it.each([
  { error: new DuelInviteRefusalError(), status: 409,
    body: { error: "Duel invites are unavailable", code: "DUEL_INVITE_REFUSED" } },
  { error: Object.assign(new Error("private invite diagnostic"), { code: "DUEL_INVITE_REFUSED", status: 500 }), status: 500,
    body: { error: "Something went wrong" } },
  { error: { code: "DUEL_INVITE_REFUSED" }, status: 500,
    body: { error: "Something went wrong" } },
])("exposes invite refusals only for the trusted error class: %j", async ({ error, status, body }) => {
  const response = duelErrorResponse(error);
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual(body);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it("uses the real error handler for a rejected tournament start and writes no duel or series", async () => {
  const context = tournamentSlot(false);
  const before = duelRows();
  const response = await tournamentDuel(new Request("https://duel.example/api/tournaments/cup", { method: "POST" }), context);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "Both players must register a deck before the duel can start" });
  expect(duelRows()).toEqual(before); expect(seriesRows()).toEqual([]);
  expect(mocks.announce).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled();
  expect(mocks.tournament).not.toHaveBeenCalled();
});

it("keeps the persisted fork-kind guard at the invite sender", async () => {
  const before = duelRows();
  expect(await sendDuelInvite({ slug: app.forkSlug, guildId: app.guildId, opponentDiscordUserId: "discord-test",
    challengerName: "Test player", duelName: "Fork", bestOf: 1, ranked: false, tournamentName: null })).toBe(false);
  expect(mocks.announce).not.toHaveBeenCalled(); expect(duelRows()).toEqual(before); expect(seriesRows()).toEqual([]);
});

useConsoleObservability();
