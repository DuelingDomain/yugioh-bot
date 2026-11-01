import Database from "better-sqlite3";
import { cpSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCardInsightService } from "../src/services/card-insights.js";
import { createInsightCatalog } from "../src/services/card-insight-catalog.js";
import { defaultDuelSettings, type DuelDeck } from "../src/duels/index.js";
import { loadDeckSuggestionQualityCatalog } from "./fixtures/deck-suggestions-quality.js";
import type { CardTags } from "../src/cards/effects/tags.js";
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
    expect(names).not.toContain("Dwimmered Path");
    expect(names.length).toBeLessThan(8);
    expect(cards.find(card => card.name === "Metaverse")!.reason).toMatch(/Treasures.*later/);
    expect(cards.find(card => card.name === "Unexpected Dai")!.reason).toMatch(/no monsters/i);
  });

  it("retains the Skull Archfiend Ritual route and adequate draw density, omitting normal-summon competition", () => {
    const cards = outside(9), names = cards.map(card => card.name);
    expect(names).toEqual(expect.arrayContaining(["Pre-Preparation of Rites", "Small World", "Foolish Burial", "Trade-In"]));
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
    expect(names).toEqual(expect.arrayContaining(["Summoner's Art", "Trade-In", "Dragon's Mirror", "One-Way Synchro"]));
    expect(names).not.toContain("Dragonic Tactics");
    expect(names).not.toContain("Fusion Deployment");
    expect(names).not.toContain("Fusion Conscription");
    expect(cards.find(card => card.name === "Dragon's Mirror")!.reason).toMatch(/Tyrant/);
    for (const name of ["Return of the Dragon Lords", "Silver's Cry", "Ancient Rules", "Dwimmered Path"]) expect(names).not.toContain(name);
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


  it("requires hand-summon density and keeps the hand prerequisite visible", () => {
    const dragon = 89631139;
    expect(outside(10, { main: [dragon], extra: [], side: [] }).map(c => c.name)).not.toContain("Ancient Rules");
    const live = outside(10, { main: [dragon, dragon, dragon, 46986414, 46986414, 46986414], extra: [], side: [] });
    expect(live.find(c => c.name === "Ancient Rules")?.reason).toMatch(/from hand/i);
  });

  it("follows sent-to-GY searches only when the searched card has a proved use", () => {
    const deck = { main: [79814787, 89631139, 89631139, 89631139, 10667321], extra: [], side: [] };
    const cards = outside(10, deck);
    expect(cards.find(c => c.name === "Foolish Burial")?.reason).toMatch(/Needs Ancient Rules in hand:.*White Stone of Legend/);
    expect(outside(10, { ...deck, main: [79814787] }).map(c => c.name)).not.toContain("Foolish Burial");
    expect(outside(10, { ...deck, main: deck.main.filter(code => code !== 10667321) }).map(c => c.name)).not.toContain("Foolish Burial");
  });

  it("rejects Field access when the Field payoff has an unproved mandatory action", () => {
    // Galloping Gaia cannot search Gaia without first revealing a Level 5 Dragon.
    const cards = outside(10, { main: [2106266, 6368038], extra: [], side: [] });
    expect(cards.map(c => c.name)).not.toContain("Terraforming");
    expect(cards.map(c => c.name)).not.toContain("Metaverse");
  });

  it("measures unnamed monster-filter breadth against legal monsters", () => {
    const allowed = new Set(scopeFor("normal", engine!, defaultDuelSettings("normal"), {}).allowed);
    let legal = 0, monsters = 0, warriors = 0;
    for (const { card } of catalog.suggestionCandidates()) {
      if (!allowed.has(card.id)) continue;
      legal++;
      if (card.kind !== "monster") continue;
      monsters++;
      if (card.monsterType === "Warrior" && card.level && card.level <= 4) warriors++;
    }
    expect(warriors).toBeGreaterThan(monsters * 0.06);
    expect(warriors).toBeLessThanOrEqual(legal * 0.06);
    expect(outside(9).map(c => c.name)).not.toContain("Reinforcement of the Army");
  });

  it("uses capability proofs for other admitted providers and retains known shapes after the cap", async () => {
    const directory = mkdtempSync(join(tmpdir(), "suggestions-capabilities-"));
    await db.backup(join(directory, "catalog.sqlite"));
    const scratch = new Database(join(directory, "catalog.sqlite"));
    let isolated: ReturnType<typeof createInsightCatalog> | undefined;
    try {
      cpSync(engine!, directory, { recursive: true });
      const cards = new Database(join(directory, "cards.cdb"));
      // Clone real capabilities under independent identities in disposable catalog
      // and engine fixtures, then exercise the complete authoritative service path.
      const clone = (sourceName: string, id: number, name: string, edit?: (tags: CardTags) => void) => {
        const source = (scratch.prepare("SELECT ygoprodeck_id AS id FROM card_catalog WHERE name=? LIMIT 1").get(sourceName) as { id: number }).id;
        for (const [database, table, key] of [[scratch, "card_catalog", "ygoprodeck_id"], [scratch, "card_tags", "passcode"],
          [cards, "datas", "id"], [cards, "texts", "id"]] as const) {
          const columns = (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name);
          database.prepare(`INSERT INTO ${table} (${columns.join(",")}) SELECT ${columns.map(c => c === key ? "?" : c).join(",")} FROM ${table} WHERE ${key}=?`).run(id, source);
        }
        scratch.prepare("UPDATE card_catalog SET name=? WHERE ygoprodeck_id=?").run(name, id);
        cards.prepare("UPDATE texts SET name=? WHERE id=?").run(name, id);
        const script = [join(directory, "card-scripts", `c${source}.lua`), join(directory, "card-scripts", "official", `c${source}.lua`)].find(existsSync)!;
        copyFileSync(script, join(directory, "card-scripts", `c${id}.lua`));
        if (edit) {
          const tags = JSON.parse((scratch.prepare("SELECT tags_json FROM card_tags WHERE passcode=?").get(id) as { tags_json: string }).tags_json);
          edit(tags);
          scratch.prepare("UPDATE card_tags SET tags_json=? WHERE passcode=?").run(JSON.stringify(tags), id);
        }
      };
      try {
        clone("Small World", 3800000001, "Relational bridge access");
        clone("Metaverse", 3800000002, "Field search access");
        clone("Set Rotation", 3800000003, "Paired Field Set access");
        clone("Dwimmered Path", 3800000004, "Broad Spellcaster search", tags => { tags.effects[0]!.actions[0]!.from = ["deck"]; });
        for (let index = 0; index < 256; index++) clone("Ancient Rules", 3800000010 + index, `Narrow Dragon search ${index}`, tags => {
          const action = tags.effects[0]!.actions[0]!; action.verb = "add_to_hand"; action.from = ["deck"];
          action.what.subtypes = []; action.what.types = ["Dragon"]; action.what.level_min = 8; action.what.level_max = 8;
          action.what.other = `${index} or more ATK`;
        });
        clone("Ancient Rules", 3800000300, "Later known Dragon search", tags => {
          const action = tags.effects[0]!.actions[0]!; action.verb = "add_to_hand"; action.from = ["deck"];
          action.what.subtypes = []; action.what.types = ["Dragon"]; action.what.level_min = 8; action.what.level_max = 8; action.what.other = "0 or more ATK";
        });
        scratch.prepare("UPDATE card_tags SET popularity=2000000000 WHERE passcode=3800000300").run();
      } finally { cards.close(); }
      isolated = createInsightCatalog(scratch, directory);
      const api = createCardInsightService(scratch, { dataDirectory: directory, catalog: isolated });
      const settings = defaultDuelSettings("normal"), legality = scopeFor("normal", directory, settings, {});
      const run = (deck: DuelDeck, pool?: number[]) => api.suggestRows(deck, { format: "normal", banlist: settings.banlist, legality, cache: false, pool });
      const providers = [3800000001, 3800000002, 3800000003, 3800000004];
      expect(providers.every(code => legality.allowed.includes(code))).toBe(true);
      const odion = run(fixture(10).deck, providers).rows[1]!.cards.map(c => c.passcode);
      expect(odion).toEqual(expect.arrayContaining(providers.slice(0, 3)));
      expect(odion).not.toContain(3800000004); // Effect alone adds no second restriction.
      const witness = { main: [87979586, 97522863], extra: [], side: [] };
      expect(run(witness, providers).rows[1]!.cards.map(c => c.passcode)).not.toContain(3800000001);
      const dragons = { main: [89631139], extra: [], side: [] };
      expect(run(dragons).rows[1]!.cards.map(c => c.passcode)).toContain(3800000300);
      // A sampled generic staple that is also an archetype member belongs in
      // Archetype. Preserve its sampled usage while adding fixture membership.
      scratch.prepare("UPDATE card_catalog SET archetype='Blue-Eyes' WHERE ygoprodeck_id=24094653").run();
      const owned = run(dragons);
      expect(owned.rows[0]!.cards.map(c => c.passcode)).toContain(24094653);
      expect(owned.rows[3]!.cards.map(c => c.passcode)).not.toContain(24094653);
    } finally { isolated?.close(); scratch.close(); rmSync(directory, { recursive: true, force: true }); }
  }, 120_000);

  it("keeps common admission and row ownership, sampled role reasons, aliases, pools and bans", () => {
    for (const id of [10, 9, 3]) {
      const result = rows(id), all = result.rows.flatMap(row => row.cards);
      expect(result.version).toMatch(/^suggestions-5:/);
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
