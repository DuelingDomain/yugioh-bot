// Spell and Trap cards whose effect Special Summons a card or tokens to the field of an opponent (the table and the rule are in
// opponent-field-effects.ts). Every card of this file is activated by p0, who then picks one opponent.

import { activate, choose, select, yes } from "../../support/dsl.js";
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
];

export const SPELL_EFFECT_SCENARIOS = SPECS.flatMap(effectScenarios);
