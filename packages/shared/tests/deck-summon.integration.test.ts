import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/schema.js";
import { importCardEffectArtifact } from "../src/cards/effects/artifact.js";
import { canSummonFromMain } from "../src/cards/effects/deck-summon.js";
import { NO_FILTER, type CardTags } from "../src/cards/effects/tags.js";
import { createInsightCatalog } from "../src/services/card-insight-catalog.js";

const db = new Database(":memory:");
const directory = mkdtempSync(join(tmpdir(), "deck-summon-integration-"));
let catalog: ReturnType<typeof createInsightCatalog>;
const rows: Array<[number, string, string, number | null, string | null, string, string | null]> = [
  [89631139, "Blue-Eyes White Dragon", "Dragon / Normal Monster", 8, "LIGHT", "The ultimate creature of destruction.", "Blue-Eyes"],
  [46986414, "Dark Magician", "Spellcaster / Normal Monster", 7, "DARK", "The ultimate wizard.", "Dark Magician"],
  [97268402, "Effect Veiler", "Spellcaster / Tuner / Effect Monster", 1, "LIGHT", "During your opponent's Main Phase: You can send this card to the GY.", null],
  [7084129, "Magician's Rod", "Spellcaster / Effect Monster", 3, "DARK", "If this card is Normal Summoned: You can add a card to your hand.", "Dark Magician"],
  [68468459, "Fallen of Albaz", "Dragon / Effect Monster", 4, "DARK", 'If this card is Normal or Special Summoned: You can discard 1 card; Fusion Summon 1 Fusion Monster from your Extra Deck, using monsters on either field as Fusion Material, including this card, but you cannot use other monsters you control as Fusion Material. You can only use this effect of "Fallen of Albaz" once per turn.', null],
  [59011257, "Fallin' Cheatah", "Beast / Effect Monster", 3, "FIRE", "Cannot be Tributed, nor used as material for a Fusion, Synchro, Xyz, or Link Summon, while face-up on the field.", null],
  [71039903, "The White Stone of Ancients", "Dragon / Tuner / Effect Monster", 1, "LIGHT", "Once per turn, during the End Phase: You can Special Summon a monster.", "Blue-Eyes"],
  [15839054, "Synchro Fusionist", "Spellcaster / Effect Monster", 2, "DARK", "If this card is sent to the GY as Synchro Material: You can add a Spell to your hand.", null],
  [24094653, "Polymerization", "Spell Card", null, null, "Fusion Summon 1 Fusion Monster from your Extra Deck, using monsters from your hand or field as Fusion Material.", null],
  [44362883, "Branded Fusion", "Spell Card", null, null, 'Fusion Summon 1 Fusion Monster that mentions "Fallen of Albaz" as material from your Extra Deck, using 2 monsters from your hand, Deck, or field as Fusion Material. You cannot Special Summon monsters from the Extra Deck, except Fusion Monsters, the turn you activate this card. You can only activate 1 "Branded Fusion" per turn.', "Branded"],
  [44508094, "Stardust Dragon", "Dragon / Synchro / Effect Monster", 8, "WIND", "1 Tuner + 1+ non-Tuner monsters\nWhen a card or effect is activated: You can Tribute this card.", "Stardust"],
  [59822133, "Blue-Eyes Spirit Dragon", "Dragon / Synchro / Effect Monster", 9, "LIGHT", '1 Tuner + 1+ non-Tuner "Blue-Eyes" monsters\nNeither player can Special Summon 2 or more monsters at the same time.', "Blue-Eyes"],
  [40908371, "Azure-Eyes Silver Dragon", "Dragon / Synchro / Effect Monster", 9, "LIGHT", "1 Tuner + 1+ non-Tuner Normal Monsters\nIf this card is Special Summoned: Dragon monsters you control gain protection.", null],
  [63767246, "Number 38: Hope Harbinger Dragon Titanic Galaxy", "Dragon / Xyz / Effect Monster", 8, "LIGHT", "2 Level 8 monsters\nOnce per turn, when a Spell Card or effect is activated: You can negate that effect.", null],
  [28400508, "Number 97: Draglubion", "Dragon / Xyz / Effect Monster", 8, "DARK", "2 Level 8 monsters\nYour opponent cannot target this card with card effects.", "Number"],
  [2129638, "Blue-Eyes Twin Burst Dragon", "Dragon / Fusion / Effect Monster", 10, "LIGHT", '"Blue-Eyes White Dragon" + "Blue-Eyes White Dragon"\nMust be either Fusion Summoned, or Special Summoned by sending the above monsters you control to the GY.', "Blue-Eyes"],
  [23995346, "Blue-Eyes Ultimate Dragon", "Dragon / Fusion Monster", 12, "LIGHT", '"Blue-Eyes White Dragon" + "Blue-Eyes White Dragon" + "Blue-Eyes White Dragon"', "Blue-Eyes"],
  [70534340, "Lubellion the Searing Dragon", "Dragon / Fusion / Effect Monster", 8, "LIGHT", '1 DARK monster + "Fallen of Albaz"\nIf this card is Fusion Summoned: You can discard 1 card.', null],
  [44146295, "Mirrorjade the Iceblade Dragon", "Wyrm / Fusion / Effect Monster", 8, "DARK", '"Fallen of Albaz" + 1 Fusion, Synchro, Xyz, or Link Monster\nYou can only control 1 "Mirrorjade the Iceblade Dragon".', null],
  [24361622, "Hieratic Seal of the Heavenly Spheres", "Dragon / Link / Effect Monster", 2, "LIGHT", "2 Dragon monsters\nOnce per opponent's turn: You can Tribute 1 monster.", "Hieratic"],
  [65741786, "I:P Masquerena", "Cyberse / Link / Effect Monster", 2, "DARK", "2 non-Link Monsters\nDuring your opponent's Main Phase: You can Link Summon.", null],
  [29301450, "S:P Little Knight", "Warrior / Link / Effect Monster", 2, "DARK", "2 Effect Monsters\nIf this card is Link Summoned: You can banish 1 card.", null],
  [4280258, "Apollousa, Bow of the Goddess", "Fairy / Link / Effect Monster", 4, "WIND", "2+ monsters with different names, except Tokens\nYou can only control 1 Apollousa.", null],
  [40854197, "Elemental HERO Absolute Zero", "Warrior / Fusion / Effect Monster", 8, "WATER", '1 "HERO" monster + 1 WATER monster\nMust be Fusion Summoned.', "HERO"],
  [18548966, "Heroic Challenger - Morning Star", "Warrior / Effect Monster", 4, "EARTH", "If you control 2 or more Warrior monsters, you can Special Summon this card.", "Heroic"],
  [18063928, "Tin Goldfish", "Machine / Effect Monster", 4, "WATER", "When this card is Normal Summoned: You can Special Summon 1 Level 4 monster from your hand.", null],
  [40044918, "Elemental HERO Stratos", "Warrior / Effect Monster", 4, "WIND", "When this card is Normal or Special Summoned: You can add 1 HERO monster from your Deck to your hand.", "Elemental HERO"],
];

