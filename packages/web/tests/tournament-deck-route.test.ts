import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createSavedDeckService, createTournamentService } from "@yugidraft/shared/services";
import { mainIds, passcodeOf, seedDraftDeck } from "./helpers/draft-deck-fixture";

const auth = vi.fn();
const callDuelHost = vi.fn();
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/duel-host", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/duel-host")>()),
  callDuelHost,
}));
const tempDirs: string[] = [];

const DECK = { main: [1001, 1002, 1003], extra: [], side: [] };

function seed() {
  const dir = mkdtempSync(join(tmpdir(), "tdeck-"));
  tempDirs.push(dir);
  process.env.DATABASE_PATH = join(dir, "bot.sqlite");
  const db = new Database(process.env.DATABASE_PATH);
  migrate(db);
  const insert = db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g1', ?, ?)");
  const a = Number(insert.run("u-a", "Alice").lastInsertRowid);
  const b = Number(insert.run("u-b", "Bob").lastInsertRowid);
  const tournaments = createTournamentService(db);
  const tour = tournaments.create("g1", "Cup", "round_robin", "u-org");
  db.prepare("update tournaments set web_slug = 'cup' where id = ?").run(tour.id);
  tournaments.join(tour.id, a);
  tournaments.join(tour.id, b);
  const saved = createSavedDeckService(db).create("g1", "u-a", { name: "Mine", mode: "normal", deck: DECK });
  return { db, a, tournamentId: tour.id, savedId: saved.id };
}

const ctx = { params: Promise.resolve({ slug: "cup" }) };
const put = (body: unknown) => new Request("http://localhost/x", { method: "PUT", body: JSON.stringify(body) }) as never;
const get = () => new Request("http://localhost/x") as never;

describe("tournament deck route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DISCORD_GUILD_ID", "g1");
    auth.mockReset();
    callDuelHost.mockReset();
    auth.mockResolvedValue({ user: { id: "u-a", name: "Alice" } });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.DATABASE_PATH;
    while (tempDirs.length) {
      const d = tempDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  it("GET lists the player's saved decks and no registration yet", async () => {
    seed();
    const { GET } = await import("../app/api/tournaments/[slug]/deck/route");
    const res = await GET(get(), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { registration: unknown; savedDeckOptions: Array<{ name: string; mainCount: number }> };
    expect(body.registration).toBeNull();
    expect(body.savedDeckOptions).toEqual([expect.objectContaining({ name: "Mine", mainCount: 3 })]);
  });

  it("rejects a caller who is not in the tournament", async () => {
    seed();
    auth.mockResolvedValue({ user: { id: "u-x", name: "Outsider" } });
    const { GET, PUT } = await import("../app/api/tournaments/[slug]/deck/route");
    expect((await GET(get(), ctx)).status).toBe(403);
    expect((await PUT(put({ savedDeckId: 1 }), ctx)).status).toBe(403);
  });

  it("PUT checks the deck on the host and registers the normalized deck", async () => {
    const s = seed();
    const normalized = { main: [2001, 2002, 2003], extra: [], side: [] };
    callDuelHost.mockResolvedValue({ ok: true, data: { deck: normalized, report: { issues: [] } } });
    const { PUT } = await import("../app/api/tournaments/[slug]/deck/route");
    const res = await PUT(put({ savedDeckId: s.savedId }), ctx);
    expect(res.status).toBe(200);
    expect(callDuelHost).toHaveBeenCalledWith(expect.objectContaining({ op: "check-deck", mode: "normal", deck: DECK }));
    const body = (await res.json()) as { registration: { savedDeckId: number; deck: unknown; lockedAt: string | null } };
    expect(body.registration).toMatchObject({ savedDeckId: s.savedId, deck: normalized, lockedAt: null });
  });

  it("PUT returns the report when the deck is not legal", async () => {
    const s = seed();
    const report = { issues: [{ message: "Too few cards", cards: [] }] };
    callDuelHost.mockResolvedValue({ ok: true, data: { deck: DECK, report } });
    const { PUT } = await import("../app/api/tournaments/[slug]/deck/route");
    const res = await PUT(put({ savedDeckId: s.savedId }), ctx);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { report: unknown }).report).toEqual(report);
    expect(s.db.prepare("select deck_json from tournament_participants where player_id = ?").get(s.a)).toEqual({ deck_json: null });
  });

  it.each([false, true])("PUT checks artwork ids in both the draft pool and deck (extra copy: %s)", async (extraCopy) => {
    const fixture = await seedDraftDeck({ picks: [...mainIds(39), 81480461], tournamentUsers: ["drafter"] });
    tempDirs.push(fixture.dir);
    auth.mockResolvedValue({ user: { id: "drafter", name: "Yugi" } });
    const { getDb } = await import("@/lib/db");
    const db = getDb();
    db.prepare("update card_catalog set type = 'Effect Monster', frame_type = 'effect' where ygoprodeck_id = 81480461").run();
    db.prepare("update tournaments set web_slug = 'cup'").run();
    const deck = { main: [...mainIds(39).map(passcodeOf), 81480461], extra: [], side: extraCopy ? [81480460] : [] };
    const saved = createSavedDeckService(db).create("guild-1", "drafter", { name: "Art", mode: "normal", deck, draftId: fixture.draftId });
    callDuelHost.mockImplementation(async (input: { op: string; codes: number[] }) => input.op === "check-deck"
      ? { ok: true, data: { deck, report: { issues: [] } } }
      : { ok: true, data: { codes: Object.fromEntries(input.codes.map((id) => [id, id === 81480461 ? 81480460 : id >= 100000 ? id : passcodeOf(id)])) } });

    const { PUT } = await import("../app/api/tournaments/[slug]/deck/route");
    const res = await PUT(put({ savedDeckId: saved.id }), ctx);
    expect(callDuelHost).toHaveBeenCalledWith(expect.objectContaining({ op: "check-deck", deck }));
    expect(callDuelHost).toHaveBeenCalledWith(expect.objectContaining({ op: "normalize-codes", codes: expect.arrayContaining([81480461]) }));
    expect(res.status).toBe(extraCopy ? 400 : 200);
    const body = await res.json();
    const row = db.prepare("select deck_json from tournament_participants where player_id = ?").get(fixture.players.drafter) as { deck_json: string | null };
    if (extraCopy) {
      expect(body.poolIssues).toEqual([{ code: 81480460, used: 2, available: 1 }]);
      expect(row.deck_json).toBeNull();
    } else {
      expect(body.registration.deck).toEqual(deck);
      expect(JSON.parse(row.deck_json!)).toEqual(deck);
    }
  });

  it("PUT passes a host failure through and rejects a missing deck id", async () => {
    const s = seed();
    callDuelHost.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Duel engine error" }, { status: 503 }) });
    const { PUT } = await import("../app/api/tournaments/[slug]/deck/route");
    expect((await PUT(put({}), ctx)).status).toBe(400);
    expect((await PUT(put({ savedDeckId: s.savedId }), ctx)).status).toBe(503);
  });

  it("PUT refuses a locked deck", async () => {
    const s = seed();
    s.db
      .prepare("update tournament_participants set deck_json = ?, deck_registered_at = current_timestamp, deck_locked_at = current_timestamp where player_id = ?")
      .run(JSON.stringify(DECK), s.a);
    const { PUT } = await import("../app/api/tournaments/[slug]/deck/route");
    const res = await PUT(put({ savedDeckId: s.savedId }), ctx);
    expect(res.status).toBe(409);
    expect(callDuelHost).not.toHaveBeenCalled();
  });
});
