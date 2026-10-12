import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createSavedDeckService } from "@yugidraft/shared/services";
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), savedActor: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/saved-decks", async original => ({
  ...await original<typeof import("../../src/lib/saved-decks")>(), requireSavedDeckActor: mocks.savedActor, loadDeckRegistrations: () => [],
}));
import { POST } from "../../app/api/decks/route";
import { PUT } from "../../app/api/decks/[id]/route";
import { POST as IMPORT } from "../../app/api/decks/import/route";
let db: Database.Database;
let decks: ReturnType<typeof createSavedDeckService>;
const request = (body: unknown) => new Request("http://test/api/decks", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks(); db = new Database(":memory:"); migrate(db);
  db.prepare("insert into users(id,username,display_name) values (1,'test-owner','Test Owner')").run();
  for (const [id, type] of [[901, "Spell Card"], [902, "Trap Card"], [903, "Fusion Monster"], [904, "Pendulum Effect Monster"]] as const) {
    db.prepare("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (?,?,?,'test','','','[]','test')").run(id, `Test ${type}`, type);
  }
  decks = createSavedDeckService(db);
  mocks.getDb.mockReturnValue(db);
  mocks.savedActor.mockResolvedValue({ ok: true, guildId: "test-g", ownerUserId: 1, discordUserId: null, decks });
});
afterEach(() => db.close());
describe("deck APIs reject invalid Extra cards independently of the client", () => {
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
