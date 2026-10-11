import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTournamentService } from "@yugidraft/shared/services";
import { forkEventFixture } from "../../shared/tests/helpers/replay-fork-events.js";

const mocks = vi.hoisted(() => ({ db: vi.fn(), actor: vi.fn(), series: vi.fn(), session: vi.fn(), notify: vi.fn(),
  announce: vi.fn(), tournament: vi.fn(), identity: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/env", () => ({ env: { discordBotEnabled: true, discordGuildId: "fork-events-test", webUrl: "https://duel.example" } }));
vi.mock("@/lib/duel-host", async importOriginal => ({ ...await importOriginal<object>(),
  requireDuelActor: mocks.actor, callDuelHost: vi.fn() }));
vi.mock("@/lib/web-access", () => ({ requireWebAccess: mocks.session }));
vi.mock("@/lib/notify", () => ({ announcer: { announce: mocks.announce }, broadcaster: { tournament: mocks.tournament } }));
vi.mock("@/lib/notify-duel", () => ({ notifyDuelChange: mocks.notify }));
vi.mock("@/lib/player-lookup", () => ({ playerIdentity: mocks.identity }));
vi.mock("@/lib/draft-decks", () => ({ linkDraftDeck: vi.fn() }));
vi.mock("@/lib/draft-deck-codes", () => ({ mapDraftTournamentDecks: vi.fn(async () => ({ ok: true })) }));
vi.mock("@yugidraft/shared/services", async importOriginal => ({ ...await importOriginal<object>(), createDuelSeriesService: mocks.series }));
import { POST as challenge } from "../app/api/duels/route";
import { POST as tournamentDuel } from "../app/api/tournaments/[slug]/matches/[tmId]/duel/route";

let app: ReturnType<typeof forkEventFixture>;
beforeEach(() => {
  vi.clearAllMocks(); app = forkEventFixture(); mocks.db.mockReturnValue(app.db);
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.actor.mockResolvedValue({ ok: true, ...app.owner, duels: app.duels });
  mocks.session.mockResolvedValue({ ok: true, userId: app.owner.userId });
  const result = { duel: { ...app.duels.get(app.forkSlug, app.guildId), kind: "play" },
    series: { playerIds: [app.owner.playerId, app.alpha.playerId], bestOf: 1, ranked: false }, created: true };
  mocks.series.mockReturnValue({ createChallenge: () => result, startTournamentMatch: () => result });
});
afterEach(() => { app.db.close(); vi.restoreAllMocks(); });

// The service result is mocked: these guards run after the service has already returned (and committed in production).
it("reports the real challenge guard failure after the create service returns", async () => {
  const response = await challenge(new Request("https://duel.example/api/duels", { method: "POST",
    body: JSON.stringify({ mode: "normal", opponentPlayerId: app.alpha.playerId }) }) as never);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "Failed to process duel request" });
  expect(mocks.announce).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled(); expect(mocks.identity).not.toHaveBeenCalled();
});
it("reports the real tournament guard failure after the start service returns", async () => {
  const tournaments = createTournamentService(app.db);
  const tournament = tournaments.create(app.guildId, "Test cup", "round_robin", app.owner.userId);
  app.db.prepare("update tournaments set web_slug='cup' where id=?").run(tournament.id);
  tournaments.join(tournament.id, app.owner.playerId); tournaments.join(tournament.id, app.alpha.playerId); tournaments.start(tournament.id);
  const slot = app.db.prepare("select id from tournament_matches where tournament_id=?").get(tournament.id) as { id: number };
  const response = await tournamentDuel(new Request("https://duel.example/api/tournaments/cup", { method: "POST" }),
    { params: Promise.resolve({ slug: "cup", tmId: String(slot.id) }) });
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "Failed to process duel request" });
  expect(mocks.announce).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled();
  expect(mocks.tournament).not.toHaveBeenCalled(); expect(mocks.identity).not.toHaveBeenCalled();
});
