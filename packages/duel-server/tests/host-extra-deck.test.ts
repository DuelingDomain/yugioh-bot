import { createHmac } from "node:crypto";
import { rmSync } from "node:fs";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { defaultDuelSettings } from "@yugidraft/shared/duels";
import { createDuelService, createDuelSeriesService } from "@yugidraft/shared/services";
import { DeckLegalityError, validateExtraDeckTypes } from "../src/deck-legality.js";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";
import { seedIdentity } from "./helpers/identity.js";
let dataDirectory: string;
let db: Database.Database;
let host: DuelHost;
let duels: ReturnType<typeof createDuelService>;
let playerId: number;
const secret = "test-extra-deck";
const deck = (code: number) => ({ main: Array(5).fill(907), extra: [code], side: [] });
beforeAll(() => {
  dataDirectory = createHostDataFixture([
    { code: 901, name: "Test Spell", type: 0x2 }, { code: 902, name: "Test Trap", type: 0x4 },
    { code: 903, name: "Test Fusion", type: 0x41 }, { code: 904, name: "Test Pendulum", type: 0x1000021 },
    { code: 905, name: "Test Ritual", type: 0xa1 }, { code: 906, name: "Test Token", type: 0x4001 },
    { code: 907, name: "Test Main", type: 0x11 }, { code: 908, name: "Test Skill", type: 0x8000000 },
  ]);
});
afterAll(() => rmSync(dataDirectory, { recursive: true, force: true }));
beforeEach(() => {
  db = new Database(":memory:"); migrate(db);
  playerId = seedIdentity(db).playerId;
  vi.stubEnv("DUEL_DATA_DIR", dataDirectory);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: "No card matching your query was found in the database." }) })));
  duels = createDuelService(db);
  host = createDuelHost({ db, dataDirectory, secret, searchCards: () => [],
    createWorker: vi.fn(() => { throw new Error("No engine can start in these tests"); }) });
});
afterEach(async () => { await host.close(); db.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function post(body: Record<string, unknown>) {
  const raw = JSON.stringify({ guildId: "g", playerId, ...body });
  return host.handle(new Request("http://test/internal/duel", { method: "POST", body: raw,
    headers: { "x-announce-signature": "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") } }));
}
function room() {
  return duels.create({ guildId: "g", organizerPlayerId: playerId, name: "Test room", mode: "normal",
    settings: { ...defaultDuelSettings("normal"), validateDeck: false, banlist: "none" } });
}
describe("duel Extra Deck safety with competitive checks off", () => {
  it.each(["owner", "opponent"])("returns the private room notice when an expired opening is blocked (viewer=%s)", async viewer => {
    const opponent = seedIdentity(db, { name: "Fixture opponent" }).playerId;
    const session = room();
    duels.takeSeat(session.slug, "g", opponent);
    duels.setDeck(session.slug, "g", playerId, deck(901));
    duels.setDeck(session.slug, "g", opponent, deck(903));
    duels.startOpening(session.slug, "g", playerId, 0);
    const opening = { ...duels.openingState(session.slug, "g"), phase: "start", winnerSeat: 0, choice: "first" };
    db.prepare("update duels set opening_json=? where id=?").run(JSON.stringify(opening), session.id);
    const response = await post({ op: "view", slug: session.slug, playerId: viewer === "owner" ? playerId : opponent });
    expect(response.status).toBe(200);
    const result = await response.json();
    if (viewer === "owner") expect(result.startBlocked).toEqual({ reason: expect.stringContaining("Test Spell"), cardNames: ["Test Spell"] });
    else {
      expect(result.startBlocked).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("Test Spell");
    }
  });
  it("shows a named start blocker to an already-ready owner on room reads only", async () => {
    const opponent = seedIdentity(db, { name: "Fixture opponent" }).playerId;
    const spectator = seedIdentity(db, { name: "Fixture spectator" }).playerId;
    const session = room();
    duels.takeSeat(session.slug, "g", opponent);
    duels.setDeck(session.slug, "g", playerId, { ...deck(901), extra: [901, 902, 901] });
    duels.setDeck(session.slug, "g", opponent, deck(903));
    for (let i = 0; i < 2; i++) {
      const response = await post({ op: "view", slug: session.slug });
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.startBlocked).toEqual({
        reason: expect.stringContaining("Test Spell"), cardNames: ["Test Spell", "Test Trap"],
      });
      expect(result.session.seats[0].ready).toBe(true);
    }
    for (const viewer of [opponent, spectator]) {
      const response = await post({ op: "view", slug: session.slug, playerId: viewer });
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.startBlocked).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("Test Spell");
      expect(JSON.stringify(result)).not.toContain("Test Trap");
    }
    duels.setDeck(session.slug, "g", playerId, deck(903));
    expect((await (await post({ op: "view", slug: session.slug })).json()).startBlocked).toBeUndefined();
  });
  it("classifies the stable Extra error as a deck legality error", () => {
    expect(() => validateExtraDeckTypes(deck(901), dataDirectory)).toThrow(DeckLegalityError);
    expect(() => validateExtraDeckTypes(deck(901), dataDirectory)).toThrow(expect.objectContaining({ status: 400, code: "INVALID_EXTRA_DECK_CARD" }));
  });
  it.each(["deck", "ready", "start"])("returns a neutral block for an opponent's bad Extra card on %s", async op => {
    const opponent = seedIdentity(db, { name: "Test opponent" }).playerId;
    const { duel } = createDuelSeriesService(db).createChallenge({ guildId: "g", challengerPlayerId: playerId,
      opponentPlayerId: opponent, bestOf: 3, ranked: false, mode: "normal",
      settings: { ...defaultDuelSettings("normal"), validateDeck: false, banlist: "none" } });
    duels.setDeck(duel.slug, "g", opponent, deck(999));
    if (op !== "deck") duels.setDeck(duel.slug, "g", playerId, deck(903));
    if (op === "ready") duels.markUnready(duel.slug, "g", playerId);
    const response = await post({ op, slug: duel.slug, ...(op === "deck" ? { deck: deck(903) } : {}) });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ session: { status: "lobby" }, startBlocked: "Start blocked: another player's deck needs attention." });
    expect(JSON.stringify(result)).not.toContain("card 999");
    expect(result.error).toBeUndefined();
    expect(result.code).toBeUndefined();
    expect(duels.room(duel.slug, "g", playerId).myDeck).toEqual(deck(903));
    expect(duels.room(duel.slug, "g", playerId).session.seats.find(seat => seat.playerId === playerId)?.ready).toBe(true);
    const ownerResponse = await post({ op: "start", slug: duel.slug, playerId: opponent });
    expect(ownerResponse.status).toBe(400);
    expect(await ownerResponse.json()).toMatchObject({ code: "INVALID_EXTRA_DECK_CARD", error: expect.stringContaining("card 999") });
    expect(duels.get(duel.slug, "g").status).toBe("lobby");
  });
  it("normalizes an uncached API passcode before checking its Extra type", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ id: 998, name: "Test Fusion", type: "Fusion Monster", frameType: "fusion", card_images: [{ image_url: "https://example.test/fusion.jpg", image_url_small: "https://example.test/fusion-small.jpg" }] }] }) })));
    const session = room();
    const response = await post({ op: "deck", slug: session.slug, deck: deck(998) });
    expect(response.status).toBe(200);
    expect(duels.room(session.slug, "g", playerId).myDeck?.extra).toEqual([903]);
  });
  it.each([901, 902, 904, 905, 906, 908, 999])("rejects card %s on submit with a stable 400 contract", async code => {
    const session = room();
    const response = await post({ op: "deck", slug: session.slug, deck: deck(code) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("Extra Deck can contain only"), code: "INVALID_EXTRA_DECK_CARD" });
    expect(duels.room(session.slug, "g", playerId).myDeck).toBeNull();
  });
  it.each([901, 902, 904, 905, 906, 908, 999])("rejects old card %s on Ready before setting the ready flag", async code => {
    const session = room();
    duels.setDeck(session.slug, "g", playerId, deck(code));
    duels.markUnready(session.slug, "g", playerId);
    const response = await post({ op: "ready", slug: session.slug });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_EXTRA_DECK_CARD" });
    expect(duels.get(session.slug, "g").seats[0].ready).toBe(false);
  });
  it("accepts a real Extra monster on submit and Ready", async () => {
    const session = room();
    expect((await post({ op: "deck", slug: session.slug, deck: deck(903) })).status).toBe(200);
    expect((await post({ op: "ready", slug: session.slug })).status).toBe(200);
  });
});
