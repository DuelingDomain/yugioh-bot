import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCardInsightService } from "../src/services/card-insights.js";
import { createInsightCatalog } from "../src/services/card-insight-catalog.js";
import { defaultDuelSettings, type DuelDeck } from "../src/duels/index.js";
import { loadDeckSuggestionQualityCatalog } from "./fixtures/deck-suggestions-quality.js";
import type { DeckSuggestionLegality } from "../src/services/deck-suggestions.js";
import { viableSuggestionStaple } from "../src/services/deck-suggestion-staples.js";

const engine = process.env.DECK_SUGGESTIONS_ENGINE_DIRECTORY;
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/deck-suggestions-outside.json", import.meta.url), "utf8")) as {
  decks: Array<{ id: number; format: "normal" | "domain"; deck: DuelDeck }>;
};

describe.skipIf(!engine || !existsSync(`${engine}/cards.cdb`))("Outside utility over the real catalog and host admission", () => {
  let db: Database.Database, catalog: ReturnType<typeof createInsightCatalog>, service: ReturnType<typeof createCardInsightService>;
  let scopeFor: (mode: "normal" | "domain", directory: string, settings: ReturnType<typeof defaultDuelSettings>, opts: { deckMaster?: number }) => DeckSuggestionLegality;
  const fixture = (id: number) => fixtures.decks.find(deck => deck.id === id)!;
  const rows = (id: number, deck = fixture(id).deck, options = {}) => {
    const format = fixture(id).format, banlist = defaultDuelSettings(format).banlist;
    return service.suggestRows(deck, { format, banlist, legality: scopeFor(format, engine!, defaultDuelSettings(format), { deckMaster: deck.deckMaster }), cache: false, ...options });
  };
  const outside = (id: number, deck = fixture(id).deck) => rows(id, deck).rows[1]!.cards;

  beforeAll(async () => {
    db = process.env.DECK_SUGGESTIONS_QUALITY_DATABASE
      ? new Database(process.env.DECK_SUGGESTIONS_QUALITY_DATABASE, { readonly: true, fileMustExist: true })
      : loadDeckSuggestionQualityCatalog(engine!).db;
    catalog = createInsightCatalog(db, engine);
    service = createCardInsightService(db, { dataDirectory: engine, catalog });
    scopeFor = (await import(new URL("../../duel-server/src/deck-legality.ts", import.meta.url).href)).deckSuggestionScope;
  }, 120_000);
  afterAll(() => { catalog?.close(); db?.close(); });

  it("replaces Odion's false generic links with specific, costed utility and permits an underfilled row", () => {
    const cards = outside(10), names = cards.map(card => card.name);
    for (const name of ["Monster Reborn", "Foolish Burial", "De-Fusion", "De-Synchro", "Mimicat", "Viper's Rebirth", "Summoner Monk"]) expect(names).not.toContain(name);
    expect(names).toEqual(expect.arrayContaining(["Small World", "Metaverse", "Set Rotation", "Unexpected Dai"]));
    expect(names.length).toBeLessThan(8);
    expect(cards.find(card => card.name === "Metaverse")!.reason).toMatch(/Treasures.*later/);
    expect(cards.find(card => card.name === "Unexpected Dai")!.reason).toMatch(/no monsters/i);
  });

  it("retains the Skull Archfiend Ritual route and adequate draw density, omitting normal-summon competition", () => {
    const cards = outside(9), names = cards.map(card => card.name);
    expect(names).toEqual(expect.arrayContaining(["Pre-Preparation of Rites", "Reinforcement of the Army", "Small World", "Foolish Burial", "Trade-In"]));
    expect(cards.find(card => card.name === "Foolish Burial")!.reason).toMatch(/Skull Archfiend.*Ritual/i);
    expect(cards.find(card => card.name === "Foolish Burial Goods")!.reason).toMatch(/Needs related card in GY/);
    expect(names).not.toContain("Manju of the Ten Thousand Hands");
    expect(names).not.toContain("Prima Light"); // its same-option EARTH Warrior Tribute is mandatory
    expect(names).not.toContain("Preparation of Rites");
    expect(names).not.toContain("Magicians' Souls");
    expect(rows(9).rows[2]).toMatchObject({ state: "hint", mainCards: 38 });
    expect(outside(10).map(card => card.name)).not.toContain("Trade-In");
  });

  it("keeps Blue-Eyes support honest about GY setup, complete Fusion materials and locks", () => {
    const cards = outside(3), names = cards.map(card => card.name);
    expect(names).toEqual(expect.arrayContaining(["Return of the Dragon Lords", "Summoner's Art", "Trade-In", "Dragon's Mirror", "Silver's Cry"]));
    expect(names).not.toContain("Dragonic Tactics");
    expect(names).not.toContain("Fusion Deployment");
    expect(names).not.toContain("Fusion Conscription");
    expect(cards.find(card => card.name === "Dragon's Mirror")!.reason).toMatch(/Tyrant/);
    expect(cards.find(card => card.name === "Return of the Dragon Lords")!.reason).toMatch(/GY/);
    expect(cards.some(card => /Magia/.test(card.reason))).toBe(false);
    expect(viableSuggestionStaple(catalog.candidate(48130397)!, [catalog.candidate(80532587)!])).toBe(false);
    expect(viableSuggestionStaple(catalog.candidate(24094653)!, [])).toBe(false);
    expect(viableSuggestionStaple(catalog.candidate(3659803)!, [catalog.candidate(11443677)!],
      [catalog.candidate(89631139)!, catalog.candidate(30576089)!, catalog.candidate(24094653)!])).toBe(false);
    expect(rows(3).rows[3]!.cards.map(c => c.name)).toContain("Polymerization");
  });

  it("drops routes when their actual enablers or physical copies disappear", () => {
    const without = (id: number, code: number) => ({ ...fixture(id).deck, main: fixture(id).deck.main.filter(c => c !== code) });
    expect(outside(9, without(9, 24088928)).map(c => c.name)).not.toContain("Foolish Burial");
    const noRitualRoute = without(9, 24088928);
    expect(outside(9, { ...noRitualRoute, main: [...noRitualRoute.main, 99370594, 35705817] }).map(c => c.name)).not.toContain("Foolish Burial");
    expect(outside(10, { main: [71039903], extra: [], side: [] }).map(c => c.name)).not.toContain("Foolish Burial");
    const noRecoveryEnabler = fixture(9).deck.main.filter(code => code === 33599853 || !catalog.candidate(code)?.card.text.includes('"Light and Darkness Ritual"'));
    expect(outside(9, { ...fixture(9).deck, main: noRecoveryEnabler }).map(c => c.name)).not.toContain("Foolish Burial Goods");
    expect(outside(10, without(10, 87979586)).map(c => c.name)).not.toContain("Unexpected Dai");
    const fields = fixture(10).deck.main.filter(code => code === 69299029 || !catalog.candidate(code)?.card.subtypes.includes("field"));
    expect(outside(10, { ...fixture(10).deck, main: fields }).map(c => c.name)).not.toContain("Set Rotation");
    // This three-monster witness is destroyed when its sole middle is removed.
    const witness = { main: [87979586, 32909498, 97522863], extra: [], side: [] };
    expect(outside(10, witness).map(c => c.name)).toContain("Small World");
    expect(outside(10, { ...witness, main: [87979586, 97522863] }).map(c => c.name)).not.toContain("Small World");
  });

  it("keeps common admission and row ownership, sampled role reasons, aliases, pools and bans", () => {
    for (const id of [10, 9, 3]) {
      const result = rows(id), all = result.rows.flatMap(row => row.cards);
      expect(result.version).toMatch(/^suggestions-4:/);
      expect(new Set(all.map(c => c.passcode)).size).toBe(all.length);
      const held = new Set([...fixture(id).deck.main, ...fixture(id).deck.extra, ...fixture(id).deck.side, fixture(id).deck.deckMaster ?? 0].map(catalog.canonical));
      expect(all.every(c => !held.has(c.passcode))).toBe(true);
      expect(rows(id, fixture(id).deck, { pool: [] }).rows.every(row => !row.cards.length)).toBe(true);
      expect(rows(id, fixture(id).deck, { legality: undefined }).rows.every(row => !row.cards.length)).toBe(true);
      expect(result.rows[3]!.cards.every(c => /Format staple: .*sampled/.test(c.reason))).toBe(true);
      for (const card of result.rows[3]!.cards) expect(result.rows[1]!.cards.map(c => c.passcode)).not.toContain(card.passcode);
      if (id !== 3) for (const code of [97631303, 24224830, 25311006]) expect(all.map(c => c.passcode)).not.toContain(code);
    }
  });
});
