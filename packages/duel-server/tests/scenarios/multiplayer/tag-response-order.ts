// Tag chain response order and simultaneous trigger order (review gap "R-TAG-RESPONSE", low to medium). Before this file the rule was
// proven by the native check response-order only; no DSL scenario played it on a live core. Plain data (scripts/rule-coverage.ts reads
// it); tag-response-order.test.ts runs it live. Tag seats: p0 and p2 are team 0, p1 and p3 are team 1, turn order p0, p1, p2, p3.
//
// Chain windows (ADR [R-TAG-RESPONSE]): after a Chain Link the OPPOSING team answers first, in seat order from the seat after the duelist
// who added the link, then the team of that duelist (the partner, then the duelist). Every seat holds a set Dust Tornado, so every
// window is a real prompt. A card of the partner may be chained to a link of the partner (only negation is refused, R-TAG-PARTNER).
// Simultaneous triggers: the order is turn player, turn player's partner, then the opposing team in seat order, the same as the window
// order for the turn player. The chain resolves in reverse, so the LAST trigger on the chain resolves first.

import {
  activate, defineScenario, endTurn, expectBoard, expectChain, expectResolved, expectResponseOrder, expectTurn, pass, select,
  type Scenario,
} from "../../support/dsl.js";
import { ELF, SOURCE } from "./nseat-scenarios.js";

const DUST = { card: "Dust Tornado", pos: "set" as const };
const SWORDS = { card: "Swords of Revealing Light", pos: "up" as const };
const RULE = `${SOURCE} [R-TAG-RESPONSE]`;
const CHAIN_TAGS = ["multiplayer", "chain", "tag", "card:19613556", "card:60082869", "card:72302403"];
const TRIGGER_TAGS = ["multiplayer", "triggers", "chain", "tag", "card:53129443", "card:26202165", "card:78010363", "card:64306248", "card:58616392"];

