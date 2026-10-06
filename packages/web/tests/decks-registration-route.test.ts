import { fixtureUserId, fixtureDiscordId } from "./fixtures/identity";
import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mainIds, passcodeOf, seedDraftDeck } from "./helpers/draft-deck-fixture";

const auth = vi.fn();
const callDuelHost = vi.fn();
const dirs: string[] = [];
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/duel-host", () => ({ callDuelHost }));

const main = (count: number) => mainIds(count).map(passcodeOf);

describe("deck registration marks", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    callDuelHost.mockReset();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("drafter")), discordUserId: fixtureDiscordId("drafter"), name: "Yugi" } });
    callDuelHost.mockImplementation(async (input: { codes: number[] }) => ({
      ok: true,
      data: { codes: Object.fromEntries(input.codes.map((id) => [String(id), id === 81480461 ? 81480460 : id >= 100000 ? id : passcodeOf(id)])) },
    }));
  });
  afterEach(() => {
    delete process.env.DATABASE_PATH;
    delete process.env.DISCORD_GUILD_ID;
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  async function seed(options: Partial<Parameters<typeof seedDraftDeck>[0]> = {}) {
    const fixture = await seedDraftDeck({ picks: mainIds(45), tournamentUsers: ["drafter"], ...options });
    dirs.push(fixture.dir);
    return fixture;
  }
  async function saveDraftDeck(draftId: number) {
    const { POST } = await import("../app/api/decks/route");
    const res = await POST(new Request("http://localhost/api/decks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "D", mode: "normal", deck: { main: main(40), extra: [], side: [] }, draftId }),
    }));
    return res;
  }
  async function listDecks() {
    const { GET } = await import("../app/api/decks/route");
    return (await (await GET()).json()) as { decks: Array<{ id: number; registration: unknown }> };
  }
  async function withDb<T>(work: (db: import("better-sqlite3").Database) => T): Promise<T> {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(process.env.DATABASE_PATH!);
    try {
      return work(db);
    } finally {
      db.close();
    }
  }

  it("marks a draft deck with its tournament on the list, the deck, the save response and the pool", async () => {
    const { draftId } = await seed();
    const saved = await saveDraftDeck(draftId);
    expect(saved.status).toBe(201);
    const created = (await saved.json()).deck as { id: number; registration: unknown };
    const expected = { tournament: { id: expect.any(Number), slug: expect.any(String), name: "T", status: "pending" }, locked: false };
    expect(created.registration).toMatchObject(expected);

    expect((await listDecks()).decks).toEqual([expect.objectContaining({ id: created.id, registration: expect.objectContaining(expected) })]);

    const { GET: getDeck } = await import("../app/api/decks/[id]/route");
    const one = await getDeck(new Request("http://localhost/api/decks/1"), { params: Promise.resolve({ id: String(created.id) }) });
    expect((await one.json()).deck.registration).toMatchObject(expected);

    const { GET: getPool } = await import("../app/api/drafts/[slug]/deck-pool/route");
    const pool = await getPool(new Request("http://localhost/api/drafts/slug-1/deck-pool"), { params: Promise.resolve({ slug: "slug-1" }) });
    expect((await pool.json()).registration).toMatchObject(expected);
  });

  it("shows the lock once the first game has started", async () => {
    const { draftId, players } = await seed();
    const created = (await (await saveDraftDeck(draftId)).json()).deck as { id: number };
    await withDb((db) =>
      db.prepare("update tournament_participants set deck_locked_at = datetime('now') where player_id = ?").run(players.drafter),
    );
    const [deck] = (await listDecks()).decks;
    expect(deck.id).toBe(created.id);
    expect(deck.registration).toMatchObject({ locked: true });
  });

  it("maps a high artwork id on save, registration and load", async () => {
    const { draftId } = await seed({ picks: [...mainIds(39), 81480461] });
    await withDb((db) => db.prepare("update card_catalog set type = 'Effect Monster', frame_type = 'effect' where ygoprodeck_id = 81480461").run());
    const raw = { main: [...mainIds(39), 81480461], extra: [], side: [] };
    const mapped = { ...raw, main: [...main(39), 81480460] };
    const { POST } = await import("../app/api/decks/route");
    const res = await POST(new Request("http://localhost/api/decks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Art", mode: "normal", deck: raw, draftId }),
    }));
    expect(res.status).toBe(201);
    const saved = (await res.json()).deck;
    expect(saved.deck).toEqual(mapped);
    expect(saved.registration).toMatchObject({ locked: false });
    expect(callDuelHost).toHaveBeenCalledWith(expect.objectContaining({ op: "normalize-codes", codes: expect.arrayContaining([81480461]) }));
    await withDb((db) => {
      const registered = db.prepare("select deck_json from tournament_participants").get() as { deck_json: string };
      expect(JSON.parse(registered.deck_json)).toEqual(mapped);
      db.prepare("update saved_decks set deck_json = ? where id = ?").run(JSON.stringify(raw), saved.id);
    });
    callDuelHost.mockClear();
    const { GET } = await import("../app/api/decks/[id]/route");
    const loaded = await GET(new Request(`http://localhost/api/decks/${saved.id}`), { params: Promise.resolve({ id: String(saved.id) }) });
    expect(loaded.status).toBe(200);
    expect((await loaded.json()).deck.deck).toEqual(mapped);
    expect(callDuelHost).toHaveBeenCalledWith(expect.objectContaining({ op: "normalize-codes", codes: raw.main }));
    await withDb((db) => {
      const stored = db.prepare("select deck_json from saved_decks where id = ?").get(saved.id) as { deck_json: string };
      expect(JSON.parse(stored.deck_json)).toEqual(raw);
    });
  });

  it("is null once the tournament has finished, and for a deck in no tournament", async () => {
    const { draftId } = await seed();
    await saveDraftDeck(draftId);
    await withDb((db) => db.prepare("update tournaments set status = 'completed'").run());
    expect((await listDecks()).decks[0].registration).toBeNull();

    const { POST } = await import("../app/api/decks/route");
    const plain = await POST(new Request("http://localhost/api/decks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Plain", mode: "normal", deck: { main: main(40), extra: [], side: [] } }),
    }));
    expect((await plain.json()).deck.registration).toBeNull();
  });

  it("follows the saved deck id for a registered non-draft deck", async () => {
    const { players } = await seed({ tournamentUsers: ["drafter"] });
    const { POST } = await import("../app/api/decks/route");
    const plain = await POST(new Request("http://localhost/api/decks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Plain", mode: "normal", deck: { main: main(40), extra: [], side: [] } }),
    }));
    const id = (await plain.json()).deck.id as number;
    await withDb((db) =>
      db.prepare(
        "update tournament_participants set saved_deck_id = ?, deck_json = '{}', deck_registered_at = datetime('now') where player_id = ?",
      ).run(id, players.drafter),
    );
    expect((await listDecks()).decks.find((deck) => deck.id === id)?.registration).toMatchObject({ locked: false });
  });
});

const FIXTURE_KEYS = ["drafter"] as const;

// Membership is a dependency of these routes; authorization still runs through the real web boundary.
vi.mock("@/lib/discord-guild-membership", () => ({ verifyDiscordGuildMembership: vi.fn(async () => ({ ok: true })) }));
