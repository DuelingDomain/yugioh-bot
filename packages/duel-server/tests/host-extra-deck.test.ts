import { createHmac } from "node:crypto";
import { rmSync } from "node:fs";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { defaultDuelSettings } from "@yugidraft/shared/duels";
import { createDeckTypeLookup, loadArtworkIdentityCatalog, createDuelService, createDuelSeriesService } from "@yugidraft/shared/services";
import { DeckLegalityError, inspectDeck, validateExtraDeckTypes } from "../src/deck-legality.js";
import * as legality from "../src/deck-legality.js";
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
    { code: 777, name: "", type: 0x2 },
    ...[778, 779, 780, 781].map(code => ({ code, name: "", type: 97 })),
    { code: 12381100, name: "Dragon Master Magia", type: 97 },
    { code: 43321985, name: "Ancient Fairy Life Dragon", type: 8225 },
    { code: 1546123, name: "Cyber End Dragon", type: 97 },
    { code: 1546124, name: "Cyber End Dragon", type: 97, alias: 1546123 },
    { code: 100459004, name: "Blue-Eyes Ultimate Dragon, the God-Surpassing Servant", type: 97 },
  ]);
  const cdb = new Database(`${dataDirectory}/cards.cdb`);
  cdb.exec("delete from texts where id in (777,778,779,780,781)");
  cdb.close();
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
afterEach(async () => { await host.close(); vi.useRealTimers(); db.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function post(body: Record<string, unknown>) {
  const raw = JSON.stringify({ guildId: "g", playerId, ...body });
  return host.handle(new Request("http://test/internal/duel", { method: "POST", body: raw,
    headers: { "x-announce-signature": "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") } }));
}
function room() {
  return duels.create({ guildId: "g", organizerPlayerId: playerId, name: "Test room", mode: "normal",
    settings: { ...defaultDuelSettings("normal"), validateDeck: false, banlist: "none" } });
}
async function sweepHost() {
  await host.close();
  vi.useFakeTimers();
  host = createDuelHost({ db, dataDirectory, secret, searchCards: () => [], pollIntervalMs: 60_000,
    createWorker: vi.fn(() => { throw new Error("No engine can start in these tests"); }) });
}
async function blockedRoom(owner: number) {
  const session = room();
  duels.takeSeat(session.slug, "g", owner);
  duels.setDeck(session.slug, "g", playerId, deck(903));
  duels.setDeck(session.slug, "g", owner, deck(901));
  const response = await post({ op: "start", slug: session.slug });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ startBlockedByOther: true });
  return session;
}
describe("duel Extra Deck safety with competitive checks off", () => {
  it("does not group distinct cards without text as copies in full validation", () => {
    const result = inspectDeck("normal", { main: [], extra: [778, 779, 780, 781], side: [] }, dataDirectory,
      { ...defaultDuelSettings("normal"), validateDeck: true, banlist: "none" });
    expect(result.issues.some(issue => /More than.*copies/.test(issue.message))).toBe(false);
  });
  it("uses the engine Extra type on Ready when a stored card has no text row", async () => {
    const session = room();
    const find = createDeckTypeLookup(db, loadArtworkIdentityCatalog(dataDirectory)).snapshot();
    expect(() => validateExtraDeckTypes(deck(778), dataDirectory, find)).not.toThrow();
    duels.setDeck(session.slug, "g", playerId, deck(778));
    duels.markUnready(session.slug, "g", playerId);
    expect((await post({ op: "ready", slug: session.slug })).status).toBe(200);
    expect(duels.room(session.slug, "g", playerId).myDeck?.extra).toEqual([778]);
  });
  it("uses the catalog name for an engine card that has no text on Start", async () => {
    db.exec("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (777,'Known Spell','Fusion Monster','fusion','','','[]','test')");
    const session = room();
    const opponent = seedIdentity(db, { name: "Fixture opponent" }).playerId;
    duels.takeSeat(session.slug, "g", opponent);
    duels.setDeck(session.slug, "g", opponent, deck(903));
    duels.setDeck(session.slug, "g", playerId, deck(777));
    const response = await post({ op: "start", slug: session.slug });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_EXTRA_DECK_CARD", error: expect.stringContaining("Known Spell") });
  });
  it.each([12381100, 1546124, 100459004])("accepts engine-only Fusion/artwork/pre-release card %s on submit and Ready", async code => {
    const session = room();
    const selected = { ...deck(code), extra: [code, 43321985] };
    expect(() => validateExtraDeckTypes(selected, dataDirectory)).not.toThrow();
    expect((await post({ op: "deck", slug: session.slug, deck: selected })).status).toBe(200);
    expect((await post({ op: "ready", slug: session.slug })).status).toBe(200);
    expect(duels.room(session.slug, "g", playerId).myDeck?.extra).toEqual(selected.extra);
    expect(db.prepare("select name from card_catalog where ygoprodeck_id=?").get(code)).toBeUndefined();
  });
  it("expires a casual deck block in the sweep without another room read", async () => {
    await sweepHost();
    const owner = seedIdentity(db, { name: "Fixture deck owner" }).playerId;
    const session = await blockedRoom(owner);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(await (await post({ op: "view", slug: session.slug })).json()).not.toHaveProperty("startBlockedByOther");
    expect(duels.get(session.slug, "g").status).toBe("lobby");
    expect((await post({ op: "start", slug: session.slug })).status).toBe(200);
    expect(await (await post({ op: "view", slug: session.slug })).json()).toMatchObject({ startBlockedByOther: true });
  });
  it("refreshes a casual deck block's expiry on a new failed Start", async () => {
    await sweepHost();
    const owner = seedIdentity(db, { name: "Fixture deck owner" }).playerId;
    const session = await blockedRoom(owner);
    await vi.advanceTimersByTimeAsync(14 * 60_000);
    expect((await post({ op: "start", slug: session.slug })).status).toBe(200);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await (await post({ op: "view", slug: session.slug })).json()).toMatchObject({ startBlockedByOther: true });
    await vi.advanceTimersByTimeAsync(14 * 60_000);
    expect(await (await post({ op: "view", slug: session.slug })).json()).not.toHaveProperty("startBlockedByOther");
  });
  it.each(["active", "completed", "cancelled"])("sweeps a deck block when another process changes the lobby to %s", async status => {
    await sweepHost();
    const owner = seedIdentity(db, { name: "Fixture deck owner" }).playerId;
    const session = await blockedRoom(owner);
    db.prepare("update duels set status=? where id=?").run(status, session.id);
    await vi.advanceTimersByTimeAsync(60_000);
    // Restore the same lobby to expose an entry that survived the sweep; a closed-room read would clear it itself.
    db.prepare("update duels set status='lobby' where id=?").run(session.id);
    expect(await (await post({ op: "view", slug: session.slug })).json()).not.toHaveProperty("startBlockedByOther");
  });
  it("caps deck blocks at 256 lobbies and evicts the least recently blocked room", async () => {
    await sweepHost();
    const owner = seedIdentity(db, { name: "Fixture deck owner" }).playerId;
    const first = await blockedRoom(owner);
    const second = await blockedRoom(owner);
    expect((await post({ op: "start", slug: first.slug })).status).toBe(200);
    let latest = second;
    for (let i = 0; i < 255; i++) latest = await blockedRoom(owner);
    expect(await (await post({ op: "view", slug: first.slug })).json()).toMatchObject({ startBlockedByOther: true });
    expect(await (await post({ op: "view", slug: second.slug })).json()).not.toHaveProperty("startBlockedByOther");
    expect(await (await post({ op: "view", slug: latest.slug })).json()).toMatchObject({ startBlockedByOther: true });
  }, 30_000);
  it("preserves the actor's own blocker when another seat fails Start first", async () => {
    const opponent = seedIdentity(db, { name: "Fixture opponent" }).playerId;
    const { duel: session } = createDuelSeriesService(db).createChallenge({ guildId: "g", challengerPlayerId: opponent,
      opponentPlayerId: playerId, bestOf: 3, ranked: false, mode: "normal",
      settings: { ...defaultDuelSettings("normal"), validateDeck: false, banlist: "none" } });
    const actor = session.seats[1].playerId!;
    duels.setDeck(session.slug, "g", session.seats[0].playerId!, deck(999));
    duels.setDeck(session.slug, "g", actor, deck(998));

    const response = await post({ op: "start", slug: session.slug, playerId: actor });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.session.status).toBe("lobby");
    expect(result.startBlocked).toEqual({ reason: expect.stringContaining("card 998"), cardNames: ["card 998"] });
    expect(result).not.toHaveProperty("startBlockedByOther");
    expect(JSON.stringify(result)).not.toContain("card 999");
  });
  it("records a casual Start blocked by another deck for every other seated player", async () => {
    // Enable FFA3 so Start reaches the deck checks, independent of the runner's defaults.
    vi.stubEnv("MULTIPLAYER_TABLES", "1");
    const owner = seedIdentity(db, { name: "Fixture deck owner" }).playerId;
    const other = seedIdentity(db, { name: "Fixture third player" }).playerId;
    const spectator = seedIdentity(db, { name: "Fixture spectator" }).playerId;
    const session = duels.create({ guildId: "g", organizerPlayerId: playerId, name: "Fixture casual table",
      mode: "normal", format: "ffa3",
      settings: { ...defaultDuelSettings("normal"), validateDeck: false, banlist: "none" } });
    duels.takeSeat(session.slug, "g", owner);
    duels.takeSeat(session.slug, "g", other);
    for (const seated of [playerId, owner, other]) {
      duels.setDeck(session.slug, "g", seated, deck(seated === owner ? 901 : 903));
    }
    expect((await (await post({ op: "view", slug: session.slug })).json())).not.toHaveProperty("startBlockedByOther");
    const response = await post({ op: "start", slug: session.slug });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ session: { status: "lobby", seriesId: null },
      startBlocked: "Start blocked: another player's deck needs attention.", startBlockedByOther: true });
    for (const viewer of [playerId, other]) {
      const view = await post({ op: "view", slug: session.slug, playerId: viewer });
      expect(view.status).toBe(200);
      const result = await view.json();
      expect(result.startBlockedByOther).toBe(true);
      expect(result).not.toHaveProperty("startBlocked");
      expect(JSON.stringify(result)).not.toContain("Test Spell");
    }
    const ownerView = await (await post({ op: "view", slug: session.slug, playerId: owner })).json();
    expect(ownerView.startBlocked).toEqual({ reason: expect.stringContaining("Test Spell"), cardNames: ["Test Spell"] });
    expect(ownerView).not.toHaveProperty("startBlockedByOther");
    const spectatorView = await (await post({ op: "view", slug: session.slug, playerId: spectator })).json();
    expect(spectatorView).not.toHaveProperty("startBlockedByOther");
    expect(spectatorView).not.toHaveProperty("startBlocked");
    duels.markUnready(session.slug, "g", other);
    for (const viewer of [playerId, other]) {
      expect(await (await post({ op: "view", slug: session.slug, playerId: viewer })).json())
        .not.toHaveProperty("startBlockedByOther");
    }
  });
  it("records the first Ready auto-start deck block before any retry", async () => {
    const owner = seedIdentity(db, { name: "Fixture deck owner" }).playerId;
    const { duel } = createDuelSeriesService(db).createChallenge({ guildId: "g", challengerPlayerId: playerId,
      opponentPlayerId: owner, bestOf: 3, ranked: false, mode: "normal",
      settings: { ...defaultDuelSettings("normal"), validateDeck: false, banlist: "none" } });
    duels.setDeck(duel.slug, "g", owner, deck(999));
    duels.setDeck(duel.slug, "g", playerId, deck(903));
    duels.markUnready(duel.slug, "g", playerId);
    expect(await (await post({ op: "view", slug: duel.slug })).json()).not.toHaveProperty("startBlockedByOther");
    const ready = await post({ op: "ready", slug: duel.slug });
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ session: { status: "lobby" },
      startBlocked: "Start blocked: another player's deck needs attention." });
    const view = await post({ op: "view", slug: duel.slug });
    expect(view.status).toBe(200);
    const result = await view.json();
    expect(result.startBlockedByOther).toBe(true);
    expect(result).not.toHaveProperty("startBlocked");
    expect(JSON.stringify(result)).not.toContain("card 999");
  });
  it.each(["validation", "inspection"] as const)("keeps room reads available when the optional blocker %s fails", async stage => {
    const session = room();
    duels.setDeck(session.slug, "g", playerId, deck(stage === "validation" ? 903 : 901));
    const error = new Error("Fixture blocker check failed");
    if (stage === "validation") vi.spyOn(legality, "validateExtraDeckTypes").mockImplementation(() => { throw error; });
    else vi.spyOn(legality, "inspectDeck").mockImplementation(() => { throw error; });
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await post({ op: "view", slug: session.slug });
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty("startBlocked");
    expect(log).toHaveBeenCalledWith("[duel] could not check the viewer's start blocker", error);
  });
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
    const view = await post({ op: "view", slug: duel.slug });
    expect(view.status).toBe(200);
    expect(await view.json()).toMatchObject({ startBlockedByOther: true });
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
