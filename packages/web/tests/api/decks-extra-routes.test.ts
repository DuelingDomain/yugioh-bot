import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createSavedDeckService } from "@yugidraft/shared/services";
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), savedActor: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/draft-decks", () => ({ backfillDraftDecks: vi.fn() }));
vi.mock("@yugidraft/shared/services", async original => {
  const actual = await original<typeof import("@yugidraft/shared/services")>();
  return { ...actual, loadArtworkIdentityCatalog: () => new Map(),
    createDeckTypeLookup: (db: Database.Database, engine = new Map()) => actual.createDeckTypeLookup(db, engine),
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
const request = (body: unknown) => new Request("http://test/api/decks", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks(); db = new Database(":memory:"); migrate(db);
  for (const [id, type] of [[901, "Spell Card"], [902, "Trap Card"], [903, "Fusion Monster"], [904, "Pendulum Effect Monster"]] as const) {
    db.prepare("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (?,?,?,'test','','','[]','test')").run(id, `Test ${type}`, type);
  }
  decks = createSavedDeckService(db, new Map());
  mocks.getDb.mockReturnValue(db);
  mocks.savedActor.mockResolvedValue({ ok: true, guildId: "test-g", ownerUserId: "test-owner", decks });
});
afterEach(() => db.close());
describe("deck APIs reject invalid Extra cards independently of the client", () => {
  it.each(["get", "list"])("exposes the repair notice on the saved-deck object returned by %s", async read => {
    const original = { main: Array(60).fill(901), extra: [901, 903], side: [] };
    const id = Number(db.prepare("insert into saved_decks(guild_id,owner_user_id,name,mode,deck_json) values ('test-g','test-owner','Test legacy','normal',?)").run(JSON.stringify(original)).lastInsertRowid);
    const response = read === "get" ? await GET(request({}), { params: Promise.resolve({ id: String(id) }) }) : await LIST();
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
    expect(decks.list("test-g", "test-owner")).toEqual([]);
    const saved = decks.create("test-g", "test-owner", { ...body, deck: { main: [901], extra: [903], side: [] } });
    const updated = await PUT(request(body), { params: Promise.resolve({ id: String(saved.id) }) });
    expect(updated.status).toBe(400);
    expect(await updated.json()).toEqual(expected);
    expect(decks.get(saved.id, "test-g", "test-owner")).toEqual(saved);
  });
  it("rejects invalid Extra on draft-linked writes before pool checks", async () => {
    const draftId = Number(db.prepare("insert into drafts(guild_id,channel_id,name,status,created_by_user_id) values ('test-g','test-channel','Test draft','completed','test-owner')").run().lastInsertRowid);
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
    expect(decks.list("test-g", "test-owner")).toEqual([]);
  });
  it("gives malformed imports a 400 error/code response", async () => {
    const response = await IMPORT(request({ mode: "normal", text: "" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.any(String), code: "INVALID_DECK_IMPORT" });
  });
});
