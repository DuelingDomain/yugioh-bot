import {
  activate, expectBoard, expectNotOffered, expectOffered, expectPickOptions, expectPrompt, faceDown, pass, select, specialSummon, yes,
  type DuelistExpect, type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";
import { label, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

// An Extra Deck monster as Deck Master leaves its zone only by its own summon mechanic (rulebook v1.4, summoning from the DMZ):
// Synchro, Xyz and Fusion (through a Fusion Spell) here; the Link Deck Master is in domain-link-zone.ts. A Normal Summon or Set is never
// offered, a generic "Special Summon from the Extra Deck" effect (Waking the Dragon) cannot pick it, and every return adds 500 LP.
const MASTERS: Record<Seat, string> = { p0: "Axe Raider", p1: "Celtic Guardian", p2: "Battle Ox", p3: "Giant Soldier of Stone" };
const REMOVE = "Tribute to The Doomed";
const FODDER = "Mystical Elf";
const FORMATS: Format[] = ["ffa3", "ffa4", "tag"];
const ACTORS: Record<Format, Seat[]> = { ffa3: ["p0", "p2"], ffa4: ["p0", "p3"], tag: ["p2", "p3"] };

interface Kind {
  name: string;
  master: string;
  /** The way out of the zone: the Deck Master itself is offered (a procedure), or a Fusion Spell is. */
  spell?: string;
  /** Two sets of materials: one for each summon. */
  materials: [string[], string[]];
  card: number;
}

const KINDS: Kind[] = [
  { name: "synchro", master: "Stardust Dragon", materials: [["The Magical King of Dimension Zeta", "Axe Raider"], ["Flamvell Guard", "Dark Magician"]], card: 44508094 },
  { name: "xyz", master: "Number 39: Utopia", materials: [["Celtic Guardian", "Axe Raider"], ["Battle Ox", "Beaver Warrior"]], card: 84013237 },
  { name: "fusion", master: "Gaia the Dragon Champion", spell: "Polymerization", materials: [["Gaia The Fierce Knight", "Curse of Dragon"], ["Gaia The Fierce Knight", "Curse of Dragon"]], card: 66889139 },
];

function others(format: Format, actor: Seat): Partial<Record<Seat, DuelistExpect>> {
  return Object.fromEntries(SEATS[format].filter((seat) => seat !== actor).map((seat) => [seat, { deckMaster: { inZone: true, returns: 0, nextCost: 0 } }]));
}

function setupFor(format: Format, actor: Seat, kind: Kind, extra: object): Scenario["setup"] {
  const setup: Scenario["setup"] = { mode: "domain", format };
  for (const seat of SEATS[format]) setup[seat] = { deckMaster: seat === actor ? kind.master : MASTERS[seat], ...(seat === actor ? extra : {}) };
  return setup;
}

/** Both sets of materials sit on the field; the Fusion Spell comes from the hand, one copy for each summon. */
function fieldFor(kind: Kind): object {
  const hand = [REMOVE, FODDER, ...(kind.spell ? [kind.spell, kind.spell] : [])];
  return { monsters: [...kind.materials[0], ...kind.materials[1]], hand };
}

function summonSteps(format: Format, actor: Seat, kind: Kind, set: number): Step[] {
  const materials = kind.materials[set].map((card) => ({ card, owner: actor as DuelistId, nth: 0 }));
  return kind.spell
    ? [activate({ card: kind.spell, nth: 0 }, actor), { op: "select", sels: materials, by: actor }]
    : [specialSummon({ card: kind.master, from: "dmz" }, actor), { op: "select", sels: materials, by: actor }];
}

function offering(kind: Kind, actor: Seat): Step[] {
  return [
    expectNotOffered("normalSummon", { card: kind.master, from: "dmz" }, actor),
    expectNotOffered("set", { card: kind.master, from: "dmz" }, actor),
    ...(kind.spell
      ? [expectNotOffered("specialSummon", { card: kind.master, from: "dmz" }, actor), expectOffered("activate", { card: kind.spell, nth: 0 }, actor)]
      : [expectOffered("specialSummon", { card: kind.master, from: "dmz" }, actor)]),
  ];
}

function tax(format: Format, actor: Seat, kind: Kind): Scenario {
  const base = format === "tag" ? 16000 : 8000;
  const first = kind.materials[0], second = kind.materials[1];
  const out = (returns: number) => ({ inZone: false, returns, nextCost: returns * 500 });
  const mine = (monsters: string[], lp: number, deckMaster: object): Step => expectBoard({ [actor]: { lp, monsters, deckMaster } });
  return defineScenario({
    id: `domain-${format}-extra-master-${kind.name}-tax-${actor}`,
    title: `Domain ${label(format)}: ${actor} brings its ${kind.name} Deck Master out of its zone (free), loses it, recalls it and pays 500 LP for the second ${kind.name} summon`,
    source: `${SOURCE} [R-COMMON-SEP-FIELDS]: an Extra Deck Deck Master leaves its zone only by its own summon mechanic; the first leave is free, each return adds 500 LP`,
    rules: ["R-COMMON-SEP-FIELDS", ...(format === "tag" ? ["R-TAG-LP"] : ["R-FFA-LP"])],
    tags: ["multiplayer", "domain", "deck-master", "extra-deck", kind.name, "lp-cost", format, `card:${kind.card}`],
    setup: setupFor(format, actor, kind, fieldFor(kind)),
    steps: [
      ...turnsBefore(format, actor),
      ...offering(kind, actor),
      ...summonSteps(format, actor, kind, 0),
      mine([kind.master, ...second], base, out(0)),
      activate({ card: REMOVE, nth: 0 }, actor),
      { op: "select", sels: [{ card: FODDER, owner: actor, from: "hand" }], by: actor },
      { op: "select", sels: [{ card: kind.master, owner: actor }], by: actor },
      // Stardust Dragon may answer the destruction with its own Quick Effect. The Deck Master lets it go.
      ...(kind.name === "synchro" ? [pass(actor)] : []),
      expectPrompt({ by: actor, context: "deck-master-recall" }),
      yes(actor),
      mine(second, base, { inZone: true, returns: 1, nextCost: 500 }),
      ...offering(kind, actor),
      ...summonSteps(format, actor, kind, 1),
      mine([kind.master], base - 500, out(1)),
      expectBoard({ ...Object.fromEntries(Object.entries(others(format, actor)).map(([seat, expect]) => [seat, { ...expect, monsters: [] }])), [actor]: { lp: base - 500, monsters: [kind.master], deckMaster: out(1) } }),
    ],
  });
}

function waking(format: Format, owner: Seat): Scenario {
  // The opponent of the owner who destroys the Set Waking the Dragon is the next seat in turn order.
  const order = SEATS[format];
  const attacker = order[(order.indexOf(owner) + 1) % order.length];
  const setup: Scenario["setup"] = { mode: "domain", format };
  for (const seat of order) setup[seat] = { deckMaster: MASTERS[seat] };
  setup[owner] = { deckMaster: "Stardust Dragon", spells: [faceDown("Waking the Dragon")], deck: [FODDER] };
  setup[attacker] = { deckMaster: MASTERS[attacker], hand: ["Mystical Space Typhoon"] };
  return defineScenario({
    id: `domain-${format}-waking-the-dragon-skips-extra-master-${owner}`,
    title: `Domain ${label(format)}: Waking the Dragon of ${owner} cannot pick its Synchro Deck Master from the zone, only cards of the Deck and the Extra Deck`,
    source: `${SOURCE} [R-COMMON-SEP-FIELDS]: a generic Special Summon from the Deck or Extra Deck is not a proper summon of the Deck Master`,
    rules: ["R-COMMON-SEP-FIELDS"],
    tags: ["multiplayer", "domain", "deck-master", "extra-deck", "synchro", format, "card:10813327"],
    setup,
    steps: [
      ...turnsBefore(format, attacker),
      activate("Mystical Space Typhoon", attacker),
      expectPrompt({ by: owner, kind: "choice", title: "Waking the Dragon" }),
      yes(owner),
      expectPickOptions({ include: [{ card: FODDER }], exclude: [{ card: "Stardust Dragon" }] }, owner),
      select(FODDER),
      expectBoard({ [owner]: { deckMaster: { inZone: true, returns: 0, nextCost: 0 } } }),
    ],
  });
}

export const DOMAIN_EXTRA_DM_SUMMON_SCENARIOS: Scenario[] = [];
for (const format of FORMATS) {
  for (const actor of ACTORS[format]) for (const kind of KINDS) DOMAIN_EXTRA_DM_SUMMON_SCENARIOS.push(tax(format, actor, kind));
  DOMAIN_EXTRA_DM_SUMMON_SCENARIOS.push(waking(format, ACTORS[format][1]));
}