beforeAll(() => {
  migrate(db);
  const insert = db.prepare(`INSERT INTO card_catalog
    (ygoprodeck_id,name,type,frame_type,effect_text,attribute,level,archetype,image_url,image_url_small,card_sets_json,cached_at)
    VALUES(?,?,?,'',?,?,?,?, 'image','small','[]',CURRENT_TIMESTAMP)`);
  for (const [code, name, type, level, attribute, text, archetype] of rows) insert.run(code, name, type, text, attribute, level, archetype);
  importCardEffectArtifact(db);
  // Catalog-backed fixtures exercise named Link recipes and fail-closed metadata as well as pinned tags.
  const tags = (materials: CardTags["materials"]): CardTags => ({ summary: "", roles: [], keywords: [], effects: [], materials, supports: { names: [], archetypes: [], types: [], attributes: [], subtypes: [] } });
  const base = JSON.parse((db.prepare("SELECT tags_json FROM card_tags WHERE passcode=24361622").get() as { tags_json: string }).tags_json) as CardTags;
  const fixtures: Array<[number, string, string, number, CardTags]> = [
    [990101, '"Dark Magician" + 1 Dragon monster', "Dragon / Link / Effect Monster", 2, tags([{ ...NO_FILTER, names: ["Dark Magician"] }, { ...NO_FILTER, types: ["Dragon"] }])],
    [990102, "2 Dragon monsters", "Dragon / Link / Effect Monster", 2, { ...base, materials: [{ ...NO_FILTER, types: ["Dragon"], other: "previously summoned from the GY" }] }],
    [990103, "2 monsters with matching artwork", "Dragon / Link / Effect Monster", 2, tags([{ ...NO_FILTER }])],
    [990104, "2 Effect Monsters", "Dragon / Link / Effect Monster", 4, tags([{ ...NO_FILTER, subtypes: ["effect"] }])],
    [990105, "2 Level 8 Dragon monsters", "Dragon / Xyz / Effect Monster", 8, tags([{ ...NO_FILTER, types: ["Dragon"], level_min: 8, level_max: 8 }])],
    [990106, '1 "Effect Veiler" + 1+ non-Tuner monsters', "Spellcaster / Synchro / Effect Monster", 8, tags([{ ...NO_FILTER, names: ["Effect Veiler"], subtypes: ["tuner"] }, { ...NO_FILTER, other: "non-Tuner" }])],
    [990107, "2 Level 8 monsters\nYou can only Xyz Summon this card by using monsters with different names.", "Dragon / Xyz / Effect Monster", 8, tags([{ ...NO_FILTER, level_min: 8, level_max: 8 }])],
    [990108, "2 Tuners + 1 non-Tuner monster", "Dragon / Synchro / Effect Monster", 6, tags([{ ...NO_FILTER, subtypes: ["tuner"], other: "2" }, { ...NO_FILTER, other: "non-Tuner" }])],
    [990109, "1 Tuner + 2 non-Tuner monsters", "Dragon / Synchro / Effect Monster", 8, tags([{ ...NO_FILTER, subtypes: ["tuner"] }, { ...NO_FILTER, other: "2 non-Tuner monsters" }])],
    [990111, "2 Effect Monsters", "Warrior / Link / Effect Monster", 2, tags([{ ...NO_FILTER, archetypes: ["HERO"] }, { ...NO_FILTER, attributes: ["WATER"] }])],
  ];
  for (const [id, text, type, level, tagged] of fixtures) {
    insert.run(id, `Summon fixture ${id}`, type, text, "LIGHT", level, null);
    db.prepare("INSERT INTO card_tags(passcode,summary,roles_json,tags_json,source,schema_version,text_hash,tagged_at) VALUES(?,?,'[]',?,'integration',1,'test',CURRENT_TIMESTAMP)").run(id, "", JSON.stringify(tagged));
  }
  insert.run(990110, "Unknown Fusion restriction", "Spell Card", rows.find(row => row[0] === 24094653)![5], null, null, null);
  const poly = JSON.parse((db.prepare("SELECT tags_json FROM card_tags WHERE passcode=24094653").get() as { tags_json: string }).tags_json) as CardTags;
  poly.effects[0]!.actions[0]!.what.other = "requires three different original Attributes";
  db.prepare("INSERT INTO card_tags(passcode,summary,roles_json,tags_json,source,schema_version,text_hash,tagged_at) VALUES(?,?,'[]',?,'integration',1,'test',CURRENT_TIMESTAMP)").run(990110, "", JSON.stringify(poly));
  catalog = createInsightCatalog(db, directory);
});

