import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { importCardEffectArtifact } from "@yugidraft/shared/cards/effects";
import { emptyCardQuery } from "@yugidraft/shared/duels";
import { loadCardDatabase } from "../src/cards.js";
import { createCanonicalEffectResolver, createCardEffectIndex, type CardEffectIndex } from "../src/card-effects.js";
import { queryCards } from "../src/card-search.js";
import { engineDataDirectory } from "./engine-data-dir.js";

describe.skipIf(!existsSync(`${engineDataDirectory}/cards.cdb`))("specific synergy through the real card catalog and stored artifact", () => {
  let db: Database.Database, cards: ReturnType<typeof loadCardDatabase>, effects: CardEffectIndex;
  beforeAll(() => {
    db = new Database(":memory:"); migrate(db);
    cards = loadCardDatabase(engineDataDirectory);
    importCardEffectArtifact(db, { canonicalize: createCanonicalEffectResolver(cards) });
    effects = createCardEffectIndex(db, cards);
  }, 20_000);
  afterAll(() => { cards?.close(); db?.close(); });
  const search = (text: string, extra: Partial<ReturnType<typeof emptyCardQuery>> = {}) =>
    queryCards(cards, { ...emptyCardQuery(), text, limit: 120, ...extra }, undefined, undefined, { effects, effectSearchEnabled: true });

  it("keeps named Temple support first and rejects incidental Trap interactions", () => {
    const result = search("Temple of the Kings synergy");
    const names = result.effectHits!.map(card => card.name);
    expect(names[0]).toBe("Temple of the Kings");
    expect(names).toEqual(expect.arrayContaining(["Trap Trick", "Lady Labrynth of the Silver Castle", "Trap Holic", "Farewelcome Labrynth"]));
    for (const name of ["Ryu Senshi", "Lightstorm Dragon", "Fossil Machine Skull Wagon", "Elemental HERO Wild Wingman", "Gem-Knight Prismaura", "Evil Dragon Ananta", "That's 10!", "Magician's Rod", "Toadally Awesome", "F.A. Dawn Dragster", "Number 100: Numeron Dragon"]) expect(names).not.toContain(name);
    expect(result.effectTotal).toBeLessThanOrEqual(40);
  });
  it("retains genuine Tribute Summon support in explicit pools", () => {
    const result = search("Monarch synergy", { passcodes: [52112003, 68005187, 48770333, 4929256] });
    expect(result.effectHits![0]!.name).toBe("Mobius the Frost Monarch");
    expect(result.effectHits!.map(card => card.name)).toContain("Card Advance");
  });
  it("keeps only a real hook into both Temple and Blue-Eyes", () => {
    const result = search("synergy with Temple of the Kings and Blue-Eyes");
    expect(result.effectHits!.map(card => card.name)).toEqual(["Blue-Eyes Tyrant Dragon"]);
    expect(result.effectHits![0]!.reason).toContain("Temple of the Kings + Blue-Eyes");
    expect(result.effectGroups).toBeUndefined();
  });
  it("distinguishes discard costs from discarding by card effect", () => {
    const result = search("Labrynth synergy", { passcodes: [79126789, 60228941, 43316238] });
    expect(result.effectHits!.map(card => card.name)).toEqual(["Danger! Bigfoot!"]);
  });
  it("requires Deck milling rather than a generic send cost for Blue-Eyes", () => {
    const result = search("Blue-Eyes synergy", { passcodes: [9064354, 5288597, 81439173] });
    expect(result.effectHits!.map(card => card.name)).toEqual(["Foolish Burial"]);
  });
  it("uses Normal Trap setup rather than Counter-Trap-only searches for Labrynth", () => {
    const result = search("Labrynth synergy", { passcodes: [98301564, 80101899] });
    expect(result.effectHits!.map(card => card.name)).toEqual(["Trap Trick"]);
  });
  it("rejects Tribute removal that forbids the deck's Normal Summon", () => {
    const result = search("Monarch synergy", { passcodes: [102380, 55063751] });
    expect(result.effectHits!.map(card => card.name)).toEqual(["Gameciel, the Sea Turtle Kaiju"]);
  });
  it("returns independent constrained lists when the pool has no shared hook", () => {
    const result = search("synergy with Temple of the Kings and Blue-Eyes", { passcodes: [80101899, 8240199, 10515412] });
    expect(result.effectHits).toEqual([]);
    expect(result.effectTotal).toBe(0);
    expect(result.effectGroups?.map(group => [group.archetype, group.cards.map(card => card.name)])).toEqual([
      ["Temple of the Kings", ["Trap Trick"]], ["Blue-Eyes", ["Sage with Eyes of Blue"]],
    ]);
  });
  it.each(["Monarch synergy", "Labrynth synergy", "Blue-Eyes synergy"])("caps before pagination and preserves named support order: %s", text => {
    const result = search(text);
    expect(result.effectTotal).toBe(40);
    expect(result.effectHits).toHaveLength(40);
    expect(result.effectHits!.slice(0, 10).every(card => card.score >= 280)).toBe(true);
    const page = search(text, { limit: 10, effectOffset: 30 });
    expect(page.effectTotal).toBe(40);
    expect(page.effectHits!.map(card => card.code)).toEqual(result.effectHits!.slice(30).map(card => card.code));
    expect(search(text, { effectOffset: 40 }).effectHits).toEqual([]);
  });
});
