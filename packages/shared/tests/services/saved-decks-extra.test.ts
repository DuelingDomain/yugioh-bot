import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createSavedDeckService } from "../../src/services/saved-decks.js";

let db: Database.Database;
let decks: ReturnType<typeof createSavedDeckService>;
let statements: string[];
const bad = { main: Array(45).fill(901), extra: [901, 902, 903, 901, 904], side: [902], deckMaster: 905 };
beforeEach(() => {
  statements = [];
  db = new Database(":memory:", { verbose: sql => statements.push(String(sql)) });
  migrate(db);
  for (const [id, type] of [[901, "Spell Card"], [902, "Trap Card"], [903, "Fusion Monster"], [904, "Pendulum Effect Monster"], [905, "Ritual Monster"]] as const) {
    db.prepare("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (?,?,?,'test','','','[]','test')")
      .run(id, `Test ${type}`, type);
  }
  decks = createSavedDeckService(db, new Map());
});
afterEach(() => db.close());
function legacy(deck = bad, draftId?: number) {
  return Number(db.prepare("insert into saved_decks(guild_id,owner_user_id,name,mode,deck_json,draft_id) values ('test-g','test-owner','Legacy','normal',?,?)")
    .run(JSON.stringify(deck), draftId ?? null).lastInsertRowid);
}

