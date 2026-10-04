import { rmSync } from "node:fs";
import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mainIds, passcodeOf, seedDraftDeck, type DraftDeckFixture } from "./helpers/draft-deck-fixture";

const auth = vi.fn();
const callDuelHost = vi.fn();
const dirs: string[] = [];
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/duel-host", () => ({ callDuelHost }));

// Pool: cards 1..45 once each, card 1 a second time, and Fusion Monster 2001 once.
const POOL = [...mainIds(45), 1, 2001];
const main = (count: number, from = 1) => mainIds(count, from).map(passcodeOf);

function deckBody(deck: { main: number[]; extra?: number[]; side?: number[] }, extra: Record<string, unknown> = {}) {
  return { name: "My draft deck", mode: "normal", deck: { main: deck.main, extra: deck.extra ?? [], side: deck.side ?? [] }, ...extra };
}

describe("draft decks through /api/decks", () => {
  let fixture: DraftDeckFixture;

  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    callDuelHost.mockReset();
    auth.mockResolvedValue({ user: { id: "drafter", name: "Yugi" } });
    callDuelHost.mockImplementation(async (input: { codes: number[] }) => ({
      ok: true,
      data: { codes: Object.fromEntries(input.codes.map((id) => [String(id), id >= 100000 ? id : passcodeOf(id)])) },
    }));
  });
  afterEach(() => {
    delete process.env.DATABASE_PATH;
    delete process.env.DISCORD_GUILD_ID;
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  async function seed(options: Partial<Parameters<typeof seedDraftDeck>[0]> = {}) {
    fixture = await seedDraftDeck({ picks: POOL, ...options });
    dirs.push(fixture.dir);
    return fixture;
  }
  async function post(body: unknown) {
    const { POST } = await import("../app/api/decks/route");
    return POST(
      new Request("http://localhost/api/decks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    );
  }
  async function put(id: number, body: unknown) {
    const { PUT } = await import("../app/api/decks/[id]/route");
    return PUT(
      new Request(`http://localhost/api/decks/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      { params: Promise.resolve({ id: String(id) }) },
    );
  }
  async function registration(): Promise<{ saved_deck_id: number | null; deck_json: string | null } | undefined> {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(process.env.DATABASE_PATH!);
    const row = db.prepare("select saved_deck_id, deck_json from tournament_participants").get() as
      | { saved_deck_id: number | null; deck_json: string | null }
      | undefined;
    db.close();
    return row;
  }

  describe("POST", () => {
    it("saves a legal deck for the draft", async () => {
      const { draftId } = await seed();
      const res = await post(deckBody({ main: main(40) }, { draftId }));
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.deck.draftId).toBe(draftId);
      expect(json.warning).toBeUndefined();
    });

    it("lets a deck use a second copy the pool has", async () => {
      const { draftId } = await seed();
      const res = await post(deckBody({ main: [...main(40), passcodeOf(1)] }, { draftId }));
      expect(res.status).toBe(201);
    });

    it("409 with the existing id when the draft already has a deck", async () => {
      const { draftId } = await seed();
      const first = await (await post(deckBody({ main: main(40) }, { draftId }))).json();
      const res = await post(deckBody({ main: main(41) }, { draftId }));
      expect(res.status).toBe(409);
      expect((await res.json()).deckId).toBe(first.deck.id);
    });

    it("answers the loser of a double click with the winner's id", async () => {
      const { draftId } = await seed();
      // Both requests pass the lookup before either saves, so the unique index decides.
      const [a, b] = await Promise.all([
        post(deckBody({ main: main(40) }, { draftId })),
        post(deckBody({ main: main(40) }, { draftId })),
      ]);
      const [created, refused] = a.status === 201 ? [a, b] : [b, a];
      expect(created.status).toBe(201);
      expect(refused.status).toBe(409);
      const winner = (await created.json()).deck.id;
      expect((await refused.json()).deckId).toBe(winner);
    });

    it("403 when the caller is not a draft player", async () => {
      const { draftId } = await seed();
      auth.mockResolvedValue({ user: { id: "outsider", name: "Kaiba" } });
      expect((await post(deckBody({ main: main(40) }, { draftId }))).status).toBe(403);
    });

    it("404 for an unknown draft", async () => {
      await seed();
      expect((await post(deckBody({ main: main(40) }, { draftId: 999 }))).status).toBe(404);
    });

    it("409 while the draft is not finished", async () => {
      const { draftId } = await seed({ status: "active" });
      expect((await post(deckBody({ main: main(40) }, { draftId }))).status).toBe(409);
    });

    it("400 for a draftId that is not a positive integer", async () => {
      await seed();
      expect((await post(deckBody({ main: main(40) }, { draftId: "1" }))).status).toBe(400);
      expect((await post(deckBody({ main: main(40) }, { draftId: 0 }))).status).toBe(400);
    });

    it("400 when a card is used more often than the pool has", async () => {
      const { draftId } = await seed();
      const res = await post(deckBody({ main: [...main(40), passcodeOf(2), passcodeOf(2)] }, { draftId }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.issues).toEqual([{ code: passcodeOf(2), used: 3, available: 1 }]);
    });

    it("rejects a fourth copy even when five copies were drafted", async () => {
      const { draftId } = await seed({ picks: [...mainIds(40), 1, 1, 1, 1] });
      const res = await post(deckBody({ main: main(40), side: [passcodeOf(1), passcodeOf(1), passcodeOf(1)] }, { draftId }));
      expect(res.status).toBe(400);
      expect((await res.json()).issues).toEqual([{ code: passcodeOf(1), used: 4, available: 3 }]);
    });

    it("400 for a card that is not in the pool", async () => {
      const { draftId } = await seed();
      const res = await post(deckBody({ main: [...main(39), passcodeOf(500)] }, { draftId }));
      expect(res.status).toBe(400);
      expect((await res.json()).issues).toEqual([{ code: passcodeOf(500), used: 1, available: 0 }]);
    });

    it("counts Side Deck copies against the pool", async () => {
      const { draftId } = await seed();
      const res = await post(deckBody({ main: main(40), side: [passcodeOf(3)] }, { draftId }));
      expect(res.status).toBe(400);
    });

    it("400 when the Main Deck has fewer than 40 cards", async () => {
      const { draftId } = await seed();
      const res = await post(deckBody({ main: main(39) }, { draftId }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/at least 40/);
    });

    it("400 when the Extra Deck has more than 15 cards", async () => {
      const { draftId } = await seed({ picks: [...POOL, ...mainIds(15, 2002)] });
      const extra = [2001, ...mainIds(15, 2002)].map(passcodeOf);
      const res = await post(deckBody({ main: main(40), extra }, { draftId }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/Extra Deck holds at most 15/);
    });

    it("400 when the Main Deck has more than 60 cards", async () => {
      const { draftId } = await seed({ picks: mainIds(65) });
      const res = await post(deckBody({ main: main(61) }, { draftId }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/at most 60/);
    });

    it("needs only the whole main pool when it has fewer than 40 cards", async () => {
      const { draftId } = await seed({ picks: [...mainIds(30), 2001] });
      expect((await post(deckBody({ main: main(29) }, { draftId }))).status).toBe(400);
      expect((await post(deckBody({ main: main(30), extra: [passcodeOf(2001)] }, { draftId }))).status).toBe(201);
    });

    it("saves a deck with no draftId without a pool check", async () => {
      await seed();
      const res = await post(deckBody({ main: main(3) }));
      expect(res.status).toBe(201);
      expect(callDuelHost).not.toHaveBeenCalled();
    });

    it("registers the deck for the draft tournament", async () => {
      const { draftId } = await seed({ tournamentUsers: ["drafter"] });
      const res = await post(deckBody({ main: main(40) }, { draftId }));
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.warning).toBeUndefined();
      const row = await registration();
      expect(row?.saved_deck_id).toBe(json.deck.id);
      expect(row?.deck_json).not.toBeNull();
    });

    it("does not register when the player is not a tournament participant", async () => {
      const { draftId } = await seed({ tournamentUsers: ["outsider"] });
      const res = await post(deckBody({ main: main(40) }, { draftId }));
      expect(res.status).toBe(201);
      expect((await res.json()).warning).toBeUndefined();
    });

    it("keeps the saved deck and skips registration when the deck is locked", async () => {
      const { draftId, players } = await seed({ tournamentUsers: ["drafter"] });
      const Database = (await import("better-sqlite3")).default;
      const db = new Database(process.env.DATABASE_PATH!);
      db.prepare("update tournament_participants set deck_json = '{}', deck_locked_at = ? where player_id = ?").run(
        new Date().toISOString(),
        players.drafter,
      );
      db.close();
      const res = await post(deckBody({ main: main(40) }, { draftId }));
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.warning).toBeUndefined();
      expect((await registration())?.deck_json).toBe("{}");
    });

    it("reports a warning when registration fails for another reason", async () => {
      const { draftId } = await seed({ tournamentUsers: ["drafter"], tournamentStatus: "completed" });
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await post(deckBody({ main: main(40) }, { draftId }));
      error.mockRestore();
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.deck.draftId).toBe(draftId);
      expect(json.warning).toMatch(/not registered for the tournament/);
    });
  });

  describe("GET", () => {
    it.each(["unavailable", "invalid"])("returns the stored draft deck when the engine mapping is %s", async (failure) => {
      const { draftId } = await seed({ picks: [...mainIds(39), 81480461] });
      const { getDb } = await import("@/lib/db");
      const { createSavedDeckService } = await import("@yugidraft/shared/services");
      const db = getDb();
      const raw = { main: [...mainIds(39), 81480461], extra: [2001], side: [81480461], deckMaster: 81480461 };
      const saved = createSavedDeckService(db).create("guild-1", "drafter", { name: "Stored art", mode: "domain", deck: raw, draftId });
      callDuelHost.mockResolvedValue(failure === "unavailable"
        ? { ok: false, response: NextResponse.json({ error: "Duel engine unavailable" }, { status: 503 }) }
        : { ok: true, data: { codes: {} } });

      const { GET } = await import("../app/api/decks/[id]/route");
      const res = await GET(new Request(`http://localhost/api/decks/${saved.id}`), { params: Promise.resolve({ id: String(saved.id) }) });
      expect(res.status).toBe(200);
      expect((await res.json()).deck).toMatchObject({ id: saved.id, name: "Stored art", draftId, deck: raw });
      expect(callDuelHost).toHaveBeenCalledWith(expect.objectContaining({ op: "normalize-codes", codes: expect.arrayContaining([81480461, 2001]) }));
      expect(createSavedDeckService(db).get(saved.id, "guild-1", "drafter").deck).toEqual(raw);
    });
  });

  describe("DELETE", () => {
    async function del(id: number) {
      const { DELETE } = await import("../app/api/decks/[id]/route");
      return DELETE(new Request(`http://localhost/api/decks/${id}`, { method: "DELETE" }), {
        params: Promise.resolve({ id: String(id) }),
      });
    }
    async function setTournamentStatus(status: string) {
      const Database = (await import("better-sqlite3")).default;
      const db = new Database(process.env.DATABASE_PATH!);
      db.prepare("update tournaments set status = ?").run(status);
      db.close();
    }
    async function registeredDeck() {
      const { draftId } = await seed({ tournamentUsers: ["drafter"] });
      return (await (await post(deckBody({ main: main(40) }, { draftId }))).json()).deck.id as number;
    }

    it("refuses a deck registered for a pending tournament", async () => {
      const id = await registeredDeck();
      const res = await del(id);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/registered for the tournament "T"/);
      expect((await registration())?.saved_deck_id).toBe(id);
    });

    it("refuses a deck registered for an active tournament", async () => {
      const id = await registeredDeck();
      await setTournamentStatus("active");
      expect((await del(id)).status).toBe(409);
    });

    it("deletes a deck registered for a completed or cancelled tournament", async () => {
      const first = await registeredDeck();
      await setTournamentStatus("completed");
      expect((await del(first)).status).toBe(200);
    });

    it("deletes a deck that no tournament uses", async () => {
      await seed();
      const created = await (await post(deckBody({ main: main(3) }))).json();
      expect((await del(created.deck.id)).status).toBe(200);
    });

    it("404 for a deck of another player, with no tournament detail", async () => {
      const id = await registeredDeck();
      auth.mockResolvedValue({ user: { id: "outsider", name: "Kaiba" } });
      expect((await del(id)).status).toBe(404);
    });
  });

  describe("PUT", () => {
    it("does not drop an invalid master while normalizing a draft deck", async () => {
      const { draftId } = await seed();
      const body = deckBody({ main: main(40) }, { draftId });
      const res = await post({ ...body, deck: { ...body.deck, deckMaster: "81480461" } });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/Deck Master must be a valid card code/);
    });

    it("keeps the stored deck when the engine mapping is incomplete", async () => {
      const { id } = await savedDeck();
      callDuelHost.mockResolvedValue({ ok: true, data: { codes: {} } });
      expect((await put(id, deckBody({ main: main(42) }))).status).toBe(502);
      const { getDb } = await import("@/lib/db");
      const row = getDb().prepare("select deck_json from saved_decks where id = ?").get(id) as { deck_json: string };
      expect(JSON.parse(row.deck_json).main).toEqual(main(40));
    });

    it("repairs an existing auto-save with the reported Barrel Dragon artwork id on load and save", async () => {
      const { draftId } = await seed({ picks: [...mainIds(39), 81480461] });
      const { getDb } = await import("@/lib/db");
      const db = getDb();
      db.prepare("update card_catalog set name = 'Barrel Dragon', type = 'Effect Monster', frame_type = 'effect' where ygoprodeck_id = 81480461").run();
      const { createDraftDeckService, createSavedDeckService } = await import("@yugidraft/shared/services");
      createDraftDeckService(db).saveForDraft(draftId);
      const saved = createSavedDeckService(db).findByDraft("guild-1", "drafter", draftId)!;
      expect(saved.deck.main).toContain(81480461);
      callDuelHost.mockImplementation(async (input: { codes: number[] }) => ({
        ok: true,
        data: { codes: Object.fromEntries(input.codes.map((id) => [id, id === 81480461 ? 81480460 : id >= 100000 ? id : passcodeOf(id)])) },
      }));
      const { GET } = await import("../app/api/decks/[id]/route");
      const loaded = await GET(new Request(`http://localhost/api/decks/${saved.id}`), { params: Promise.resolve({ id: String(saved.id) }) });
      expect(loaded.status).toBe(200);
      expect((await loaded.json()).deck.deck.main).toEqual([...main(39), 81480460]);
      // Reads do not rewrite production data. PUT also repairs clients that loaded before the fix.
      expect(JSON.parse((db.prepare("select deck_json from saved_decks where id = ?").get(saved.id) as { deck_json: string }).deck_json).main).toContain(81480461);
      const res = await put(saved.id, deckBody(saved.deck));
      expect(res.status).toBe(200);
      expect((await res.json()).deck.deck.main).toEqual([...main(39), 81480460]);
      expect(createSavedDeckService(db).get(saved.id, "guild-1", "drafter").deck.main).toEqual([...main(39), 81480460]);
    });

    it("rejects excess copies when main and side use different artworks", async () => {
      const { draftId } = await seed({ picks: [...mainIds(39), 81480461] });
      const { getDb } = await import("@/lib/db");
      getDb().prepare("update card_catalog set type = 'Effect Monster', frame_type = 'effect' where ygoprodeck_id = 81480461").run();
      callDuelHost.mockImplementation(async (input: { codes: number[] }) => ({
        ok: true,
        data: { codes: Object.fromEntries(input.codes.map((id) => [id, id === 81480461 ? 81480460 : id >= 100000 ? id : passcodeOf(id)])) },
      }));
      const res = await post(deckBody({ main: [...main(39), 81480460], side: [81480461] }, { draftId }));
      expect(res.status).toBe(400);
      expect((await res.json()).issues).toEqual([{ code: 81480460, used: 2, available: 1 }]);
    });
    async function savedDeck() {
      const { draftId } = await seed();
      const created = await (await post(deckBody({ main: main(40) }, { draftId }))).json();
      return { draftId, id: created.deck.id as number };
    }

    it("saves a changed deck", async () => {
      const { draftId, id } = await savedDeck();
      const res = await put(id, deckBody({ main: main(42) }, { draftId }));
      expect(res.status).toBe(200);
      expect((await res.json()).deck.deck.main).toHaveLength(42);
    });

    it("still checks the pool when the body has no draftId", async () => {
      const { id } = await savedDeck();
      const res = await put(id, deckBody({ main: [...main(40), passcodeOf(2), passcodeOf(2)] }));
      expect(res.status).toBe(400);
      expect((await put(id, deckBody({ main: main(10) }))).status).toBe(400);
    });

    it("400 when the body names another draft", async () => {
      const { draftId, id } = await savedDeck();
      const res = await put(id, deckBody({ main: main(40) }, { draftId: draftId + 1 }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/another draft/);
    });

    it("403 when the owner is no longer a draft player", async () => {
      const { draftId, id } = await savedDeck();
      const Database = (await import("better-sqlite3")).default;
      const db = new Database(process.env.DATABASE_PATH!);
      db.pragma("foreign_keys = off");
      db.prepare("update draft_players set player_id = ? where draft_id = ?").run(fixture.players.outsider, draftId);
      db.close();
      expect((await put(id, deckBody({ main: main(40) }, { draftId }))).status).toBe(403);
    });

    it("sets the draft on a deck that has none when the body names it", async () => {
      const { draftId } = await seed();
      const plain = await (await post(deckBody({ main: main(3) }))).json();
      const res = await put(plain.deck.id, deckBody({ main: main(40) }, { draftId }));
      expect(res.status).toBe(200);
      expect((await res.json()).deck.draftId).toBe(draftId);
    });

    it("re-registers the deck for the tournament", async () => {
      const { draftId } = await seed({ tournamentUsers: ["drafter"] });
      const created = await (await post(deckBody({ main: main(40) }, { draftId }))).json();
      const res = await put(created.deck.id, deckBody({ main: main(44) }, { draftId }));
      expect(res.status).toBe(200);
      const row = await registration();
      expect(JSON.parse(row!.deck_json!).main).toHaveLength(44);
    });
  });
});
