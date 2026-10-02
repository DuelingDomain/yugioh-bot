// Live scenarios of the opponent-turn count (rule R3 of ADR-0002, Q1) and of refused answers to the seat prompts (W9).
// Plain data: no Vitest import, so that scripts/rule-coverage.ts can load this file. opponent-turns.test.ts runs them on a live core.
//
// R3: a RESET_OPPO_TURN count-2 card ends after the 2nd opponent turn. Every turn of an opposing duelist counts, a partner turn
// does not, a seat that lost does not take a turn. The reset is patch 0048 (field::reset_counts_turn). The card is
// Nightmare's Steelcage: "after 2 of your opponent's turns, destroy this card", so the end is visible on the board.
// W9: the opponent pick (SELECT_OPTION 0xFFFE) and the place prompt of an opponent field (HINT_PLACE_SEAT, patch 0045) refuse a
// wrong answer and keep the state. The card is Ojama Trio: it asks for an opponent, then for the zone on that opponent's field.

import {
  activate, defineScenario, endTurn, expectBoard, expectEliminated, expectLp, expectPickOptions, expectPrompt, expectRetry,
  expectTurn, pickOpponent, surrender, zone, type Scenario, type Step,
} from "../../support/dsl.js";
import { ELF, SOURCE } from "./nseat-scenarios.js";

const STEELCAGE = "Nightmare's Steelcage";
const STEELCAGE_CODE = 58775978;
const TRIO = "Ojama Trio";
const TRIO_CODE = 29843091;
const TOKEN_CODE = 29843092;

type Id = "p0" | "p1" | "p2" | "p3";

/** p0 holds the Steelcage and one Elf. Every seat is shown by `cage`. */
const holder = { hand: [STEELCAGE], monsters: [ELF] };

/**
 * Board of the whole table with the Steelcage on the field of p0 (on) or in its Graveyard (off). `hands` is the hand size of each seat
 * (the seat whose turn it is has drawn). `lp` is the LP of each seat: 8000, in Tag the 16000 that a team shares.
 */
function cage(on: boolean, seats: Id[], hands: Partial<Record<Id, number>>, lp = 8000): Step {
  const board: Partial<Record<Id, object>> = {};
  for (const seat of seats) {
    board[seat] = {
      lp,
      hand: { count: hands[seat] ?? 0 },
      banished: { count: 0 },
      monsters: seat === "p0" ? [ELF] : { count: 0 },
      spells: seat === "p0" && on ? [STEELCAGE] : { count: 0 },
      grave: seat === "p0" && !on ? [STEELCAGE] : { count: 0 },
    };
  }
  return expectBoard(board);
}

