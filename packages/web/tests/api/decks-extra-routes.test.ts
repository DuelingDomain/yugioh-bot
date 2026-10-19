import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createSavedDeckService } from "@yugidraft/shared/services";
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), savedActor: vi.fn(), useEngineDatabase: false }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/draft-decks", () => ({ backfillDraftDecks: vi.fn() }));
vi.mock("@yugidraft/shared/services", async original => {
  const actual = await original<typeof import("@yugidraft/shared/services")>();
  return { ...actual, loadArtworkIdentityCatalog: (directory?: string) => mocks.useEngineDatabase ? actual.loadArtworkIdentityCatalog(directory) : new Map(),
    createDeckTypeLookup: (db: Database.Database, engine?: import("@yugidraft/shared/duels").CardIdentityCatalog) => actual.createDeckTypeLookup(db, engine ?? (mocks.useEngineDatabase ? undefined : new Map())),
    createCardCatalogService: (db: Database.Database) => actual.createCardCatalogService(db, { identityCatalog: new Map() }),
  };
});
vi.mock("@/lib/saved-decks", async original => ({
  ...await original<typeof import("../../src/lib/saved-decks")>(), requireSavedDeckActor: mocks.savedActor, loadDeckRegistrations: () => [],
}));
import { GET as LIST, POST } from "../../app/api/decks/route";
import { GET, PUT } from "../../app/api/decks/[id]/route";
import { POST as IMPORT } from "../../app/api/decks/import/route";
import { checkSavedDeckMaster } from "../../src/lib/saved-decks";
let db: Database.Database;
let decks: ReturnType<typeof createSavedDeckService>;
let fixtureDirectory: string | undefined;
const request = (body: unknown) => new Request("http://test/api/decks", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks(); mocks.useEngineDatabase = false; db = new Database(":memory:"); migrate(db);
  db.prepare("insert into users(id,username,display_name) values (1,'test-owner','Test Owner')").run();
  for (const [id, type] of [[901, "Spell Card"], [902, "Trap Card"], [903, "Fusion Monster"], [904, "Pendulum Effect Monster"]] as const) {
    db.prepare("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (?,?,?,'test','','','[]','test')").run(id, `Test ${type}`, type);
  }
  decks = createSavedDeckService(db, new Map());
  mocks.getDb.mockReturnValue(db);
  mocks.savedActor.mockResolvedValue({ ok: true, guildId: "test-g", ownerUserId: 1, discordUserId: null, decks });
});
afterEach(() => {
  db.close(); vi.unstubAllEnvs();
  if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true });
  fixtureDirectory = undefined;
});