describe("saved deck Extra safety", () => {
  it.each([901, 902, 904, 905, 999])("rejects card %s on create and update without changing data", code => {
    const invalid = { main: [], extra: [code], side: [] };
    expect(() => decks.create("test-g", "test-owner", { name: "Bad", mode: "normal", deck: invalid }))
      .toThrow(expect.objectContaining({ status: 400, code: "INVALID_EXTRA_DECK_CARD" }));
    const saved = decks.create("test-g", "test-owner", { name: "Good", mode: "normal", deck: { main: [901], extra: [903], side: [] } });
    expect(() => decks.update(saved.id, "test-g", "test-owner", { name: "Bad", mode: "normal", deck: invalid }))
      .toThrow(expect.objectContaining({ status: 400, code: "INVALID_EXTRA_DECK_CARD" }));
    expect(decks.get(saved.id, "test-g", "test-owner")).toEqual(saved);
  });
  it.each(["get", "list", "findByDraft"] as const)("repairs on %s, saves every copy and metadata, and is idempotent", read => {
    const draftId = Number(db.prepare("insert into drafts(guild_id,channel_id,name,status,created_by_user_id) values ('test-g','test-channel','Test draft','completed','test-owner')").run().lastInsertRowid);
    const id = legacy(bad, draftId);
    const before = db.prepare("select * from saved_decks where id=?").get(id) as Record<string, unknown>;
    const result = read === "get" ? decks.get(id, "test-g", "test-owner") : read === "list" ? decks.list("test-g", "test-owner")[0] : decks.findByDraft("test-g", "test-owner", draftId)!;
    expect(result.deck.main).toEqual([...bad.main, 901, 902, 901, 904]);
    expect(result.deck.extra).toEqual([903]);
    expect(result.deck.side).toEqual(bad.side);
    expect(result.deck.deckMaster).toBe(905);
    expect(result.extraDeckRepair).toMatchObject({ applied: true, mainCount: 49,
      moves: [901, 902, 901, 904].map(code => ({ code, from: "extra", to: "main" })),
      message: expect.stringContaining("moved from Extra Deck to Main Deck") });
    const after = db.prepare("select * from saved_decks where id=?").get(id) as Record<string, unknown>;
    expect({ ...after, deck_json: before.deck_json }).toEqual(before);
    expect(JSON.parse(after.deck_json as string)).toEqual({ ...result.deck, extraDeckRepair: result.extraDeckRepair });
    expect(decks.get(id, "test-g", "test-owner").extraDeckRepair).toEqual(result.extraDeckRepair);
    expect(db.prepare("select * from saved_decks where id=?").get(id)).toEqual(after);
  });
  it("keeps the repair report across internal reads and failed saves until a successful save", () => {
    const draftId = Number(db.prepare("insert into drafts(guild_id,channel_id,name,status,created_by_user_id) values ('test-g','test-channel','Test draft','completed','test-owner')").run().lastInsertRowid);
    const id = legacy(bad, draftId);
    const listed = decks.list("test-g", "test-owner")[0];
    const reloaded = createSavedDeckService(db, new Map());
    statements.length = 0;
    expect(reloaded.get(id, "test-g", "test-owner").extraDeckRepair).toEqual(listed.extraDeckRepair);
    expect(reloaded.findByDraft("test-g", "test-owner", draftId)?.extraDeckRepair).toEqual(listed.extraDeckRepair);
    expect(reloaded.list("test-g", "test-owner")[0].extraDeckRepair).toEqual(listed.extraDeckRepair);
    expect(statements.some(sql => /^(BEGIN|update saved_decks)/i.test(sql))).toBe(false);
    expect(() => reloaded.update(id, "test-g", "test-owner", { ...listed, deck: bad })).toThrow();
    expect(reloaded.get(id, "test-g", "test-owner").extraDeckRepair).toEqual(listed.extraDeckRepair);
    const saved = reloaded.update(id, "test-g", "test-owner", {
      ...listed, deck: { ...listed.deck, extraDeckRepair: listed.extraDeckRepair },
    });
    expect(saved.deck).toEqual(listed.deck);
    expect(saved.extraDeckRepair).toBeUndefined();
    expect(reloaded.get(id, "test-g", "test-owner").extraDeckRepair).toBeUndefined();
    expect(reloaded.findByDraft("test-g", "test-owner", draftId)?.extraDeckRepair).toBeUndefined();
    expect(JSON.parse((db.prepare("select deck_json from saved_decks where id=?").get(id) as { deck_json: string }).deck_json)).toEqual(listed.deck);
  });
  it("changes two affected decks in a synthetic test DB and leaves valid and other-owner decks intact", () => {
    legacy(); legacy();
    legacy({ ...bad, main: [901], extra: [903] });
    const foreign = legacy();
    db.prepare("update saved_decks set guild_id='other-test-g' where id=?").run(foreign);
    const before = db.prepare("select id,deck_json from saved_decks order by id").all() as { id: number; deck_json: string }[];
    decks.list("test-g", "test-owner");
    const after = db.prepare("select id,deck_json from saved_decks order by id").all() as typeof before;
    expect(after.filter((row, index) => row.deck_json !== before[index].deck_json)).toHaveLength(2);
    expect(decks.list("test-g", "test-owner").every(row => row.deck.extra.every(code => code === 903))).toBe(true);
  });
  it.each(["get", "list", "findByDraft"] as const)("preserves unknown Extra codes and stored JSON on %s with an empty engine map", read => {
    const draftId = Number(db.prepare("insert into drafts(guild_id,channel_id,name,status,created_by_user_id) values ('test-g','test-channel','Test draft','completed','test-owner')").run().lastInsertRowid);
    const original = { ...bad, extra: [999] };
    const id = legacy(original, draftId);
    const before = db.prepare("select deck_json from saved_decks where id=?").get(id);
    const result = read === "get" ? decks.get(id, "test-g", "test-owner") : read === "list" ? decks.list("test-g", "test-owner")[0] : decks.findByDraft("test-g", "test-owner", draftId)!;
    expect(result.deck).toEqual(original);
    expect(result.extraDeckRepair).toBeUndefined();
    expect(db.prepare("select deck_json from saved_decks where id=?").get(id)).toEqual(before);
    db.prepare("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (999,'Test Fusion','Fusion Monster','fusion','','','[]','test')").run();
    expect(decks.get(id, "test-g", "test-owner").deck).toEqual(original);
  });
  it("preserves engine-only Fusion cards while repairing known Main cards and keeping unknown codes", () => {
    const engine = new Map([[998, { name: "Engine Fusion", type: 0x41 }]]);
    const id = legacy({ ...bad, extra: [998, 901, 999, 901] });
    const result = createSavedDeckService(db, engine).get(id, "test-g", "test-owner");
    expect(result.deck.extra).toEqual([998, 999]);
    expect(result.deck.main).toEqual([...bad.main, 901, 901]);
    expect(result.extraDeckRepair?.moves).toHaveLength(2);
  });
  it("keeps a graduated code in Extra while it is temporarily absent from the engine map", () => {
    const engine = new Map<number, { name: string; type: number }>();
    const id = legacy({ ...bad, extra: [998] });
    const service = createSavedDeckService(db, engine);
    expect(service.get(id, "test-g", "test-owner").deck.extra).toEqual([998]);
    engine.set(998, { name: "Graduated Fusion", type: 0x41 });
    expect(service.get(id, "test-g", "test-owner").deck.extra).toEqual([998]);
  });
  it("saves a repaired deck as it was repaired", () => {
    const id = legacy();
    const repaired = decks.get(id, "test-g", "test-owner");
    expect(decks.update(id, "test-g", "test-owner", { ...repaired }).deck).toEqual(repaired.deck);
  });
  it("leaves a repair that would pass the 60-card Main limit untouched and explains how to fix it", () => {
    const original = { ...bad, main: Array(60).fill(901), extra: [901, 903] };
    const id = legacy(original);
    const before = db.prepare("select deck_json from saved_decks where id=?").get(id);
    const transaction = vi.spyOn(db, "transaction");
    const result = decks.get(id, "test-g", "test-owner");
    expect(result.deck).toEqual(original);
    expect(result.extraDeckRepair).toMatchObject({ applied: false, mainCount: 61,
      message: expect.stringContaining("60-card limit"), moves: [{ code: 901, from: "extra", to: "main" }] });
    expect(transaction).not.toHaveBeenCalled();
    expect(db.prepare("select deck_json from saved_decks where id=?").get(id)).toEqual(before);
    expect(decks.update(id, "test-g", "test-owner", { ...result, deck: { ...original, extra: [903], side: [901] } }).deck.main).toHaveLength(60);
  });
  it("does not open a write transaction for clean or unknown-only read results", () => {
    const id = legacy({ ...bad, extra: [903, 999] });
    const transaction = vi.spyOn(db, "transaction");
    statements.length = 0;
    expect(decks.get(id, "test-g", "test-owner").deck.extra).toEqual([903, 999]);
    expect(decks.list("test-g", "test-owner")).toHaveLength(1);
    expect(decks.findByDraft("test-g", "test-owner", 999)).toBeNull();
    expect(transaction).not.toHaveBeenCalled();
    expect(statements.some(sql => /^BEGIN/i.test(sql))).toBe(false);
  });
  it.each(["get", "list", "findByDraft"] as const)("re-reads the latest deck before repair on %s", read => {
    const draftId = Number(db.prepare("insert into drafts(guild_id,channel_id,name,status,created_by_user_id) values ('test-g','test-channel','Test draft','completed','test-owner')").run().lastInsertRowid);
    const id = legacy(bad, draftId);
    const current = { ...bad, main: [902], extra: [901, 903], side: [904] };
    const transaction = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementationOnce(callback => {
      // Simulate a write between the unlocked inspection and acquiring the repair lock.
      db.prepare("update saved_decks set deck_json=? where id=?").run(JSON.stringify(current), id);
      return transaction(callback);
    });
    const result = read === "get" ? decks.get(id, "test-g", "test-owner") : read === "list" ? decks.list("test-g", "test-owner")[0] : decks.findByDraft("test-g", "test-owner", draftId)!;
    expect(result.deck).toEqual({ ...current, main: [902, 901], extra: [903] });
    expect(JSON.parse((db.prepare("select deck_json from saved_decks where id=?").get(id) as { deck_json: string }).deck_json)).toEqual({ ...result.deck, extraDeckRepair: result.extraDeckRepair });
  });
  it("reads without repair while another WAL connection holds BEGIN IMMEDIATE, including a readonly handle", async () => {
    const draftId = Number(db.prepare("insert into drafts(guild_id,channel_id,name,status,created_by_user_id) values ('test-g','test-channel','Test draft','completed','test-owner')").run().lastInsertRowid);
    const id = legacy({ ...bad, extra: [903] }, draftId);
    const directory = mkdtempSync(join(tmpdir(), "deck-read-lock-"));
    const path = join(directory, "test.db");
    await db.backup(path);
    const writer = new Database(path);
    writer.pragma("journal_mode = WAL");
    const reader = new Database(path, { timeout: 1 });
    const readonly = new Database(path, { readonly: true, timeout: 1 });
    try {
      const service = createSavedDeckService(reader, new Map());
      writer.exec("BEGIN IMMEDIATE");
      expect(service.list("test-g", "test-owner")).toHaveLength(1);
      expect(service.get(id, "test-g", "test-owner").deck.extra).toEqual([903]);
      expect(service.findByDraft("test-g", "test-owner", draftId)?.id).toBe(id);
      expect(createSavedDeckService(readonly, new Map()).list("test-g", "test-owner")).toHaveLength(1);
    } finally {
      writer.exec("ROLLBACK");
      reader.close(); readonly.close(); writer.close(); rmSync(directory, { recursive: true, force: true });
    }
  });
});
