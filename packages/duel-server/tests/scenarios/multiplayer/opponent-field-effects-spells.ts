// Spell and Trap cards whose effect Special Summons a card or tokens to the field of an opponent (the table and the rule are in
// opponent-field-effects.ts). Every card of this file is activated by p0, who then picks one opponent.

import { activate, attack, choose, expectNoPrompt, no, normalSummon, pickOpponent, select, yes } from "../../support/dsl.js";
import { ELF } from "./nseat-scenarios.js";
import { effectScenarios, type EffectSpec } from "./opponent-field-effects.js";

const set = (card: string) => ({ card, pos: "set" as const });
const SKULL = "Summoned Skull";
const MAGICIAN = "Dark Magician";

const SPECS: EffectSpec[] = [
  {
    code: 29843091, name: "Ojama Trio", slug: "ojama-trio", does: "Special Summons 3 Ojama Tokens",
    p0: { spells: [set("Ojama Trio")] },
    steps: [activate("Ojama Trio", "p0")],
    p0End: { grave: ["Ojama Trio"] },
    gain: { tokens: { card: "Ojama Token", count: 3 } },
  },
  {
    code: 14470845, name: "Ojama Duo", slug: "ojama-duo", does: "Special Summons 2 Ojama Tokens",
    p0: { spells: [set("Ojama Duo")] },
    steps: [activate("Ojama Duo", "p0")],
    p0End: { grave: ["Ojama Duo"] },
    gain: { tokens: { count: 2 } },
  },
  {
    code: 28062325, name: "Bamboo Scrap", slug: "bamboo-scrap", does: "Tributes a Plant of p0 and Special Summons 2 Plant Tokens",
    p0: { monsters: ["Dark Plant"], spells: [set("Bamboo Scrap")] },
    steps: [activate("Bamboo Scrap", "p0")],
    p0End: { grave: ["Dark Plant", "Bamboo Scrap"] },
    gain: { tokens: { card: "Plant Token", count: 2 } },
  },
  {
    code: 42956963, name: "Nightmare Archfiends", slug: "nightmare-archfiends", does: "Tributes a monster of p0 and Special Summons 3 Nightmare Archfiend Tokens",
    p0: { monsters: [ELF], spells: [set("Nightmare Archfiends")] },
    steps: [activate("Nightmare Archfiends", "p0")],
    // In Tag the Tribute cost may take the monster of the partner (R-TAG-PARTNER-COST): the choice is shown, p0 pays with its own Elf.
    then: (roles) => (roles.partner ? [select(ELF)] : []),
    p0End: { grave: [ELF, "Nightmare Archfiends"] },
    gain: { tokens: { card: "Nightmare Archfiend Token", count: 3 } },
  },
  {
    code: 11654067, name: "Fire Ejection", slug: "fire-ejection", does: "sends a Volcanic monster from the Deck and Special Summons a Bomb Token",
    p0: { hand: ["Fire Ejection"], deck: ["Volcanic Rat"] },
    steps: [activate("Fire Ejection", "p0")],
    then: [yes("p0"), choose("token", "p0")],
    p0End: { grave: ["Fire Ejection", "Volcanic Rat"] },
    gain: { monsters: ["Bomb Token"] },
  },
  {
    code: 83778600, name: "Foolish Revival", slug: "foolish-revival", does: "Special Summons the Summoned Skull of the Graveyard of p1",
    p0: { spells: [set("Foolish Revival")] },
    opp: {},
    seats: { p1: { grave: [SKULL] }, p2: { grave: [MAGICIAN] }, p3: { grave: [MAGICIAN] } },
    steps: [activate("Foolish Revival", "p0")],
    then: [select({ card: SKULL, owner: "p1" })],
    p0End: { grave: ["Foolish Revival"] },
    gain: { monsters: [SKULL] },
    seatEnd: { p1: {} },
  },
  {
    code: 55465441, name: "Give and Take", slug: "give-and-take", does: "Special Summons the Dark Magician of the Graveyard of p0",
    p0: { monsters: [ELF], spells: [set("Give and Take")], grave: [MAGICIAN] },
    steps: [activate("Give and Take", "p0")],
    // In Tag the partner monster is also a face-up card that p0 "controls": the target prompt offers it too.
    then: (roles) => (roles.partner ? [select(ELF)] : []),
    p0End: { monsters: [ELF], grave: ["Give and Take"] },
    gain: { monsters: [MAGICIAN] },
  },
  {
    code: 93775296, name: "Reverse Reuse", slug: "reverse-reuse", does: "Special Summons the Flip monster of the Graveyard of p0",
    p0: { spells: [set("Reverse Reuse")], grave: ["Man-Eater Bug"] },
    steps: [activate("Reverse Reuse", "p0")],
    p0End: { grave: ["Reverse Reuse"] },
    gain: { monsters: ["Man-Eater Bug"] },
  },
  {
    code: 93912845, name: "Revival Gift", slug: "revival-gift", does: "Special Summons a Tuner of p0 to the own field and 2 tokens",
    p0: { spells: [set("Revival Gift")], grave: ["Water Spirit"] },
    steps: [activate("Revival Gift", "p0")],
    p0End: { monsters: ["Water Spirit"], grave: ["Revival Gift"] },
    gain: { tokens: { count: 2 } },
  },
  {
    code: 76384284, name: "Trojan Gladiator Beast", slug: "trojan-gladiator-beast", does: "Special Summons a Gladiator Beast from the hand of p0",
    p0: { spells: [set("Trojan Gladiator Beast")], hand: ["Gladiator Beast Retiari"] },
    steps: [activate("Trojan Gladiator Beast", "p0")],
    p0End: { grave: ["Trojan Gladiator Beast"], hand: [ELF] },
    gain: { monsters: ["Gladiator Beast Retiari"] },
  },
  {
    // The target is every opponent's banished monster (R-COMMON-OPP-FIELD): p0 takes the Blue-Eyes of p1, the monster of p0 goes to the picked opponent only.
    code: 73355951, name: "Alpha Summon", slug: "alpha-summon", does: "Special Summons the banished Dark Magician of p0 and takes a banished monster of an opponent to the own field",
    p0: { spells: [set("Alpha Summon")], banished: [MAGICIAN] },
    tgt: { monsters: [ELF], banished: [SKULL] },
    seats: { p1: { monsters: [ELF], banished: ["Blue-Eyes White Dragon"] } },
    steps: [activate("Alpha Summon", "p0")],
    then: [select(MAGICIAN, { card: "Blue-Eyes White Dragon", owner: "p1" })],
    p0End: { monsters: ["Blue-Eyes White Dragon"], grave: ["Alpha Summon"] },
    tgtEnd: { monsters: [ELF, MAGICIAN], banished: [SKULL] },
    seatEnd: { p1: { monsters: [ELF] } },
  },
  {
    code: 6203182, name: "Two Toads with One Sting", slug: "two-toads-with-one-sting", does: "Special Summons the Dark Magician of the Graveyard of the opponent and equips itself to it",
    p0: { hand: ["Two Toads with One Sting"] },
    tgt: { monsters: [ELF], grave: [MAGICIAN] },
    steps: [activate("Two Toads with One Sting", "p0")],
    p0End: { spells: ["Two Toads with One Sting"] },
    tgtEnd: { monsters: [ELF, MAGICIAN] },
  },
  {
    code: 33970665, name: "Guts of Steel", slug: "guts-of-steel", does: "Special Summons the Scrap monster that the picked opponent chooses",
    p0: { spells: [set("Guts of Steel")], grave: ["Scrap Chimera", "Scrap Hunter", "Scrap Breaker"] },
    steps: [activate("Guts of Steel", "p0")],
    // The picked opponent chooses the card (as in 1v1); p0 then chooses the field. The 2 other Scrap monsters are banished.
    then: [select("Scrap Chimera"), choose("opponent's field", "p0")],
    p0End: { grave: ["Guts of Steel"], banished: ["Scrap Hunter", "Scrap Breaker"] },
    gain: { monsters: ["Scrap Chimera"] },
  },
  {
    code: 17228908, name: "Lost World", slug: "lost-world", does: "Special Summons a Jurraegg Token after a Dinosaur is summoned",
    p0: { field: "Lost World", hand: ["Uraby"] },
    steps: [normalSummon("Uraby", "p0"), yes("p0")],
    p0End: { monsters: ["Uraby"], spells: ["Lost World"] },
    gain: { monsters: ["Jurraegg Token"] },
  },
  {
    code: 78610936, name: "Xyz Encore", slug: "xyz-encore", does: "returns the Xyz monster to the Extra Deck and Special Summons its material",
    p0: { hand: ["Xyz Encore"] },
    tgt: { monsters: [{ card: "Daigusto Emeral", materials: [ELF] }] },
    steps: [activate("Xyz Encore", "p0")],
    p0End: { grave: ["Xyz Encore"] },
    tgtEnd: { monsters: [ELF] },
  },
  {
    code: 36890111, name: "Mansion of the Dreadful Dolls", slug: "mansion-of-the-dreadful-dolls", does: "detaches a material and Special Summons a Gimmick Puppet of p0",
    p0: { field: "Mansion of the Dreadful Dolls", monsters: [{ card: "Daigusto Emeral", materials: [ELF] }], grave: ["Gimmick Puppet Cattle Scream"] },
    steps: [activate("Mansion of the Dreadful Dolls", "p0")],
    p0End: { monsters: ["Daigusto Emeral"], spells: ["Mansion of the Dreadful Dolls"], grave: [ELF] },
    gain: { monsters: ["Gimmick Puppet Cattle Scream"] },
  },
  {
    code: 62767644, name: "Inferno of the Ashened", slug: "inferno-of-the-ashened", does: "sends a card of an opponent to the Graveyard and Special Summons a Pyro monster of p0",
    p0: { spells: [{ card: "Inferno of the Ashened", pos: "up" }], grave: ["King of the Ashened City"] },
    steps: [activate("Inferno of the Ashened", "p0")],
    // The card to send can be of any opponent (R-COMMON-OPP-FIELD): p0 sends the Mystical Elf of p1, the Pyro monster goes to the picked opponent only.
    then: [select({ card: ELF, owner: "p1" })],
    p0End: { spells: ["Inferno of the Ashened"] },
    gain: { monsters: ["King of the Ashened City"] },
    seatEnd: { p1: { grave: [ELF] } },
  },
  {
    code: 80044027, name: "Mikanko Fire Dance", slug: "mikanko-fire-dance", does: "Special Summons a Mikanko to the own field and a monster of the Graveyard of an opponent",
    p0: { hand: ["Mikanko Fire Dance", "Sanaki the Mikanko Devotee"] },
    tgt: { monsters: [ELF], grave: [MAGICIAN] },
    steps: [activate("Mikanko Fire Dance", "p0")],
    then: [yes("p0")],
    p0End: { monsters: ["Sanaki the Mikanko Devotee"], spells: ["Mikanko Fire Dance"] },
    tgtEnd: { monsters: [ELF, MAGICIAN] },
  },
  {
    code: 99330325, name: "Interrupted Kaiju Slumber", slug: "interrupted-kaiju-slumber", does: "destroys all monsters and Special Summons a Kaiju to the own field and a Kaiju",
    p0: { hand: ["Interrupted Kaiju Slumber"], deck: ["Gameciel, the Sea Turtle Kaiju", "Dogoran, the Mad Flame Kaiju"] },
    steps: [activate("Interrupted Kaiju Slumber", "p0")],
    // All monsters are destroyed (every opponent and the Tag partner too, R-COMMON-ALL-BOTH). p0 chooses the Kaiju for the own field, the other goes to the picked opponent.
    then: [select("Gameciel, the Sea Turtle Kaiju")],
    p0End: { monsters: ["Gameciel, the Sea Turtle Kaiju"], grave: ["Interrupted Kaiju Slumber"] },
    tgtEnd: { monsters: ["Dogoran, the Mad Flame Kaiju"], grave: [ELF] },
    othersEnd: { grave: [ELF] },
    partnerEnd: { grave: ["Battle Ox"] },
  },
  {
    code: 52782439, name: "Exceptional Schedule", slug: "exceptional-schedule", does: "adds a Schedule card to the hand and Special Summons a Schedule Token",
    p0: { hand: ["Exceptional Schedule"], deck: ["Special Schedule"] },
    steps: [activate("Exceptional Schedule", "p0")],
    then: [yes("p0")],
    p0End: { grave: ["Exceptional Schedule"], hand: ["Special Schedule"] },
    gain: { tokens: { count: 1 } },
  },
  {
    code: 72554664, name: "Light of the Branded", slug: "light-of-the-branded", does: "returns a Fusion monster and Special Summons Fallen of Albaz to the own field and a monster of the Graveyard of an opponent",
    p0: { hand: ["Light of the Branded"], monsters: ["Thousand-Eyes Restrict"], grave: ["Fallen of Albaz"] },
    tgt: { monsters: [ELF], grave: [MAGICIAN] },
    steps: [activate("Light of the Branded", "p0")],
    then: [yes("p0")],
    p0End: { grave: ["Light of the Branded"], monsters: ["Fallen of Albaz"] },
    tgtEnd: { monsters: [ELF, MAGICIAN] },
  },
  {
    code: 63086455, name: "Terrors of the Overroot", slug: "terrors-of-the-overroot", does: "sends a card of an opponent to the Graveyard and Sets a monster of an opponent Graveyard",
    p0: { spells: [set("Terrors of the Overroot")] },
    tgt: { monsters: [ELF], grave: [MAGICIAN] },
    steps: [activate("Terrors of the Overroot", "p0")],
    // The targets are the Elf of p1 (field) and the Dark Magician in the Graveyard of the picked opponent: targets may be of any opponent (R-COMMON-OPP-FIELD); the card is Set on the field of the picked opponent.
    then: [select({ card: ELF, owner: "p1" }, MAGICIAN)],
    p0End: { grave: ["Terrors of the Overroot"] },
    tgtEnd: { monsters: [ELF, MAGICIAN] },
    seatEnd: { p1: { grave: [ELF] } },
  },
  {
    code: 85698115, name: "Terrors of the Afterroot", slug: "terrors-of-the-afterroot", does: "Special Summons a monster of an opponent Graveyard",
    p0: { spells: [set("Terrors of the Afterroot")] },
    tgt: { monsters: [ELF], grave: [MAGICIAN] },
    steps: [activate("Terrors of the Afterroot", "p0")],
    then: [no("p0")],
    p0End: { grave: ["Terrors of the Afterroot"] },
    tgtEnd: { monsters: [ELF, MAGICIAN] },
  },
  {
    code: 13204145, name: "Mimighoul Maker", slug: "mimighoul-maker", does: "Special Summons a face-down flip monster",
    p0: { hand: ["Mimighoul Maker"], deck: ["Man-Eater Bug", "Hane-Hane"] },
    steps: [activate("Mimighoul Maker", "p0")],
    // The picked opponent chooses at random which of the 2 flip monsters is Special Summoned face-down to its field; p0 adds the other to its hand.
    then: [select("Man-Eater Bug", "Hane-Hane")],
    p0End: { grave: ["Mimighoul Maker"] },
    gain: { tokens: { count: 1 } },
  },
  {
    code: 13935001, name: "Lunalight Serenade Dance", slug: "lunalight-serenade-dance", does: "Special Summons a Lunalight Token",
    p0: { hand: ["Polymerization", "Gaia The Fierce Knight", "Curse of Dragon"], spells: [{ card: "Lunalight Serenade Dance", pos: "up" }], extra: ["Gaia the Dragon Champion"] },
    steps: [activate("Polymerization", "p0"), select("Gaia The Fierce Knight", "Curse of Dragon"), yes("p0")],
    p0End: { monsters: ["Gaia the Dragon Champion"], spells: ["Lunalight Serenade Dance"], grave: ["Polymerization", "Gaia The Fierce Knight", "Curse of Dragon"] },
    gain: { tokens: { count: 1 } },
  },
  {
    code: 1041278, name: "Branded Expulsion", slug: "branded-expulsion", does: "Tributes a Fusion monster and Special Summons a monster to the own field and one to the field of an opponent",
    p0: { monsters: ["Gaia the Dragon Champion"], spells: [set("Branded Expulsion")], grave: [MAGICIAN] },
    tgt: { monsters: [ELF], grave: [SKULL] },
    steps: [activate("Branded Expulsion", "p0")],
    // p0 picks the 2 monsters, then which of them goes to the own field; the other goes to the field of the picked opponent.
    then: [select(MAGICIAN, SKULL), select(MAGICIAN)],
    p0End: { monsters: [MAGICIAN], grave: ["Branded Expulsion", "Gaia the Dragon Champion"] },
    tgtEnd: { monsters: [ELF, SKULL] },
  },
  {
    code: 8837932, name: "Cubic Mandala", slug: "cubic-mandala", does: "Special Summons a destroyed monster",
    p0: { hand: ["Raigeki"], monsters: ["Vijam the Cubic Seed"], spells: [set("Cubic Mandala")] },
    steps: [activate("Raigeki", "p0"), activate("Cubic Mandala", "p0")],
    // Raigeki sends the Elf of every opponent to the Graveyard (not the Tag partner). The Elf of p1 is the target; it comes to the field of the picked opponent.
    then: [select({ card: ELF, owner: "p1" })],
    p0End: { monsters: ["Vijam the Cubic Seed"], spells: ["Cubic Mandala"], grave: ["Raigeki"] },
    tgtEnd: { monsters: [ELF], grave: [ELF] },
    othersEnd: { grave: [ELF] },
    seatEnd: { p1: {} },
  },
  {
    code: 96857854, name: "Diamond Duston", slug: "diamond-duston", does: "Special Summons a Duston monster",
    p0: { hand: ["Smashing Ground"], spells: [set("Diamond Duston")], deck: ["House Duston"] },
    tgt: { monsters: [MAGICIAN] },
    // Smashing Ground destroys the Dark Magician (highest DEF) of the picked-later opponent; Diamond Duston answers the destruction.
    steps: [activate("Smashing Ground", "p0"), activate("Diamond Duston", "p0")],
    then: [yes("p0")],
    p0End: { grave: ["Smashing Ground", "Diamond Duston"] },
    tgtEnd: { monsters: ["House Duston"], grave: [MAGICIAN] },
  },
  {
    code: 93983867, name: "Trick Box", slug: "trick-box", does: "takes control of a monster until the End Phase and Special Summons a Performage from the own Graveyard",
    p0: { hand: ["Offerings to the Doomed"], monsters: ["Performage Hat Tricker"], spells: [set("Trick Box")] },
    steps: [activate("Offerings to the Doomed", "p0"), select("Performage Hat Tricker"), activate("Trick Box", "p0"), select({ card: ELF, owner: "p1" })],
    p0End: { monsters: [ELF], grave: ["Offerings to the Doomed", "Trick Box"] },
    gain: { monsters: ["Performage Hat Tricker"] },
    seatEnd: { p1: {} },
  },
  {
    code: 14283055, name: "Concours de Cuisine", slug: "concours-de-cuisine", does: "Special Summons a Nouvelles and a Patissciel Pendulum monster, one to the own field and one to the field of an opponent",
    p0: { hand: ["Concours de Cuisine (Culinary Confrontation)"], deck: ["Chef de Nouvelles"], extra: ["Patissciel Couverture"] },
    steps: [activate("Concours de Cuisine (Culinary Confrontation)", "p0")],
    then: [select("Chef de Nouvelles", "Patissciel Couverture"), select("Chef de Nouvelles")],
    p0End: { monsters: ["Chef de Nouvelles"], grave: ["Concours de Cuisine (Culinary Confrontation)"] },
    gain: { monsters: ["Patissciel Couverture"] },
  },
];

// Graydle Parasite: the Graydle monster of p0 attacks the picked opponent directly and its trigger Special Summons the monster of an opponent
// Graveyard to the field of a picked opponent (a second pick, after the pick of the attack). Both picks name the same seat; the monster in that
// field turns the direct attack into a replay, so no seat takes damage.
const GRAYDLE_PARASITE: EffectSpec = {
  code: 49966595, name: "Graydle Parasite", slug: "graydle-parasite", does: "Special Summons a monster of an opponent Graveyard",
  attackFirstTurn: true,
  p0: { monsters: ["Graydle Cobra"], spells: [{ card: "Graydle Parasite", pos: "up" }] },
  opp: {},
  tgt: { grave: [MAGICIAN] },
  partner: {},
  steps: (roles) => [attack("Graydle Cobra", "direct", "p0"), pickOpponent(roles.tgt, "p0"), yes("p0")],
  p0End: { monsters: ["Graydle Cobra"], spells: ["Graydle Parasite"] },
  tgtEnd: { monsters: [MAGICIAN] },
};

export const SPELL_EFFECT_SCENARIOS = [...SPECS, GRAYDLE_PARASITE].flatMap(effectScenarios);
