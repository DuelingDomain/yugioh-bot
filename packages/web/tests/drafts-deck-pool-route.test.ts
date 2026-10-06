import { fixtureUserId, fixtureDiscordId } from "./fixtures/identity";
import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mainIds, passcodeOf, seedDraftDeck } from "./helpers/draft-deck-fixture";

const auth = vi.fn();
const callDuelHost = vi.fn();
const dirs: string[] = [];
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/duel-host", () => ({ callDuelHost }));

/** Maps every id to a passcode, except the ids in `unknown`. */
function hostKnowing(unknown: number[] = []) {
  callDuelHost.mockImplementation(async (input: { codes: number[] }) => ({
    ok: true,
    data: { codes: Object.fromEntries(input.codes.map((id) => [String(id), unknown.includes(id) ? null : passcodeOf(id)])) },
  }));
}

describe("GET /api/drafts/[slug]/deck-pool", () => {
  it("returns forced copy counts for the draft deck UI", async () => {
    await seed({ picks: [1, 1, 1, 1], forcedPicks: [3] });
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      cards: [{ code: passcodeOf(1), count: 4 }],
      forcedCopies: { [passcodeOf(1)]: 1 },
      mainPoolCount: 4,
    });
  });

  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    callDuelHost.mockReset();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("drafter")), discordUserId: fixtureDiscordId("drafter"), name: "Yugi" } });
    hostKnowing();
  });
  afterEach(() => {
    delete process.env.DATABASE_PATH;
    delete process.env.DISCORD_GUILD_ID;
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  const req = () => new Request("http://localhost/api/drafts/slug-1/deck-pool");
  const params = (slug = "slug-1") => ({ params: Promise.resolve({ slug }) });
  async function call(slug?: string) {
    const { GET } = await import("../app/api/drafts/[slug]/deck-pool/route");
    return GET(req(), params(slug));
  }
  async function seed(options: Parameters<typeof seedDraftDeck>[0]) {
    const fixture = await seedDraftDeck(options);
    dirs.push(fixture.dir);
    return fixture;
  }

  it("401 when signed out", async () => {
    await seed({ picks: mainIds(3) });
    auth.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("404 for an unknown draft", async () => {
    await seed({ picks: mainIds(3) });
    expect((await call("nope")).status).toBe(404);
  });

  it("403 when the caller is not a draft player", async () => {
    await seed({ picks: mainIds(3) });
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("outsider")), discordUserId: fixtureDiscordId("outsider"), name: "Kaiba" } });
    expect((await call()).status).toBe(403);
  });

  it("409 while the draft is not completed", async () => {
    await seed({ picks: mainIds(3), status: "active" });
    expect((await call()).status).toBe(409);
  });

  it("returns the pool as passcodes with copy counts and the main pool size", async () => {
    // Card 1 twice, card 2 once, and one Fusion Monster (Extra Deck).
    const { draftId } = await seed({ picks: [1, 1, 2, 2001] });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      draftId,
      draftName: "Friday Draft",
      cards: [
        { code: passcodeOf(1), count: 2 },
        { code: passcodeOf(2), count: 1 },
        { code: passcodeOf(2001), count: 1 },
      ],
      forcedCopies: {},
      mainPoolCount: 3,
      savedDeckId: null,
      registration: null,
      unresolved: [],
    });
    expect(callDuelHost).toHaveBeenCalledWith(expect.objectContaining({ op: "normalize-codes", codes: [1, 2, 2001] }));
  });

  it("asks the host in chunks of at most 1000 ids", async () => {
    callDuelHost.mockImplementation(async (input: { codes: number[] }) =>
      input.codes.length > 1000
        ? { ok: false, response: (await import("next/server")).NextResponse.json({ error: "too many" }, { status: 400 }) }
        : { ok: true, data: { codes: Object.fromEntries(input.codes.map((id) => [String(id), passcodeOf(id)])) } },
    );
    await seed({ picks: mainIds(1001) });
    const res = await call();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.cards).toHaveLength(1001);
    expect(json.mainPoolCount).toBe(1001);
    expect(callDuelHost.mock.calls.map(([input]) => input.codes.length)).toEqual([1000, 1]);
  });

  it("counts Pendulum Extra Deck monsters as Extra Deck", async () => {
    // 2001 stays a Fusion Monster; 2002 and 2003 become Synchro and Xyz Pendulum monsters.
    await seed({ picks: [1, 2001, 2002, 2003] });
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(process.env.DATABASE_PATH!);
    const update = db.prepare("update card_catalog set type = ?, frame_type = ? where ygoprodeck_id = ?");
    update.run("Synchro Pendulum Effect Monster", "synchro_pendulum", 2002);
    update.run("XYZ Pendulum Effect Monster", "xyz_pendulum", 2003);
    db.close();
    expect((await (await call()).json()).mainPoolCount).toBe(1);
  });

  it("drops ids the engine does not know and lists them", async () => {
    hostKnowing([2]);
    await seed({ picks: [1, 2, 3] });
    const json = await (await call()).json();
    expect(json.cards.map((card: { code: number }) => card.code)).toEqual([passcodeOf(1), passcodeOf(3)]);
    expect(json.unresolved).toEqual([2]);
    expect(json.mainPoolCount).toBe(2);
  });

  it("returns savedDeckId when the player already has a draft deck", async () => {
    const { draftId } = await seed({ picks: mainIds(3) });
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(process.env.DATABASE_PATH!);
    const id = Number(
      db.prepare(
        `insert into saved_decks (guild_id, owner_user_id, name, mode, deck_json, draft_id) values ('guild-1', ${fixtureUserId("drafter")}, 'Mine', 'normal', '{"main":[], "extra":[], "side":[]}', ?)`,
      ).run(draftId).lastInsertRowid,
    );
    db.close();
    expect((await (await call()).json()).savedDeckId).toBe(id);
  });

  it("passes on a duel host failure", async () => {
    const { NextResponse } = await import("next/server");
    callDuelHost.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "down" }, { status: 503 }) });
    await seed({ picks: mainIds(3) });
    expect((await call()).status).toBe(503);
  });
});

const FIXTURE_KEYS = ["drafter", "outsider"] as const;

// Membership is a dependency of these routes; authorization still runs through the real web boundary.
vi.mock("@/lib/discord-guild-membership", () => ({ verifyDiscordGuildMembership: vi.fn(async () => ({ ok: true })) }));
