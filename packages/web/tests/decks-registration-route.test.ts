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
    auth.mockResolvedValue({ user: { id: "drafter", name: "Yugi" } });
    callDuelHost.mockImplementation(async (input: { codes: number[] }) => ({
      ok: true,
      data: { codes: Object.fromEntries(input.codes.map((id) => [String(id), passcodeOf(id)])) },
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
