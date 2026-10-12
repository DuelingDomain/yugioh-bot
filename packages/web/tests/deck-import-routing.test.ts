import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createCardCatalogService } from "@yugidraft/shared/services";
import { resolveDeckImport } from "../src/lib/deck-import";

let db: Database.Database;
let catalog: ReturnType<typeof createCardCatalogService>;
beforeEach(() => {
  db = new Database(":memory:"); migrate(db);
  for (const [id, name, type] of [[901, "Test Spell", "Spell Card"], [902, "Test Trap", "Trap Card"],
    [903, "Test Fusion", "Fusion Monster"], [904, "Test Pendulum", "Pendulum Effect Monster"],
    [905, "Test Ritual", "Ritual Effect Monster"], [906, "Test Effect", "Effect Monster"]] as const) {
    db.prepare("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (?,?,?,'test','','','[]','test')").run(id, name, type);
  }
  catalog = createCardCatalogService(db, { fetch: async () => { throw new Error("No network in these tests"); } });
});
afterEach(() => db.close());
function ydke(main: number[], extra: number[], side: number[]) {
  const encode = (codes: number[]) => { const data = Buffer.alloc(codes.length * 4); codes.forEach((code, index) => data.writeUInt32LE(code, index * 4)); return data.toString("base64"); };
  return `ydke://${encode(main)}!${encode(extra)}!${encode(side)}!`;
}
describe("deck import type routing", () => {
  it.each([
    ["YDK", "#main\n903\n#extra\n901\n902\n901\n904\n905\n906\n!side\n902\n903"],
    ["YDKE", ydke([903], [901, 902, 901, 904, 905, 906], [902, 903])],
    ["name list", "Main Deck:\nTest Fusion\nExtra Deck:\nTest Spell x2\nTest Trap\nTest Pendulum\nTest Ritual\nTest Effect\nSide Deck:\nTest Trap\nTest Fusion"],
    ["passcode list", "Main:\n903\nExtra:\n901 x2\n902\n904\n905\n906\nSide:\n902\n903"],
    ["inline markers", "Test Fusion [Main]\nTest Spell [Extra] x2\nTest Trap [Extra]\nTest Pendulum [Extra]\nTest Ritual [Extra]\nTest Effect [Extra]\nTest Trap [Side]\nTest Fusion [Side]"],
  ])("corrects %s and reports all moved copies", async (_format, text) => {
    const result = await resolveDeckImport(catalog, text, "normal");
    expect([...result.deck.main].sort()).toEqual([901, 901, 902, 904, 905, 906]);
    expect(result.deck.extra).toEqual([903]);
    expect(result.deck.side).toEqual([902, 903]);
    expect(result.moves.filter(move => move.from === "extra")).toHaveLength(6);
    expect(result.moves.filter(move => move.from === "main")).toHaveLength(1);
    expect(result.messages.join(" ")).toContain("6 cards moved from Extra Deck to Main Deck");
    expect(result.messages.join(" ")).toContain("Test Spell");
    expect(result.messages.join(" ")).toContain("Test Trap");
  });
  it("auto-routes a bare passcode list and bare name list", async () => {
    for (const text of ["901\n902\n903", "Test Spell\nTest Trap\nTest Fusion"]) {
      expect((await resolveDeckImport(catalog, text, "normal")).deck).toEqual({ main: [901, 902], extra: [903], side: [] });
    }
  });
  it("keeps an explicit Master and preserves the lone Side card for the caller's Domain rule", async () => {
    const result = await resolveDeckImport(catalog, "#deckmaster\n905\n#main\n903\n#extra\n901\n!side\n906", "normal");
    expect(result.mode).toBe("domain");
    expect(result.deck).toEqual({ main: [901], extra: [903], side: [906], deckMaster: 905 });
  });
  it("resolves mixed names and passcodes beside an explicit Master without losing named cards", async () => {
    const result = await resolveDeckImport(catalog, "#deckmaster\n905\n#main\nTest Spell\n903\n#extra\nTest Fusion\n901", "normal");
    expect(result.deck).toEqual({ main: [901, 901], extra: [903, 903], side: [], deckMaster: 905 });
    const namedMaster = await resolveDeckImport(catalog, "#deckmaster\nTest Ritual\n#extra\nTest Trap", "normal");
    expect(namedMaster.deck).toEqual({ main: [902], extra: [], side: [], deckMaster: 905 });
  });

  it("routes and reports using verified engine bits when catalog text is stale", async () => {
    db.prepare("update card_catalog set type='Fusion Monster' where ygoprodeck_id=901").run();
    const result = await resolveDeckImport(catalog, "#extra\n901", "normal", new Map([[901, { name: "Test Spell", type: 0x2 }]]));
    expect(result.deck).toEqual({ main: [901], extra: [], side: [] });
    expect(result.moves).toHaveLength(1);
    expect(result.messages).toContain("1 card moved from Extra Deck to Main Deck: Test Spell.");
  });

  it("keeps overflow in Main rather than losing copies or changing Side", async () => {
    const result = await resolveDeckImport(catalog, "Main:\nTest Effect x60\nExtra:\nTest Spell x3", "normal");
    expect(result.deck.main).toHaveLength(63);
    expect(result.deck.side).toEqual([]);
  });
  it("rejects unsafe input and excessive allocations without a partial deck", async () => {
    await expect(resolveDeckImport(catalog, "Test Spell x999999999", "normal")).rejects.toThrow("at most 300");
    await expect(resolveDeckImport(catalog, "Test Spell", "other")).rejects.toThrow("Deck mode");
    await expect(resolveDeckImport(catalog, "", "normal")).rejects.toThrow();
  });
});