afterAll(() => { catalog?.close(); db.close(); rmSync(directory, { recursive: true, force: true }); });

const candidate = (code: number) => catalog.candidate(code)!;
const summon = (code: number, main: number[]) => canSummonFromMain(candidate(code), main.map(candidate));

describe("complete Extra Deck recipes through the SQL catalog and pinned effect artifact", () => {
  it("distinguishes printed HERO material requirements from similarly named Heroic monsters", () => {
    expect(summon(40854197, [18548966, 18063928, 24094653])).toBeUndefined();
    expect(summon(40854197, [40044918, 18063928, 24094653])).toBeTruthy();
    expect(summon(990111, [18548966, 18063928])).toBeUndefined();
    expect(summon(990111, [40044918, 18063928])).toBeTruthy();
  });

  it("requires enough distinct same-Level Main Deck copies for Xyz recipes", () => {
    expect(summon(63767246, [89631139])).toBeUndefined();
    expect(summon(63767246, [89631139, 89631139])).toMatch(/8/);
    expect(summon(28400508, [89631139, 89631139])).toBeTruthy();
    expect(summon(63767246, [89631139, 63767246])).toBeUndefined();
    expect(summon(990105, [89631139, 89631139])).toBeTruthy();
    expect(summon(990105, [89631139, 46986414])).toBeUndefined();
  });

  it("solves exact Synchro levels with separate Tuner and non-Tuner copies", () => {
    expect(summon(44508094, [97268402, 46986414])).toMatch(/8/);
    expect(summon(44508094, [97268402, 89631139])).toBeUndefined();
    expect(summon(44508094, [97268402, 97268402, 97268402, 97268402, 97268402, 97268402, 97268402, 97268402])).toBeUndefined();
    expect(summon(59822133, [71039903, 89631139])).toBeTruthy();
    expect(summon(59822133, [97268402, 68468459, 68468459])).toBeUndefined();
    expect(summon(40908371, [71039903, 89631139])).toBeTruthy();
    expect(summon(40908371, [97268402, 68468459, 68468459])).toBeUndefined();
    expect(summon(990106, [97268402, 46986414])).toBeTruthy();
    expect(summon(990106, [71039903, 46986414])).toBeUndefined();
    expect(summon(990108, [97268402, 71039903, 68468459])).toBeTruthy();
    expect(summon(990108, [97268402, 68468459])).toBeUndefined();
    expect(summon(990109, [97268402, 7084129, 68468459])).toBeTruthy();
    expect(summon(990109, [97268402, 46986414])).toBeUndefined();
  });

  it("requires named Fusion copies and a compatible Fusion effect in the Main Deck", () => {
    expect(summon(2129638, [89631139, 89631139])).toBeUndefined();
    expect(summon(2129638, [89631139, 24094653])).toBeUndefined();
    expect(summon(2129638, [89631139, 89631139, 24094653])).toBeTruthy();
    expect(summon(23995346, [89631139, 89631139, 24094653])).toBeUndefined();
    expect(summon(23995346, [89631139, 89631139, 89631139, 24094653])).toBeTruthy();
    expect(summon(2129638, [89631139, 89631139, 15839054])).toBeUndefined();
    expect(summon(2129638, [89631139, 89631139, 44362883])).toBeUndefined();
    expect(summon(70534340, [68468459, 46986414, 44362883])).toBeTruthy();
    expect(summon(70534340, [68468459, 44362883])).toBeUndefined();
    expect(summon(44146295, [68468459, 44508094, 44362883])).toBeUndefined();
    const contact = candidate(2129638);
    contact.card.text = '"Blue-Eyes White Dragon" + "Blue-Eyes White Dragon"\nMust be either Fusion Summoned, or Special Summoned by sending the above monsters you control to the GY (in which case you do not use "Polymerization").';
    expect(canSummonFromMain(contact, [candidate(89631139), candidate(89631139)])).toBeTruthy();
    expect(canSummonFromMain(contact, [candidate(89631139)])).toBeUndefined();
    contact.card.text += " Cannot be Special Summoned unless you control a Spellcaster monster.";
    expect(canSummonFromMain(contact, [candidate(89631139), candidate(89631139)])).toBeUndefined();
  });

  it("satisfies Link rating, material count, type, effect, name and different-name restrictions", () => {
    expect(summon(24361622, [89631139])).toBeUndefined();
    expect(summon(24361622, [89631139, 89631139])).toBeTruthy();
    expect(summon(24361622, [89631139, 46986414])).toBeUndefined();
    expect(summon(65741786, [89631139, 46986414])).toBeTruthy();
    expect(summon(29301450, [89631139, 46986414])).toBeUndefined();
    expect(summon(29301450, [7084129, 68468459])).toBeTruthy();
    expect(summon(990101, [46986414, 89631139])).toBeTruthy();
    expect(summon(990101, [89631139, 89631139])).toBeUndefined();
    expect(summon(990104, [7084129, 68468459, 97268402, 71039903])).toBeUndefined();
    expect(summon(4280258, [7084129, 68468459])).toBeUndefined();
    expect(summon(4280258, [7084129, 68468459, 97268402, 71039903])).toBeTruthy();
    expect(summon(4280258, [7084129, 68468459, 97268402, 97268402])).toBeUndefined();
    expect(summon(65741786, [59011257, 68468459])).toBeUndefined();
  });

  it("fails closed when either the recipe or tagged material restriction is unknown", () => {
    expect(summon(990102, [89631139, 89631139])).toBeUndefined();
    expect(summon(990103, [89631139, 89631139])).toBeUndefined();
    expect(summon(990107, [89631139, 89631139])).toBeUndefined();
    expect(summon(2129638, [89631139, 89631139, 990110])).toBeUndefined();
  });
});
