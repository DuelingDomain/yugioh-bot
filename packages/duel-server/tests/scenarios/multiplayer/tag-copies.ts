// Tag copies of the compare cards that were proven at FFA3 only (review B, cards area): Mystic Mine, Ultimate Sky, Three in One, Kaiser Colosseum,
// Fire Ejection and Diabellstar. In Tag the two members of a team have one joined field, so a card compares the JOINED count of the
// opposing team with the joined count of the own team (the stock rule); a member alone may be below the count while the team is above it.
// Plain data (scripts/rule-coverage.ts reads it); tag-copies.test.ts runs it on a live core (NSEAT_LIVE=1). Every scenario ends with the
// state of EVERY seat. Decisions: docs/adr/0002-multiplayer-duel-rules.md.

import {
  activate, changePhase, defineScenario, endTurn, expectBoard, expectNotOffered, expectOffered, expectTurn, normalSummon, pass, select,
  type BoardExpect, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { ELF, SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";

const TAG_PARTNER = `${SOURCE} [R-TAG-PARTNER]`;
const OX = "Battle Ox";
const GUARDIAN = "Celtic Guardian";
const AXE = "Axe Raider";
const FANG = "Silver Fang";
const BEAVER = "Beaver Warrior";
const SKULL = "Summoned Skull";
const RAT = "Giant Rat";
const SANGAN = "Sangan";
const WITCH = "Witch of the Black Forest";
const BUG = "Man-Eater Bug";
const PIPER = "Mystic Piper";
const MINE = "Mystic Mine";
const SKY = "Ultimate Sky";
const TIO = "Three in One";
const OFFERINGS = "Offerings to the Doomed";

/**
 * The state of EVERY seat of a Tag duel, exact for the monster zones, the Spell and Trap zones, the Graveyard, the banished zone and the
 * Life Points of the team (16000 unless the team is given in `lp`). A seat that the spec leaves out is empty. The hand is checked only when named.
 */
function everyTagSeat(spec: Partial<Record<Seat, DuelistExpect>>, lp: { team0?: number; team1?: number } = {}): Step {
  const board: BoardExpect = {};
  for (const seat of ["p0", "p1", "p2", "p3"] as Seat[]) {
    const team = seat === "p0" || seat === "p2" ? lp.team0 : lp.team1;
    board[seat] = { lp: team ?? 16000, monsters: [], spells: [], grave: [], banished: [], ...spec[seat] };
  }
  return expectBoard(board);
}

export const TAG_COPY_SCENARIOS: Scenario[] = [
  // Mystic Mine: the lock of the opponents. In Tag the opposing members have one joined field: the team is locked when the JOINED count is
  // above the joined count of the team of the Mine, although each member alone is below it.
  defineScenario({
    id: "tag-copies-mystic-mine-locks-the-opposing-team-by-the-joined-count",
    title: "Tag: the team of p0 (p0 and p2) controls 3 monsters, p1 and p3 control 2 each (4 joined): Mystic Mine locks BOTH p1 and p3 (no monster effect, no attack) and leaves the partner p2 free",
    source: TAG_PARTNER,
    rules: ["R-TAG-PARTNER"],
    tags: ["multiplayer", "compare", "tag", "card:76375976"],
    setup: {
      format: "tag",
      p0: { hand: [MINE], monsters: [ELF, RAT] },
      p1: { monsters: [PIPER, WITCH] },
      p2: { monsters: [PIPER] },
      p3: { monsters: [PIPER, BUG] },
    },
    steps: [
      activate(MINE, "p0"),
      endTurn("p0"),
      // Round 1 (no attack is legal in it): the activation lock shows on the Piper of p1 and of p3, the Piper of the partner p2 is free.
      expectNotOffered("activate", PIPER, "p1"),
      endTurn("p1"),
      expectOffered("activate", PIPER, "p2"),
      endTurn("p2"),
      expectNotOffered("activate", PIPER, "p3"),
      endTurn("p3"),
      // Round 2: p0 ends its turn, then the attack lock shows: no monster of p1 or p3 may attack, the Piper of p2 may.
      endTurn("p0"),
      changePhase("battle", "p1"),
      expectNotOffered("attack", PIPER, "p1"),
      expectNotOffered("attack", WITCH, "p1"),
      endTurn("p1"),
      changePhase("battle", "p2"),
      expectOffered("attack", PIPER, "p2"),
      endTurn("p2"),
      changePhase("battle", "p3"),
      expectNotOffered("attack", PIPER, "p3"),
      expectNotOffered("attack", BUG, "p3"),
      everyTagSeat({
        p0: { hand: [ELF], monsters: [ELF, RAT], spells: [MINE] },
        p1: { hand: [ELF, ELF], monsters: [PIPER, WITCH] },
        p2: { hand: [ELF, ELF], monsters: [PIPER] },
        p3: { hand: [ELF, ELF], monsters: [PIPER, BUG] },
      }),
    ],
  }),
  defineScenario({
    id: "tag-copies-mystic-mine-joined-counts-equal-locks-nobody-and-destroys-itself",
    title: "Tag: the team of p0 controls 2 monsters (p0 and p2) and p1 and p3 control 1 each (2 joined, equal): Mystic Mine locks nobody and destroys itself in the End Phase",
    source: TAG_PARTNER,
    rules: ["R-TAG-PARTNER"],
    tags: ["multiplayer", "compare", "trigger", "tag", "card:76375976"],
    setup: {
      format: "tag",
      p0: { hand: [MINE], monsters: [ELF] },
      p1: { monsters: [SANGAN] },
      p2: { monsters: [RAT] },
      p3: { monsters: [WITCH] },
    },
    steps: [
      activate(MINE, "p0"),
      endTurn("p0"),
      expectTurn("p1", 2),
      everyTagSeat({
        p0: { hand: [], monsters: [ELF], grave: [MINE] },
        p1: { hand: [ELF], monsters: [SANGAN] },
        p2: { monsters: [RAT] },
        p3: { monsters: [WITCH] },
      }),
    ],
  }),
  // Ultimate Sky: "if your opponent controls more monsters than you". In Tag the joined count of the opposing team is compared with the joined count
  // of the own team, and the target cap is the joined face-up count of the opposing team.
  defineScenario({
    id: "tag-copies-ultimate-sky-joined-count-passes-no-single-member-does",
    title: "Tag: the team of p0 controls 2 monsters, p1 controls 1 and p3 controls 2 (3 joined): Ultimate Sky is offered to p0 although no member alone has more, and it negates a monster of p1",
    source: TAG_PARTNER,
    rules: ["R-TAG-PARTNER"],
    tags: ["multiplayer", "compare", "tag", "card:38817295"],
    // Sangan of p1 is negated by the Sky: Offerings to the Doomed then destroys it and Sangan does NOT add a card (a Sangan that is not negated
    // would offer p1 a search). The Sky costs 800 LP of the team of p0. Every other card of every seat is unchanged.
    setup: {
      format: "tag",
      p0: { hand: [SKY, OFFERINGS], monsters: [ELF] },
      p1: { monsters: [SANGAN] },
      p2: { monsters: [RAT] },
      p3: { monsters: [BUG, WITCH] },
    },
    steps: [
      expectOffered("activate", SKY, "p0"),
      activate(SKY, "p0"),
      select(SANGAN),
      expectBoard({ p0: { lp: 15200 }, p2: { lp: 15200 } }),
      activate(OFFERINGS, "p0"),
      select(SANGAN),
      everyTagSeat(
        {
          p0: { hand: [], monsters: [ELF], grave: [SKY, OFFERINGS] },
          p1: { hand: [], grave: [SANGAN] },
          p2: { hand: [], monsters: [RAT] },
          p3: { hand: [], monsters: [BUG, WITCH] },
        },
        { team0: 15200 },
      ),
    ],
  }),
  defineScenario({
    id: "tag-copies-ultimate-sky-partner-is-offered-at-the-joined-count",
    title: "Tag: Ultimate Sky is in the hand of the partner p2 and the team of p0 controls 2 monsters against 3 joined of p1 and p3: p2 is offered the Sky in its own turn and negates a monster of p3",
    source: TAG_PARTNER,
    rules: ["R-TAG-PARTNER"],
    tags: ["multiplayer", "compare", "tag", "card:38817295"],
    setup: {
      format: "tag",
      p0: { monsters: [ELF] },
      p1: { monsters: [SANGAN] },
      p2: { hand: [SKY, OFFERINGS], monsters: [RAT] },
      p3: { monsters: [BUG, WITCH] },
    },
    steps: [
      endTurn("p0"),
      endTurn("p1"),
      expectOffered("activate", SKY, "p2"),
      activate(SKY, "p2"),
      select(WITCH),
      expectBoard({ p0: { lp: 15200 }, p2: { lp: 15200 } }),
      activate(OFFERINGS, "p2"),
      select(WITCH),
      everyTagSeat(
        {
          p0: { hand: [], monsters: [ELF] },
          p1: { hand: [ELF], monsters: [SANGAN] },
          p2: { hand: [ELF], monsters: [RAT], grave: [SKY, OFFERINGS] },
          p3: { hand: [], monsters: [BUG], grave: [WITCH] },
        },
        { team0: 15200 },
      ),
    ],
  }),
  defineScenario({
    id: "tag-copies-ultimate-sky-equal-joined-counts-is-not-offered",
    title: "Tag: the team of p0 controls 2 monsters and p1 and p3 control 1 each (2 joined, equal): Ultimate Sky is not offered to p0",
    source: TAG_PARTNER,
    rules: ["R-TAG-PARTNER"],
    tags: ["multiplayer", "compare", "tag", "card:38817295"],
    setup: {
      format: "tag",
      p0: { hand: [SKY], monsters: [ELF] },
      p1: { monsters: [SANGAN] },
      p2: { monsters: [RAT] },
      p3: { monsters: [WITCH] },
    },
    steps: [
      expectNotOffered("activate", SKY, "p0"),
      endTurn("p0"),
      everyTagSeat({
        p0: { hand: [SKY], monsters: [ELF] },
        p1: { hand: [ELF], monsters: [SANGAN] },
        p2: { monsters: [RAT] },
        p3: { monsters: [WITCH] },
      }),
    ],
  }),
  // Three in One: Quick-Play Spell, End Phase of an opponent turn, "your opponent has more cards in the hand and on the field".
  // p0 holds 3 cards (the set Three in One and 2 in the hand). p1 draws in its turn.
  defineScenario({
    id: "tag-copies-three-in-one-opposing-member-has-more",
    title: "Tag: p1 holds 4 cards in its own End Phase, more than p0 (3): Three in One is offered and Special Summons 3 Normal Monsters from the Graveyard of p0",
    source: TAG_PARTNER,
    rules: ["R-TAG-PARTNER"],
    tags: ["multiplayer", "compare", "tag", "card:50838440"],
    setup: {
      format: "tag",
      p0: { hand: [FANG, BEAVER], spells: [{ card: TIO, pos: "set" }], grave: [OX, GUARDIAN, AXE] },
      p1: { hand: [RAT, FANG, OX] },
    },
    steps: [
      endTurn("p0"),
      changePhase("end", "p1"),
      expectOffered("activate", TIO, "p0"),
      activate(TIO, "p0"),
      expectTurn("p2", 3),
      everyTagSeat({
        p0: { hand: [FANG, BEAVER], monsters: [OX, GUARDIAN, AXE], grave: [TIO] },
        p1: { hand: [RAT, FANG, OX, ELF] },
        p2: { hand: [ELF] },
      }),
    ],
  }),
  defineScenario({
    id: "tag-copies-three-in-one-hand-of-the-partner-does-not-count",
    title: "Tag: p1 holds 3 cards in its End Phase (as many as p0) and the partner p3 holds 2 more: Three in One is not offered, the hand is the own hand only [R-TAG-SHARED-CARDS]",
    source: `${SOURCE} [R-TAG-SHARED-CARDS]`,
    rules: ["R-TAG-SHARED-CARDS"],
    tags: ["multiplayer", "compare", "tag", "card:50838440"],
    setup: {
      format: "tag",
      p0: { hand: [FANG, BEAVER], spells: [{ card: TIO, pos: "set" }], grave: [OX, GUARDIAN, AXE] },
      p1: { hand: [RAT, FANG] },
      p3: { hand: [RAT, OX] },
    },
    steps: [
      endTurn("p0"),
      // p0 gets no window in the End Phase of p1 (nothing of p0 can be activated): the turn goes on to p2.
      endTurn("p1"),
      expectTurn("p2", 3),
      everyTagSeat({
        p0: { hand: [FANG, BEAVER], spells: [TIO], grave: [OX, GUARDIAN, AXE] },
        p1: { hand: [RAT, FANG, ELF] },
        p2: { hand: [ELF] },
        p3: { hand: [RAT, OX] },
      }),
    ],
  }),
  defineScenario({
    id: "tag-copies-three-in-one-monster-of-the-partner-counts",
    title: "Tag: p1 holds 3 cards in its End Phase and the partner p3 controls a monster (the field is joined): the opposing team has 4 against 3 of p0 and Three in One is offered",
    source: `${SOURCE} [R-TAG-SHARED-CARDS]`,
    rules: ["R-TAG-SHARED-CARDS"],
    tags: ["multiplayer", "compare", "tag", "card:50838440"],
    setup: {
      format: "tag",
      p0: { hand: [FANG, BEAVER], spells: [{ card: TIO, pos: "set" }], grave: [OX, GUARDIAN, AXE] },
      p1: { hand: [RAT, FANG] },
      p3: { hand: [RAT, OX], monsters: [SANGAN] },
    },
    steps: [
      endTurn("p0"),
      changePhase("end", "p1"),
      expectOffered("activate", TIO, "p0"),
      activate(TIO, "p0"),
      expectTurn("p2", 3),
      everyTagSeat({
        p0: { hand: [FANG, BEAVER], monsters: [OX, GUARDIAN, AXE], grave: [TIO] },
        p1: { hand: [RAT, FANG, ELF] },
        p2: { hand: [ELF] },
        p3: { hand: [RAT, OX], monsters: [SANGAN] },
      }),
    ],
  }),
  // Kaiser Colosseum: "neither player can control more monsters than their opponent". In Tag the limit counts the JOINED field of the summoning team.
  // p1 uses Soul Exchange on a monster of the team of p0, then Tribute Summons Summoned Skull with it.
  defineScenario({
    id: "tag-copies-kaiser-colosseum-summoning-team-stays-within-the-limit",
    title: "Tag: the team of p0 controls 2 monsters and Kaiser Colosseum, the team of p1 controls none: Soul Exchange and the Tribute Summon of Summoned Skull by p1 are allowed (1 monster is not more than the 1 left)",
    source: TAG_PARTNER,
    rules: ["R-TAG-PARTNER"],
    tags: ["multiplayer", "compare", "tag", "card:35059553", "card:68005187"],
    setup: {
      format: "tag",
      p0: { monsters: [OX, GUARDIAN], spells: ["Kaiser Colosseum"] },
      p1: { hand: [SKULL, "Soul Exchange"] },
    },
    steps: [
      endTurn("p0"),
      activate("Soul Exchange", "p1"),
      select(OX),
      expectOffered("tributeSummon", SKULL, "p1"),
      normalSummon(SKULL, "p1"),
      select(OX),
      everyTagSeat({
        p0: { monsters: [GUARDIAN], spells: ["Kaiser Colosseum"], grave: [OX] },
        p1: { monsters: [SKULL], grave: ["Soul Exchange"], hand: [ELF] },
      }),
    ],
  }),
  defineScenario({
    id: "tag-copies-kaiser-colosseum-partner-monster-counts-for-the-limit",
    title: "Tag: as above, but the partner p3 controls a monster: with the Skull the team of p1 would hold 2 monsters against 1, so the Tribute Summon is not offered",
    source: TAG_PARTNER,
    rules: ["R-TAG-PARTNER"],
    tags: ["multiplayer", "compare", "tag", "card:35059553", "card:68005187"],
    setup: {
      format: "tag",
      p0: { monsters: [OX, GUARDIAN], spells: ["Kaiser Colosseum"] },
      p1: { hand: [SKULL, "Soul Exchange"] },
      p3: { monsters: [BEAVER] },
    },
    steps: [
      endTurn("p0"),
      activate("Soul Exchange", "p1"),
      select(OX),
      expectNotOffered("tributeSummon", SKULL, "p1"),
      // The Tribute of Soul Exchange is paid by the summon, which never starts: the monsters of p0 stay.
      everyTagSeat({
        p0: { monsters: [OX, GUARDIAN], spells: ["Kaiser Colosseum"] },
        p1: { hand: [SKULL, ELF], grave: ["Soul Exchange"] },
        p3: { monsters: [BEAVER] },
      }),
    ],
  }),
];