export const TAG_RESPONSE_ORDER_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "tag-response-order-chain-after-p0-link-and-p2-link",
    title: "Tag: after the Heavy Storm of p0 the opposing team answers first (p1, p3), then the partner p2, who adds a link; after that link p3, p1 and then p0 answer",
    source: RULE,
    rules: ["R-TAG-RESPONSE"],
    tags: CHAIN_TAGS,
    // The Dust Tornado of p2 targets a card of the opposing team (the Swords of p1): the partner p0 is never a target.
    setup: {
      format: "tag",
      p0: { hand: ["Heavy Storm"], spells: [DUST] },
      p1: { spells: [DUST, SWORDS, SWORDS] },
      p2: { spells: [DUST] },
      p3: { spells: [DUST] },
    },
    steps: [
      activate("Heavy Storm", "p0"),
      pass("p1"),
      pass("p3"),
      activate("Dust Tornado", "p2"),
      select({ card: "Swords of Revealing Light", nth: 0 }),
      expectChain("Heavy Storm", "Dust Tornado"),
      pass("p3"),
      pass("p1"),
      pass("p0"),
      expectResponseOrder("p1", "p3", "p2", "p3", "p1", "p0"),
      expectResolved("Dust Tornado", "Heavy Storm"),
      // Dust Tornado destroyed one Swords. Heavy Storm then destroyed every other Spell and Trap of the four seats, the set ones too.
      expectBoard({
        p0: { lp: 16000, spells: { count: 0 }, grave: { include: ["Heavy Storm", "Dust Tornado"] } },
        p1: { lp: 16000, spells: { count: 0 }, grave: { include: ["Dust Tornado", "Swords of Revealing Light"] } },
        p2: { lp: 16000, spells: { count: 0 }, grave: ["Dust Tornado"] },
        p3: { lp: 16000, spells: { count: 0 }, grave: ["Dust Tornado"] },
      }),
    ],
  }),
  defineScenario({
    id: "tag-response-order-chain-team-1-turn-opposing-team-first",
    title: "Tag: in the turn of p1, after its Heavy Storm the opposing team answers first (p2, then p0), who adds Magic Jammer; then p1 and p3 answer the Jammer, and p3 negates it with Seven Tools of the Bandit",
    source: RULE,
    rules: ["R-TAG-RESPONSE"],
    tags: ["multiplayer", "chain", "tag", "team1", "card:19613556", "card:77414722", "card:3819470"],
    // Team 1 is the acting team. Counter Traps are used because they open no window at the turn change (a set Dust Tornado does: with
    // four of them the walk to the turn of p1 holds 19 optional windows). After the Heavy Storm of p1 only the opposing team (p2 then p0,
    // the seats after p1) can answer: Magic Jammer cannot negate the Spell of the partner p3. After the Jammer of p0 the opposing team
    // of p0 answers, p1 then p3, and Seven Tools of the Bandit of p3 negates the Jammer (a Trap Card). The partner p2 of p0 holds no card
    // that can answer a Trap Card, so it gets no window.
    setup: {
      format: "tag",
      p0: { hand: [ELF], spells: [{ card: "Magic Jammer", pos: "set" }] },
      p1: { hand: ["Heavy Storm"], spells: [{ card: "Seven Tools of the Bandit", pos: "set" }] },
      p2: { hand: [ELF], spells: [{ card: "Magic Jammer", pos: "set" }] },
      p3: { spells: [{ card: "Seven Tools of the Bandit", pos: "set" }] },
    },
    steps: [
      endTurn("p0"),
      expectTurn("p1", 2),
      activate("Heavy Storm", "p1"),
      pass("p2"),
      activate("Magic Jammer", "p0"),
      pass("p1"),
      activate("Seven Tools of the Bandit", "p3"),
      expectResponseOrder("p2", "p0", "p1", "p3"),
      // Heavy Storm resolves in the end (the Jammer that negated it is negated too) and destroys every other Spell/Trap Card, also the set
      // Magic Jammer of p2 and the Seven Tools of the Bandit of p1. Team 1 paid the 1000 LP of the Seven Tools once.
      expectBoard({
        p0: { lp: 16000, hand: [], grave: [ELF, "Magic Jammer"], spells: [] },
        p1: { lp: 15000, hand: [ELF], grave: ["Heavy Storm", "Seven Tools of the Bandit"], spells: [] },
        p2: { lp: 16000, hand: [ELF], grave: ["Magic Jammer"], spells: [] },
        p3: { lp: 15000, hand: [], grave: ["Seven Tools of the Bandit"], spells: [] },
      }),
    ],
  }),
  defineScenario({
    id: "tag-response-order-triggers-turn-player-partner-then-opposing-team",
    title: "Tag: Dark Hole of p0 sends four trigger monsters to the Graveyard together: the triggers go on the chain in the order p0, p2, p1, p3, so p3 resolves first and p0 last",
    source: RULE,
    rules: ["R-TAG-RESPONSE"],
    tags: TRIGGER_TAGS,
    // Four mandatory triggers of four duelists in one event. Order on the chain (turn player p0, its partner p2, then p1, p3): Sangan,
    // Witch of the Black Forest, Skull-Mark Ladybug, Doomdog Octhros. Resolution is the reverse. A plain seat order (p0, p1, p2, p3)
    // would resolve Witch of the Black Forest before Skull-Mark Ladybug and the partner order p0, p1, p2, p3 would end with p3 on top.
    setup: {
      format: "tag",
      p0: { hand: ["Dark Hole"], monsters: ["Sangan"], deck: ["Giant Rat"] },
      p1: { monsters: ["Skull-Mark Ladybug"] },
      p2: { monsters: ["Witch of the Black Forest"], deck: ["Silver Fang"] },
      p3: { monsters: ["Doomdog Octhros"], deck: ["Dark Necrofear"] },
    },
    steps: [
      activate("Dark Hole", "p0"),
      select("Giant Rat"),
      expectResolved("Dark Hole", "Doomdog Octhros", "Skull-Mark Ladybug", "Witch of the Black Forest", "Sangan"),
      expectBoard({
        p0: { lp: 16000, monsters: [], spells: [], hand: ["Giant Rat"], grave: ["Dark Hole", "Sangan"] },
        p1: { lp: 17000, monsters: [], spells: [], grave: ["Skull-Mark Ladybug"] },
        p2: { lp: 16000, monsters: [], spells: [], hand: ["Silver Fang"], grave: ["Witch of the Black Forest"] },
        p3: { lp: 17000, monsters: [], spells: [], hand: ["Dark Necrofear"], grave: ["Doomdog Octhros"] },
      }),
    ],
  }),
  defineScenario({
    id: "tag-response-order-triggers-team-1-turn-player",
    title: "Tag: in the turn of p1, Dark Hole sends four trigger monsters to the Graveyard together: the order on the chain is p1, p3, p2, p0, so p0 resolves first and p1 last",
    source: RULE,
    rules: ["R-TAG-RESPONSE"],
    tags: [...TRIGGER_TAGS, "team1"],
    // The turn player is p1, its partner is p3, then the opposing team in seat order from the turn player: p2, p0.
    setup: {
      format: "tag",
      p0: { monsters: ["Sangan"], deck: ["Giant Rat"] },
      p1: { hand: ["Dark Hole"], monsters: ["Skull-Mark Ladybug"] },
      p2: { monsters: ["Witch of the Black Forest"], deck: ["Silver Fang"] },
      p3: { monsters: ["Doomdog Octhros"], deck: ["Dark Necrofear"] },
    },
    steps: [
      endTurn("p0"),
      expectTurn("p1", 2),
      activate("Dark Hole", "p1"),
      select("Giant Rat"),
      expectResolved("Dark Hole", "Sangan", "Witch of the Black Forest", "Doomdog Octhros", "Skull-Mark Ladybug"),
      expectBoard({
        p0: { lp: 16000, monsters: [], spells: [], hand: ["Giant Rat"], grave: ["Sangan"] },
        p1: { lp: 17000, monsters: [], spells: [], hand: ["Mystical Elf"], grave: ["Dark Hole", "Skull-Mark Ladybug"] },
        p2: { lp: 16000, monsters: [], spells: [], hand: ["Silver Fang"], grave: ["Witch of the Black Forest"] },
        p3: { lp: 17000, monsters: [], spells: [], hand: ["Dark Necrofear"], grave: ["Doomdog Octhros"] },
      }),
    ],
  }),
];
