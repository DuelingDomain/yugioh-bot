import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./fixtures/identity";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createSavedDeckService, createTournamentService } from "@yugidraft/shared/services";

const auth = vi.fn();
const callDuelHost = vi.fn();
const backfillDraftDecks = vi.fn();
const linkDraftDeck = vi.fn();
const draftDeckNoteFor = vi.fn();
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/duel-host", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/duel-host")>()),
  callDuelHost,
}));
vi.mock("@/lib/notify", () => ({
  broadcaster: { draft: vi.fn(), tournament: vi.fn() },
  announcer: { announce: vi.fn() },
}));
vi.mock("@/lib/draft-decks", () => ({ backfillDraftDecks, linkDraftDeck, draftDeckNoteFor }));

const tempDirs: string[] = [];
const DECK = { main: [1001, 1002, 1003], extra: [], side: [] };
const NOTE = { level: "optional", mainCount: 3, message: "Your draft deck has 3 main deck cards." };

/** A draft tournament with Alice in it, her draft deck saved; `registered` puts it on her entry. */
function seed(opts: { draft: boolean; registered?: boolean; pending?: boolean }) {
  const dir = mkdtempSync(join(tmpdir(), "tdeck-hooks-"));
  tempDirs.push(dir);
  process.env.DATABASE_PATH = join(dir, "bot.sqlite");
  const db = new Database(process.env.DATABASE_PATH);
  migrate(db);
  seedFixtureUsers(db, FIXTURE_KEYS);
  const alice = Number(db.prepare(`insert into players (guild_id, user_id, discord_user_id, display_name) values ('g1', ${fixtureUserId("u-a")}, '${fixtureDiscordId("u-a")}', 'Alice')`).run().lastInsertRowid);
  const tournaments = createTournamentService(db);
  const tour = tournaments.create("g1", "Cup", "round_robin", fixtureUserId("u-org"));
  db.prepare("update tournaments set web_slug = 'cup' where id = ?").run(tour.id);
  let draftId: number | undefined;
  if (opts.draft) {
    draftId = Number(
      db.prepare(
        `insert into drafts (guild_id, channel_id, name, status, created_by_user_id, config_json, web_slug, tournament_id) values ('g1', 'c', 'Cube', 'completed', ${fixtureUserId("u-org")}, '{}', 'cube-1', ?)`,
      ).run(tour.id).lastInsertRowid,
    );
  }
  tournaments.join(tour.id, alice);
  if (!opts.pending) db.prepare("update tournaments set status = 'active' where id = ?").run(tour.id);
  const saved = createSavedDeckService(db).create("g1", fixtureUserId("u-a"), { name: "Cube draft, 2026-10-03", mode: "normal", deck: DECK, draftId });
  if (opts.registered) {
    db.prepare("update tournament_participants set saved_deck_id = ?, deck_json = ?, deck_registered_at = '2026-10-03 10:00:00' where tournament_id = ? and player_id = ?")
      .run(saved.id, JSON.stringify(DECK), tour.id, alice);
  }
  return { db, alice, tournamentId: tour.id, draftId, savedId: saved.id };
}

const ctx = { params: Promise.resolve({ slug: "cup" }) };
const get = () => new Request("http://localhost/x") as never;
const post = () => new Request("http://localhost/x", { method: "POST" }) as never;

describe("draft deck hooks in the tournament routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DISCORD_GUILD_ID", "g1");
    for (const mock of [auth, callDuelHost, backfillDraftDecks, linkDraftDeck, draftDeckNoteFor]) mock.mockReset();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-a")), discordUserId: fixtureDiscordId("u-a"), name: "Alice" } });
    draftDeckNoteFor.mockReturnValue(NOTE);
    callDuelHost.mockResolvedValue({ ok: false, response: new Response(null, { status: 503 }) });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.DATABASE_PATH;
    while (tempDirs.length) {
      const d = tempDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  it("deck GET for a draft tournament backfills, links the player and returns the size note", async () => {
    const s = seed({ draft: true });
    const { GET } = await import("../app/api/tournaments/[slug]/deck/route");
    const res = await GET(get(), ctx);
    expect(res.status).toBe(200);
    expect(backfillDraftDecks).toHaveBeenCalledWith("g1", fixtureUserId("u-a"), expect.anything());
    expect(linkDraftDeck).toHaveBeenCalledWith(s.tournamentId, s.alice, expect.anything());
    const body = (await res.json()) as { deckNote: unknown; savedDeckOptions: Array<{ id: number }> };
    expect(body.savedDeckOptions).toEqual([expect.objectContaining({ id: s.savedId })]);
    expect(body.deckNote).toEqual(NOTE);
  });

  it("deck GET for another tournament leaves the draft deck code alone", async () => {
    seed({ draft: false });
    const { GET } = await import("../app/api/tournaments/[slug]/deck/route");
    const res = await GET(get(), ctx);
    expect(backfillDraftDecks).not.toHaveBeenCalled();
    expect(linkDraftDeck).not.toHaveBeenCalled();
    expect(((await res.json()) as { deckNote: unknown }).deckNote).toBeNull();
  });

  it("deck GET does not call the host: mapping happens when the series starts", async () => {
    const s = seed({ draft: true, registered: true });
    const { GET } = await import("../app/api/tournaments/[slug]/deck/route");
    const res = await GET(get(), ctx);
    expect(res.status).toBe(200);
    expect(callDuelHost).not.toHaveBeenCalled();
    expect(((await res.json()) as { registration: { savedDeckId: number; deck: unknown } }).registration).toMatchObject({
      savedDeckId: s.savedId,
      deck: DECK,
    });
  });

  it("join links the player's draft deck right after the entry is made", async () => {
    const s = seed({ draft: true, pending: true });
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("u-b")), discordUserId: fixtureDiscordId("u-b"), name: "Bob" } });
    const { POST } = await import("../app/api/tournaments/[slug]/join/route");
    const res = await POST(post(), ctx);
    expect(res.status).toBe(200);
    const bob = (await res.json()) as { playerId: number };
    expect(backfillDraftDecks).toHaveBeenCalledWith("g1", fixtureUserId("u-b"), expect.anything());
    expect(linkDraftDeck).toHaveBeenCalledWith(s.tournamentId, bob.playerId, expect.anything());
  });

  it("the tournament GET links the viewer first and sends the size note", async () => {
    const s = seed({ draft: true });
    const { GET } = await import("../app/api/tournaments/[slug]/route");
    const res = await GET(get(), ctx);
    expect(res.status).toBe(200);
    expect(linkDraftDeck).toHaveBeenCalledWith(s.tournamentId, s.alice, expect.anything());
    expect(draftDeckNoteFor).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ draftId: s.draftId, playerId: s.alice, deck: DECK }));
    expect(((await res.json()) as { deckNote: unknown }).deckNote).toEqual(NOTE);
  });

  it("the tournament GET sends no note and does no draft work for a viewer outside the draft", async () => {
    seed({ draft: false });
    const { GET } = await import("../app/api/tournaments/[slug]/route");
    const res = await GET(get(), ctx);
    expect(linkDraftDeck).not.toHaveBeenCalled();
    expect(((await res.json()) as { deckNote: unknown }).deckNote).toBeNull();
  });
});

const FIXTURE_KEYS = ["u-a", "u-org", "u-b"] as const;

// Membership is a dependency of these routes; authorization still runs through the real web boundary.
vi.mock("@/lib/discord-guild-membership", () => ({ verifyDiscordGuildMembership: vi.fn(async () => ({ ok: true })) }));
