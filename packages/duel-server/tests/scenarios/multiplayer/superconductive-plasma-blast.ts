// Superconductive Plasma Blast (51869363): an opponent-turn activation may
// search the holder's Deck only after a monster was destroyed this turn.
// The own-turn branch puts a Rock on top and can destroy any field card.
import { activate, defineScenario, endTurn, expectOffered, expectPrompt, faceDown, normalSummon, pass, select, setCard, yes, type DuelistExpect, type Scenario } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseSetup, everySeat, label, PARTNER, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const CARD = "Superconductive Plasma Blast";
const ROCK = "Giant Soldier of Stone";
const OTHER_ROCK = "Rock Ogre Grotto #1";
const ELF = "Mystical Elf";
const RAID = "Raigeki";
const MST = "Mystical Space Typhoon";
const SUPPLY = "Supply Squad";
const VOID = "Into the Void";

function search(format: Format, holder: Seat, monsterDied: boolean): Scenario {
  const spec: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: [], deckCount: 20 };
  spec.p0 = { ...spec.p0, grave: [monsterDied ? RAID : MST] };
  spec.p1 = { ...spec.p1, grave: [monsterDied ? ELF : SUPPLY] };
  spec[holder] = { ...spec[holder], ...(monsterDied ? { hand: [ROCK], deckCount: 19, grave: [CARD] } : { spells: [CARD] }) };
  return defineScenario({
    id: `superconductive-plasma-blast-${format}-${holder}-${monsterDied ? "monster-destroyed-searches-own-deck" : "only-spell-destroyed-stays-set"}`,
    title: `${label(format)}: ${holder} ${monsterDied ? "searches its own Deck after a monster dies" : "cannot search its Deck after only a Spell dies"}`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the global monster destruction flag reaches every seat and each Tag team`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, "card:51869363"],
    setup: baseSetup(format, {
      p0: { hand: [monsterDied ? RAID : MST] },
      p1: monsterDied ? { monsters: [ELF] } : { spells: [SUPPLY] },
      [holder]: { spells: [faceDown(CARD)], deck: [ROCK, OTHER_ROCK] },
    }),
    steps: [
      activate(monsterDied ? RAID : MST, "p0"),
      ...(monsterDied ? [activate(CARD, holder), select({ card: ROCK, owner: holder, from: "deck" })] : [select({ card: SUPPLY, owner: "p1" })]),
      expectPrompt({ by: "p0", context: "action" }),
      everySeat(format, spec),
    ],
  });
}

function ownTurn(format: Format, actor: Seat = "p0"): Scenario {
  const victim: Seat = format === "tag" ? PARTNER[actor] : "p1";
  const actorIndex = SEATS[format].indexOf(actor);
  const spec: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) {
    const drew = seat !== "p0" && SEATS[format].indexOf(seat) <= actorIndex;
    spec[seat] = { hand: drew ? [ELF] : [], deckCount: drew ? 19 : 20 };
  }
  spec[actor] = { ...spec[actor], monsters: [ROCK], grave: [CARD, VOID], hand: [...Array.from({ length: actor === "p0" ? 2 : 3 }, () => ELF), ROCK], deckCount: actor === "p0" ? 19 : 18 };
  spec[victim] = { ...spec[victim], grave: [ELF] };
  return defineScenario({
    id: `superconductive-plasma-blast-${format}-${actor}-own-turn-stacks-rock-and-destroys-${victim}-monster`,
    title: `${label(format)}: ${actor} puts a Rock on its Deck and destroys the monster of ${victim}`,
    source: `${SOURCE} [R-COMMON-ALL-BOTH] the optional destruction can choose a card of any seat, including the Tag partner`,
    rules: ["R-COMMON-ALL-BOTH"],
    tags: ["multiplayer", "global-effect", format, "card:51869363"],
    setup: baseSetup(format, { [actor]: { monsters: actor === "p0" ? [ROCK] : [], spells: [faceDown(CARD)], deck: [...(actor === "p0" ? [] : [ELF]), ROCK, OTHER_ROCK], hand: [VOID, ELF, ELF, ...(actor === "p0" ? [] : [ROCK])] }, [victim]: { monsters: [ELF] } }),
    steps: [...turnsBefore(format, actor), ...(actor === "p0" ? [] : [pass(actor), pass(actor), pass(actor), normalSummon(ROCK, actor)]), activate(CARD, actor), select({ card: ROCK, owner: actor, from: "deck" }), yes(actor), select({ card: ELF, owner: victim }), activate(VOID, actor), expectPrompt({ by: actor, context: "action" }), everySeat(format, spec)],
  });
}

function reset(): Scenario {
  const first = search("ffa3", "p2", true);
  return defineScenario({
    ...first,
    id: "superconductive-plasma-blast-ffa3-p2-destruction-flag-clears-next-turn",
    title: "FFA3: Plasma Blast can search after destruction but cannot search in the next turn",
    steps: [
      activate(RAID, "p0"), expectOffered("activate", CARD, "p2"), pass("p2"), endTurn("p0"), pass("p2"), pass("p2"),
      expectPrompt({ by: "p1", context: "action" }),
      everySeat("ffa3", {
        p0: { hand: [], deckCount: 20, grave: [RAID] },
        p1: { hand: [ELF], deckCount: 19, grave: [ELF] },
        p2: { hand: [], deckCount: 20, spells: [CARD] },
      }),
    ],
  });
}

function exchanged(format: "ffa3" | "tag"): Scenario {
  const holder: Seat = format === "tag" ? "p3" : "p2";
  const spec: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: [ELF, ELF], deckCount: 18 };
  spec.p0 = { hand: [ELF, ELF], deckCount: 19, grave: ["Exchange", CARD] };
  spec[holder] = { hand: [ELF, ELF, ROCK], deckCount: 17, grave: [VOID] };
  return defineScenario({
    id: `superconductive-plasma-blast-${format}-${holder}-exchanged-card-uses-current-holder-turn`,
    title: `${label(format)}: ${holder} uses the own-turn branch of Plasma Blast received from p0 by Exchange`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the current holder decides whose turn enables the Deck branch`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, "card:51869363"],
    setup: baseSetup(format, { p0: { hand: ["Exchange", CARD] }, [holder]: { hand: [ELF, VOID], deck: [ELF, ELF, ROCK, OTHER_ROCK] } }),
    steps: [
      activate("Exchange", "p0"), select({ card: ELF, owner: holder, from: "hand" }),
      ...turnsBefore(format, holder), expectOffered("activate", CARD, holder), pass(holder), pass(holder), pass(holder), setCard(CARD, holder), endTurn(holder),
      expectPrompt({ by: "p0", context: "action" }), ...turnsBefore(format, holder),
      activate(CARD, holder), select({ card: ROCK, owner: holder, from: "deck" }), activate(VOID, holder),
      expectPrompt({ by: holder, context: "action" }), everySeat(format, spec),
    ],
  });
}

export const SUPERCONDUCTIVE_PLASMA_BLAST_SCENARIOS: Scenario[] = [
  search("ffa3", "p2", true), search("ffa4", "p3", true), search("tag", "p2", true), search("tag", "p3", true),
  search("ffa3", "p2", false), search("ffa4", "p3", false), search("tag", "p3", false),
  ownTurn("ffa3"), ownTurn("ffa4"), ownTurn("tag"), ownTurn("tag", "p3"), reset(), exchanged("ffa3"), exchanged("tag"),
];