async function useEngineFixture() {
  fixtureDirectory = mkdtempSync(join(tmpdir(), "web-extra-lookup-"));
  const data = join(fixtureDirectory, "data");
  const engineDirectory = join(data, "duel-engine");
  mkdirSync(engineDirectory, { recursive: true });
  const engine = new Database(join(engineDirectory, "cards.cdb"));
  engine.exec("create table datas(id integer primary key, alias integer, type integer); create table texts(id integer primary key, name text);");
  for (const [id, alias, type, name] of [
    [12381100, 0, 97, "Dragon Master Magia"], [43321985, 0, 8225, "Ancient Fairy Life Dragon"],
    [1546123, 0, 97, "Cyber End Dragon"], [1546124, 1546123, 97, "Cyber End Dragon"],
    [100459004, 0, 97, "Blue-Eyes Ultimate Dragon, the God-Surpassing Servant"],
    [55144522, 0, 2, "Pot of Greed"],
  ] as const) {
    engine.prepare("insert into datas values (?,?,?)").run(id, alias, type);
    engine.prepare("insert into texts values (?,?)").run(id, name);
  }
  engine.close();
  const path = join(data, "bot.sqlite");
  await db.backup(path); db.close(); db = new Database(path);
  vi.stubEnv("DUEL_DATA_DIR", undefined);
  vi.stubEnv("DATABASE_PATH", path);
  mocks.useEngineDatabase = true;
  decks = createSavedDeckService(db);
  mocks.getDb.mockReturnValue(db);
  mocks.savedActor.mockResolvedValue({ ok: true, guildId: "test-g", ownerUserId: 1, discordUserId: null, decks });
}
describe("deck APIs reject invalid Extra cards independently of the client", () => {
  it("saves the owner's Domain deck after adding Ancient Fairy Life Dragon beside uncached Magia", async () => {
    await useEngineFixture();
    const body = { name: "Owner deck", mode: "domain", deck: { main: [], extra: [12381100], side: [] } };
    const created = await POST(request(body));
    expect(created.status).toBe(201);
    const { deck: saved } = await created.json();
    const updated = await PUT(request({ ...body, deck: { ...body.deck, extra: [12381100, 43321985] } }), { params: Promise.resolve({ id: String(saved.id) }) });
    expect(updated.status).toBe(200);
    expect((await updated.json()).deck.deck.extra).toEqual([12381100, 43321985]);
    expect(db.prepare("select name from card_catalog where ygoprodeck_id=12381100").get()).toBeUndefined();
  });
  it.each([1546124, 100459004])("saves and imports uncached engine artwork/pre-release card %s", async code => {
    await useEngineFixture();
    const created = await POST(request({ name: "Engine deck", mode: "normal", deck: { main: [], extra: [code], side: [] } }));
    expect(created.status).toBe(201);
    const imported = await IMPORT(request({ mode: "normal", text: `#extra\n${code}` }));
    expect(imported.status).toBe(200);
    expect((await imported.json()).deck.extra).toEqual([code]);
  });
  it("names an uncached engine Spell in the save error", async () => {
    await useEngineFixture();
    const response = await POST(request({ name: "Invalid", mode: "normal", deck: { main: [], extra: [55144522], side: [] } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_EXTRA_DECK_CARD", error: expect.stringContaining("Move Pot of Greed") });
  });
  it.each(["get", "list"])("exposes the repair notice on the saved-deck object returned by %s", async read => {
    const original = { main: Array(60).fill(901), extra: [901, 903], side: [] };
    const id = Number(db.prepare("insert into saved_decks(guild_id,owner_user_id,name,mode,deck_json) values ('test-g',1,'Test legacy','normal',?)").run(JSON.stringify(original)).lastInsertRowid);
    const response = read === "get" ? await GET(request({}), { params: Promise.resolve({ id: String(id) }) }) : await LIST(new Request("http://test/api/decks"));
    expect(response.status).toBe(200);
    const data = await response.json();
    const saved = read === "get" ? data.deck : data.decks[0];
    expect(saved.deck.main).toHaveLength(61);
    expect(saved.extraDeckRepair).toMatchObject({ applied: true, mainCount: 61,
      moves: [{ code: 901, from: "extra", to: "main" }], message: expect.stringContaining("60") });
    expect(saved.deck.extraDeckRepair).toBeUndefined();
  });
  it("checks engine-only Extra types with an injected map before any Domain check", async () => {
    const engine = new Map([[998, { name: "Engine Fusion", type: 0x41 }], [997, { name: "Engine Spell", type: 0x2 }]]);
    expect(await checkSavedDeckMaster("normal", { main: [], extra: [998], side: [] }, engine)).toEqual({ ok: true });
    const result = await checkSavedDeckMaster("normal", { main: [], extra: [997], side: [] }, engine);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(await result.response.json()).toMatchObject({ code: "INVALID_EXTRA_DECK_CARD", error: expect.stringContaining("Engine Spell") });
  });
  it.each([901, 902, 904, 999])("returns the same error/code on POST and PUT for %s", async code => {
    const body = { name: "Test deck", mode: "normal", deck: { main: [], extra: [code], side: [] } };
    const created = await POST(request(body));
    expect(created.status).toBe(400);
    const expected = { error: expect.stringContaining("Extra Deck can contain only"), code: "INVALID_EXTRA_DECK_CARD" };
    expect(await created.json()).toEqual(expected);
    expect(decks.list("test-g", 1)).toEqual([]);
    const saved = decks.create("test-g", 1, { ...body, deck: { main: [901], extra: [903], side: [] } });
    const updated = await PUT(request(body), { params: Promise.resolve({ id: String(saved.id) }) });
    expect(updated.status).toBe(400);
    expect(await updated.json()).toEqual(expected);
    expect(decks.get(saved.id, "test-g", 1)).toEqual(saved);
  });
  it("rejects invalid Extra on draft-linked writes before pool checks", async () => {
    const draftId = Number(db.prepare("insert into drafts(guild_id,channel_id,name,status,created_by_user_id) values ('test-g','test-channel','Test draft','completed',1)").run().lastInsertRowid);
    const response = await POST(request({ name: "Test deck", mode: "normal", draftId, deck: { main: [], extra: [901], side: [] } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_EXTRA_DECK_CARD" });
  });
  it("prepares a routed import with per-copy reports and does not save it", async () => {
    const response = await IMPORT(request({ mode: "normal", text: "#main\n903\n#extra\n901\n902\n901\n!side\n902" }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.deck).toEqual({ main: [901, 902, 901], extra: [903], side: [902] });
    expect(result.moves).toHaveLength(4);
    expect(result.messages).toContain("3 cards moved from Extra Deck to Main Deck: Test Spell Card, Test Trap Card, Test Spell Card.");
    expect(decks.list("test-g", 1)).toEqual([]);
  });
  it("gives malformed imports a 400 error/code response", async () => {
    const response = await IMPORT(request({ mode: "normal", text: "" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.any(String), code: "INVALID_DECK_IMPORT" });
  });
});

it("returns a fixed validation message for malformed import JSON", async () => {
  const response = await IMPORT(new Request("http://test/api/decks/import", {
    method: "POST", body: '{"fixture private text"}',
  }));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid JSON", code: "INVALID_DECK_IMPORT" });
});
