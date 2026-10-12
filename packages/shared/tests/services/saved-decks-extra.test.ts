import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createSavedDeckService } from "../../src/services/saved-decks.js";

let db: Database.Database;
let decks: ReturnType<typeof createSavedDeckService>;
const bad = { main: Array(60).fill(901), extra: [901, 902, 903, 901, 904], side: [902], deckMaster: 905 };
beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  db.prepare("insert into users(id, username, display_name) values (1, 'test-owner', 'Test Owner')").run();
  for (const [id, type] of [[901, "Spell Card"], [902, "Trap Card"], [903, "Fusion Monster"], [904, "Pendulum Effect Monster"], [905, "Ritual Monster"]] as const) {
    db.prepare("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (?,?,?,'test','','','[]','test')")
      .run(id, `Test ${type}`, type);
  }
  decks = createSavedDeckService(db);
});
afterEach(() => db.close());
function legacy(deck = bad, draftId?: number) {
  return Number(db.prepare("insert into saved_decks(guild_id,owner_user_id,name,mode,deck_json,draft_id) values ('test-g',1,'Legacy','normal',?,?)")
    .run(JSON.stringify(deck), draftId ?? null).lastInsertRowid);
}

describe("saved deck Extra safety", () => {
  it.each([901, 902, 904, 905, 999])("rejects card %s on create and update without changing data", code => {
    const invalid = { main: [], extra: [code], side: [] };
    expect(() => decks.create("test-g", 1, { name: "Bad", mode: "normal", deck: invalid }))
      .toThrow(expect.objectContaining({ status: 400, code: "INVALID_EXTRA_DECK_CARD" }));
    const saved = decks.create("test-g", 1, { name: "Good", mode: "normal", deck: { main: [901], extra: [903], side: [] } });
    expect(() => decks.update(saved.id, "test-g", 1, { name: "Bad", mode: "normal", deck: invalid }))
      .toThrow(expect.objectContaining({ status: 400, code: "INVALID_EXTRA_DECK_CARD" }));
    expect(decks.get(saved.id, "test-g", 1)).toEqual(saved);
  });
  it.each(["get", "list", "findByDraft"] as const)("repairs on %s, saves every copy and metadata, and is idempotent", read => {
    const draftId = Number(db.prepare("insert into drafts(guild_id,channel_id,name,status,created_by_user_id) values ('test-g','test-channel','Test draft','completed',1)").run().lastInsertRowid);
    const id = legacy(bad, draftId);
    const before = db.prepare("select * from saved_decks where id=?").get(id) as Record<string, unknown>;
    const result = read === "get" ? decks.get(id, "test-g", 1) : read === "list" ? decks.list("test-g", 1)[0] : decks.findByDraft("test-g", 1, draftId)!;
    expect(result.deck.main).toEqual([...bad.main, 901, 902, 901, 904]);
    expect(result.deck.extra).toEqual([903]);
    expect(result.deck.side).toEqual(bad.side);
    expect(result.deck.deckMaster).toBe(905);
    const after = db.prepare("select * from saved_decks where id=?").get(id) as Record<string, unknown>;
    expect({ ...after, deck_json: before.deck_json }).toEqual(before);
    expect(JSON.parse(after.deck_json as string)).toEqual(result.deck);
    decks.get(id, "test-g", 1);
    expect(db.prepare("select * from saved_decks where id=?").get(id)).toEqual(after);
  });
  it("changes two affected decks in a synthetic test DB and leaves valid and other-owner decks intact", () => {
    legacy(); legacy();
    legacy({ ...bad, main: [901], extra: [903] });
    const foreign = legacy();
    db.prepare("update saved_decks set guild_id='other-test-g' where id=?").run(foreign);
    const before = db.prepare("select id,deck_json from saved_decks order by id").all() as { id: number; deck_json: string }[];
    decks.list("test-g", 1);
    const after = db.prepare("select id,deck_json from saved_decks order by id").all() as typeof before;
    expect(after.filter((row, index) => row.deck_json !== before[index].deck_json)).toHaveLength(2);
    expect(decks.list("test-g", 1).every(row => row.deck.extra.every(code => code === 903))).toBe(true);
  });
  it("moves unknown Extra cards to Main without dropping them, then can use catalog data on a later read", () => {
    const id = legacy({ ...bad, extra: [999] });
    expect(decks.get(id, "test-g", 1).deck.main).toContain(999);
    expect(decks.get(id, "test-g", 1).deck.extra).toEqual([]);
  });
});