export const OPPONENT_TURN_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "r3-ffa3-steelcage-ends-after-second-opponent-turn",
    title: "FFA3: Nightmare's Steelcage (RESET_OPPO_TURN, count 2) stays through the turn of p1 and is destroyed at the end of the turn of p2",
    source: `${SOURCE} [R-FFA-ORDER] Q1 R3: every turn of any opponent counts`,
    rules: ["R-FFA-ORDER"],
    tags: ["multiplayer", "turn-count", "r3", "ffa3", `card:${STEELCAGE_CODE}`],
    setup: { format: "ffa3", p0: holder },
    steps: [
      activate(STEELCAGE, "p0"),
      cage(true, ["p0", "p1", "p2"], {}),
      endTurn("p0"), expectTurn("p1", 2),
      endTurn("p1"), expectTurn("p2", 3),
      // One opponent turn is over, the card is still on the field.
      cage(true, ["p0", "p1", "p2"], { p1: 1, p2: 1 }),
      endTurn("p2"), expectTurn("p0", 4),
      // The 2nd opponent turn is over: the card is in the Graveyard of p0. Nothing else changed.
      cage(false, ["p0", "p1", "p2"], { p0: 1, p1: 1, p2: 1 }),
    ],
  }),
  defineScenario({
    id: "r3-tag-steelcage-partner-turn-does-not-count",
    title: "Tag: Nightmare's Steelcage ignores the turn of the partner and is destroyed at the end of the turn of the 2nd opposing duelist",
    source: `${SOURCE} [R-TAG-ORDER] [R-TAG-PARTNER] Q1 R3: in Tag only a turn of the two opposing duelists counts`,
    rules: ["R-TAG-ORDER", "R-TAG-PARTNER"],
    tags: ["multiplayer", "turn-count", "r3", "tag", `card:${STEELCAGE_CODE}`],
    setup: { format: "tag", p0: holder },
    steps: [
      activate(STEELCAGE, "p0"),
      endTurn("p0"), expectTurn("p1", 2),
      // 1st opposing turn (p1) is over.
      endTurn("p1"), expectTurn("p2", 3),
      cage(true, ["p0", "p1", "p2", "p3"], { p1: 1, p2: 1 }, 16000),
      // The turn of the partner p2 is over. In FFA3 this would be the end. In Tag the card stays.
      endTurn("p2"), expectTurn("p3", 4),
      cage(true, ["p0", "p1", "p2", "p3"], { p1: 1, p2: 1, p3: 1 }, 16000),
      // 2nd opposing turn (p3) is over: now the card goes.
      endTurn("p3"), expectTurn("p0", 5),
      cage(false, ["p0", "p1", "p2", "p3"], { p0: 1, p1: 1, p2: 1, p3: 1 }, 16000),
    ],
  }),
  defineScenario({
    id: "r3-ffa4-steelcage-control-ends-after-second-opponent-turn",
    title: "FFA4, nobody out: Nightmare's Steelcage is destroyed at the end of the turn of p2 and p3 never sees it",
    source: `${SOURCE} [R-FFA-ORDER] Q1 R3: every turn of any opponent counts`,
    rules: ["R-FFA-ORDER"],
    tags: ["multiplayer", "turn-count", "r3", "ffa4", `card:${STEELCAGE_CODE}`],
    setup: { format: "ffa4", p0: holder },
    steps: [
      activate(STEELCAGE, "p0"),
      endTurn("p0"), expectTurn("p1", 2),
      endTurn("p1"), expectTurn("p2", 3),
      cage(true, ["p0", "p1", "p2", "p3"], { p1: 1, p2: 1 }),
      endTurn("p2"), expectTurn("p3", 4),
      cage(false, ["p0", "p1", "p2", "p3"], { p1: 1, p2: 1, p3: 1 }),
    ],
  }),
  defineScenario({
    id: "r3-ffa4-steelcage-after-elimination-counts-living-opponents",
    title: "FFA4, p1 out before the count: the counted turns are p2 and p3, so the card is destroyed at the end of the turn of p3",
    source: `${SOURCE} [R-FFA-ELIMINATION] Q1 R3: a seat that lost takes no turn, so it adds no opponent turn`,
    rules: ["R-FFA-ELIMINATION", "R-FFA-ORDER"],
    tags: ["multiplayer", "turn-count", "r3", "elimination", "ffa4", `card:${STEELCAGE_CODE}`],
    setup: { format: "ffa4", p0: holder },
    steps: [
      activate(STEELCAGE, "p0"),
      surrender("p1"), expectEliminated("p1"),
      cage(true, ["p0", "p2", "p3"], {}),
      endTurn("p0"), expectTurn("p2", 2),
      endTurn("p2"), expectTurn("p3", 3),
      cage(true, ["p0", "p2", "p3"], { p2: 1, p3: 1 }),
      endTurn("p3"), expectTurn("p0", 4),
      cage(false, ["p0", "p2", "p3"], { p0: 1, p2: 1, p3: 1 }),
    ],
  }),
  defineScenario({
    id: "r3-ffa4-steelcage-turn-player-eliminated-in-own-turn",
    title: "FFA4: p1 took the 1st opponent turn, p2 gives up during its own turn; that turn cut short is the 2nd counted turn and the card ends with it",
    source: `${SOURCE} [R-FFA-ELIMINATION] Q1 R3: a seat that lost takes no turn; a turn cut short by an elimination counts as an ended turn for every turn count`,
    rules: ["R-FFA-ELIMINATION", "R-FFA-ORDER"],
    tags: ["multiplayer", "turn-count", "r3", "elimination", "ffa4", `card:${STEELCAGE_CODE}`],
    setup: { format: "ffa4", p0: holder },
    steps: [
      activate(STEELCAGE, "p0"),
      endTurn("p0"), expectTurn("p1", 2),
      endTurn("p1"), expectTurn("p2", 3),
      surrender("p2"), expectEliminated("p2"),
      // The turn of p2 ended with the loss: it is the 2nd opponent turn of p0, so the card is gone when p3 starts its turn.
      expectTurn("p3", 4),
      cage(false, ["p0", "p1", "p3"], { p0: 0, p1: 1, p3: 1 }),
      endTurn("p3"), expectTurn("p0", 5),
      cage(false, ["p0", "p1", "p3"], { p0: 1, p1: 1, p3: 1 }),
    ],
  }),

  // W9 ----------------------------------------------------------------------------------------------------------
  // Ojama Trio, set on the field of p0: the activation asks p0 for an opponent (0xFFFE), then for a zone of that opponent's field
  // (HINT_PLACE_SEAT). Each prompt gets a wrong answer first. The state must stay the same and the prompt stay open.
  ...(["ffa3", "tag"] as const).map((format) => {
    const opposing: Id[] = format === "tag" ? ["p1", "p3"] : ["p1", "p2"];
    const target = opposing[1]!;
    const lp = format === "tag" ? 16000 : 8000;
    const others = (["p0", "p1", "p2", "p3"] as Id[]).slice(0, format === "tag" ? 4 : 3);
    const bystanders = others.filter((seat) => seat !== "p0" && seat !== target);
    const wrongSeat = (seat: Id) => expectRetry({ choice: "opt:0" }, { as: seat, error: "Wrong seat", by: "p0" });
    const wrongPlaceSeat = (seat: Id) => expectRetry({ selected: ["place:0"] }, { as: seat, error: "Wrong seat", by: "p0" });
    return defineScenario({
      id: `w9-${format}-opponent-pick-and-place-refuse-wrong-answers`,
      title: `${format === "tag" ? "Tag" : "FFA3"}: Ojama Trio refuses a wrong seat and an unknown option at the opponent pick and at the zone prompt of ${target}, then takes the right answers`,
      source: `${SOURCE} [R-COMMON-OPP-PICK]; patch 0045 (HINT_PLACE_SEAT): a place answer must name the seat of the prompt`,
      rules: ["R-COMMON-OPP-PICK"],
      tags: ["multiplayer", "opponent-pick", "place-seat", "retry", "w9", format, `card:${TRIO_CODE}`, `card:${TOKEN_CODE}`],
      setup: { format, p0: { spells: [{ card: TRIO, pos: "set" }] } },
      steps: [
        activate(TRIO, "p0"),
        // The pick offers the opposing duelists only, in turn order. In Tag the partner is not one of them.
        expectPickOptions(opposing.map((seat) => ({ seat })), "p0"),
        expectRetry({ choice: "opt:9" }, { error: "Invalid answer", by: "p0" }),
        expectRetry({ choice: "target" }, { error: "Invalid answer", by: "p0" }),
        expectRetry({ selected: ["opt:0", "opt:1"] }, { error: "Invalid answer", by: "p0" }),
        ...bystanders.map(wrongSeat),
        ...opposing.map(wrongSeat),
        pickOpponent(target, "p0"),
        // The zone prompt names the zones of the picked seat and no other seat.
        expectPrompt({ by: "p0", kind: "places" }),
        expectPickOptions({ count: 5, exclude: others.filter((seat) => seat !== target).map((seat) => ({ seat })) }, "p0"),
        expectRetry({ selected: ["place:9"] }, { error: "Invalid answer", by: "p0" }),
        expectRetry({ selected: ["place:0", "place:1"] }, { error: "Invalid answer", by: "p0" }),
        expectRetry({ selected: [] }, { error: "Invalid answer", by: "p0" }),
        ...others.filter((seat) => seat !== "p0").map(wrongPlaceSeat),
        // The right answer: zone 3 of the picked seat. The other two tokens take the first free zones.
        zone(target, "m2", "p0"),
        expectBoard(
          Object.fromEntries(
            others.map((seat) => [
              seat,
              seat === target
                ? { lp, hand: { count: 0 }, grave: { count: 0 }, banished: { count: 0 }, monsters: { count: 3 }, spells: { count: 0 }, zones: { m2: { card: TOKEN_CODE, pos: "def" as const } } }
                : seat === "p0"
                  ? { lp, hand: { count: 0 }, grave: [TRIO], banished: { count: 0 }, monsters: { count: 0 }, spells: { count: 0 } }
                  : { lp, hand: { count: 0 }, grave: { count: 0 }, banished: { count: 0 }, monsters: { count: 0 }, spells: { count: 0 } },
            ]),
          ),
        ),
        expectLp({ seat: target }, lp),
      ],
    });
  }),
];
