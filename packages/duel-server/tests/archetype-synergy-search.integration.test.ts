import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createCardInsightService } from "@yugidraft/shared/services";
import { importCardEffectArtifact } from "@yugidraft/shared/cards/effects";
import { emptyCardQuery, inArchetype } from "@yugidraft/shared/duels";
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

  it("returns the full 15 plus 25 synergy selection for the Describe pane's 30-card request", () => {
    const service = createCardInsightService(db, { dataDirectory: engineDataDirectory });
    const pool = [...cards.all()].map(card => card.code);
    for (const limit of [undefined, 1, 30, 120]) {
      const result = service.effectSearch("Monarch synergy", pool, { limit });
      expect(result.total).toBe(40);
      expect(result.cards).toHaveLength(40);
      expect(result.cards.filter(card => card.synergyCategory !== "outside")).toHaveLength(15);
      expect(result.cards.filter(card => card.synergyCategory === "outside")).toHaveLength(25);
    }
  });

  it("keeps named Temple support first and rejects incidental Trap interactions", () => {
    const result = search("Temple of the Kings synergy");
    const names = result.effectHits!.map(card => card.name);
    expect(names[0]).toBe("Temple of the Kings");
    expect(names).toEqual(expect.arrayContaining(["Trap Trick", "Lady Labrynth of the Silver Castle", "Trap Holic"]));
    expect(search("Temple of the Kings synergy", { passcodes: [32785578] }).effectHits!.map(card => card.name)).toEqual(["Farewelcome Labrynth"]);
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
    expect(result.effectHits![0]!.synergyCategory).toBe("member");
  });
  it("distinguishes discard costs from discarding by card effect", () => {
    const result = search("Labrynth synergy", { passcodes: [79126789, 60228941, 43316238] });
    expect(result.effectHits!.map(card => card.name)).toEqual(["Danger! Bigfoot!"]);
  });
  it("requires Deck milling rather than a generic send cost for Blue-Eyes", () => {
    const result = search("Blue-Eyes synergy", { passcodes: [9064354, 5288597, 81439173] });
    expect(result.effectHits!.map(card => card.name)).toEqual(["Foolish Burial"]);
  });
  it("rejects Deck setup restricted to incompatible Attributes or Levels", () => {
    const result = search("Blue-Eyes synergy", { passcodes: [81439173, 41620959, 62265044, 28985331, 24915933] });
    expect(result.effectHits!.map(card => card.name)).toEqual(["Foolish Burial", "Dragon Shrine", "Dragon Ravine"]);
    expect(search("Destiny HERO synergy", { passcodes: [28985331] }).effectHits!.map(card => card.name)).toEqual(["Armageddon Knight"]);
  });
  it("does not treat another Type's extra Tribute Summon as Monarch support", () => {
    const result = search("Monarch synergy", { passcodes: [52112003, 5253985, 35306215, 25280974, 8910240] });
    expect(result.effectHits!.map(card => card.name)).toEqual(["Card Advance", "Rose Papillon"]);
  });
  it("uses Normal Trap setup rather than Counter-Trap-only searches for Labrynth", () => {
    const result = search("Labrynth synergy", { passcodes: [98301564, 80101899] });
    expect(result.effectHits!.map(card => card.name)).toEqual(["Trap Trick"]);
  });
  it.each(["Temple of the Kings", "Labrynth"])("rejects incompatible Trap filters and top-card excavation for %s", target => {
    const result = search(`${target} synergy`, { passcodes: [53666449, 98301564, 16261341, 952523, 91812341, 45803070, 53770666, 61307542, 80101899] });
    expect(result.effectHits!.map(card => card.name)).toEqual(["Trap Trick"]);
  });
  it("labels setup and weaker recovery by their actual source and action", () => {
    const result = search("Temple of the Kings synergy", { passcodes: [80101899, 28933734, 11443677, 24425055] });
    const setup = result.effectHits!.find(card => card.code === 80101899)!;
    const recovery = result.effectHits!.find(card => card.code === 28933734)!;
    expect(setup.reason).toContain("Sets a Normal Trap from your Deck");
    expect(recovery.reason).toContain("Returns a Trap from your GY to your hand");
    expect(recovery.score).toBeLessThan(setup.score);
    expect(result.effectHits!.find(card => card.code === 11443677)?.reason).toContain("Re-Sets a Trap from your GY");
    expect(result.effectHits!.find(card => card.code === 24425055)?.reason).toContain("Sets a Continuous Trap from your hand");
    expect(search("Labrynth synergy", { passcodes: [24425055] }).effectHits).toEqual([]);
  });
  it("does not borrow Trap text from another effect or omit a named setup prerequisite", () => {
    // Mantis' immunity mentions Normal Traps; its hand Set is generic. Cat and
    // Kelbek require Necrovalley/Exchange of the Spirit for the matching action.
    const pool = [...cards.all()].filter(card => ["Traptrix Mantis", "A Cat of Ill Omen", "Kelbek the Ancient Vanguard", "Exchange of Despair and Hope", "The Despair Uranus", "Sacred Serpent's Wake", "Legendary Knight Critias", "Diabrocken the Ominous Specter", "Sunvine Shrine", "Litmus Doom Swordsman", "Loki, Lord of the Aesir", "Labrynth Archfiend"].includes(card.name)).map(card => card.code);
    expect(pool).toHaveLength(12);
    expect(search("Temple of the Kings synergy", { passcodes: pool }).effectHits).toEqual([]);
    const sanctum = [...cards.all()].find(card => card.name === "Artifact Sanctum")!;
    expect(search("Labrynth synergy", { passcodes: [sanctum.code] }).effectHits).toEqual([]);
    const typedPayments = [...cards.all()].filter(card => ["Dragonmaid Tidying", "Icarus Attack", "Cybernetic Overflow"].includes(card.name)).map(card => card.code);
    expect(typedPayments).toHaveLength(3);
    expect(search("Labrynth synergy", { passcodes: typedPayments }).effectHits).toEqual([]);
    // These make players remove cards by rule, so they do not trigger the
    // profile's "monster leaves by your Normal Trap effect" payoff.
    expect(search("Labrynth synergy", { passcodes: [15693423, 30748475] }).effectHits).toEqual([]);
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
  it("skips discarded relaxation scans in empty nested groups but retains top-level hints", () => {
    const readings = vi.spyOn(effects, "readQuery");
    try {
      const result = search("synergy with Temple of the Kings and Blue-Eyes", { passcodes: [10515412] });
      expect(result.effectGroups?.map(group => group.cards)).toEqual([[], []]);
      expect(readings).toHaveBeenCalledTimes(1);
      expect(search("Temple of the Kings synergy", { passcodes: [10515412] }).relax?.length).toBeGreaterThan(0);
    } finally { readings.mockRestore(); }
  });
  it("bounds named synergy targets and fallback groups to four", () => {
    const result = search("synergy with Temple of the Kings and Blue-Eyes and Monarch and Labrynth and Spright and Dark World", { passcodes: [10515412] });
    const targets = ["Temple of the Kings", "Blue-Eyes", "Monarch", "Labrynth"];
    expect(result.reading?.query.supports?.archetypes).toEqual(targets);
    expect(result.effectGroups?.map(group => group.archetype)).toEqual(targets);
  });
  it.each(["Monarch synergy", "Labrynth synergy", "Blue-Eyes synergy"])("caps before pagination and preserves named support order: %s", text => {
    const result = search(text);
    expect(result.effectTotal).toBe(40);
    expect(result.effectHits).toHaveLength(40);
    expect(result.effectHits!.filter(card => card.synergyCategory !== "outside")).toHaveLength(15);
    expect(result.effectHits!.filter(card => card.synergyCategory === "outside")).toHaveLength(25);
    const page = search(text, { limit: 10, effectOffset: 30 });
    expect(page.effectTotal).toBe(40);
    expect(page.effectHits!.map(card => card.code)).toEqual(result.effectHits!.slice(30).map(card => card.code));
    expect(search(text, { effectOffset: 40 }).effectHits).toEqual([]);
  });
  it("keeps the requested Monarch outside partners despite a full member list", () => {
    const result = search("Monarch synergy");
    const outside = result.effectHits!.filter(card => card.synergyCategory === "outside");
    expect(outside.map(card => card.name)).toEqual(expect.arrayContaining(["Soul Exchange", "Lair of Darkness", "Gameciel, the Sea Turtle Kaiju"]));
  });
  it.each(["Monarch synergy", "Labrynth synergy", "Blue-Eyes synergy"])("keeps at most three outside cards in any other archetype: %s", text => {
    const outside = search(text).effectHits!.filter(card => card.synergyCategory === "outside");
    for (const [code, name] of cards.setnames()) {
      expect(outside.filter(card => inArchetype(card.setcodes, code)).length, name).toBeLessThanOrEqual(3);
    }
    if (text === "Monarch synergy") expect(outside.slice(0, 10).map(card => card.name)).toEqual(expect.arrayContaining(["Soul Exchange", "Lair of Darkness"]));
  });
  it("applies diversity within a constrained pool without inventing replacements", () => {
    const result = search("Monarch synergy", { passcodes: [55063751, 63941210, 93332803, 28674152, 48770333, 68005187, 52112003] });
    expect(result.effectHits).toHaveLength(5);
    expect(result.effectTotal).toBe(5);
    expect(result.effectHits!.map(card => card.name)).toEqual(expect.arrayContaining(["Soul Exchange", "Card Advance"]));
    expect(search("Monarch synergy", { passcodes: [55063751, 63941210, 93332803, 28674152, 48770333] }).effectTotal).toBe(3);
  });
  it("rejects incidental milling as Blue-Eyes setup even in an explicit pool", () => {
    const result = search("Blue-Eyes synergy", { passcodes: [572850, 67441435, 96363153, 58577036, 3040496, 15381252, 21903613, 81439173, 41620959, 62265044, 63198739] });
    expect(result.effectHits!.map(card => card.name)).toEqual(["Foolish Burial", "Dragon Shrine", "Dragon Ravine", "Primite Dragon Ether Beryl"]);
  });
});
