// Cards that compare or end the LP of "you and your opponent": Self-Destruct Button (57585212) and Tri-and-Guess (73988674). Both were
// listed as "legal but wrong"; the live probes show the stock script is right once the opponent value is the picked opponent, so these
// scenarios PROVE the existing behaviour (no overlay file). They would catch a regression of the opponent pick.
//
// Self-Destruct Button: "If your LP is 7000 or more lower than your opponent's: both players' LP become 0". The Lua value 1-tp folds to ONE
// opponent: the condition holds when ANY opponent leads by 7000 or more, and the activation picks one of the opponents that do (a pick only
// when two or more qualify). You and that opponent lose together (R-COMMON-OPP-PICK, the duel-style reading Q4); every other seat plays
// on. In Tag the opposing team is the folded opponent, so both teams reach 0 LP together and the duel is a draw.
//
// Tri-and-Guess: "Each player confirms their Extra Deck, the one with more cards of the type that you named recovers 3000 LP". The activation picks
// ONE opponent (only an opponent that has an Extra Deck is offered, in Tag the pick is one of the opposing team); the owner of the
// card and that opponent confirm their Extra Decks to each other and compare the count of the named type. Every other seat is not involved.

import { activate, choose, defineScenario, endTurn, expectBoard, expectEliminated, expectLp, expectPickSeats, expectResult, expectTurn, faceDown, pickOpponent, type DuelistExpect, type Scenario } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseSetup, everySeat, type Seat } from "./seat-kit.js";

const BUTTON = "Self-Destruct Button";
const BUTTON_CODE = 57585212;
// What the VIEW shows for an eliminated seat (src/views.ts, emptySeatView): the cards left the game with the seat.
const OUT: DuelistExpect = { lp: 0, hand: { count: 0 }, spells: { count: 0 }, monsters: { count: 0 }, grave: { count: 0 } };
const TRI = "Tri-and-Guess";
const TRI_CODE = 73988674;
const SYNCHRO = "Goyo Guardian";
const FUSION = "Elemental HERO Necroid Shaman";
const ALIVE = (lp: number): DuelistExpect => ({ lp, monsters: [], spells: [], grave: [], banished: [] });

export const LP_PAIR_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "lp-pair-ffa3-button-two-qualify-pick-one-p2-wins",
    title: "FFA3: p0 (1000 LP) activates Self-Destruct Button with p1 and p2 both 7000 or more above: the pick offers p1 and p2, p1 is picked, p0 and p1 lose together and p2 wins",
    source: `${SOURCE} [R-COMMON-OPP-PICK] "both players" = you plus one picked opponent that meets the condition (Q4)`,
    rules: ["R-COMMON-OPP-PICK", "R-FFA-ELIMINATION"],
    tags: ["multiplayer", "opponent-pick", "lp", "ffa3", `card:${BUTTON_CODE}`],
    setup: baseSetup("ffa3", { p0: { lp: 1000, spells: [faceDown(BUTTON)] }, p1: { lp: 8000 }, p2: { lp: 8000 } }),
    steps: [
      activate(BUTTON, "p0"),
      expectPickSeats(["p1", "p2"], "p0"),
      pickOpponent("p1", "p0"),
      expectEliminated("p0", "p1"),
      expectResult({ seat: "p2", reason: "lp" }),
      expectLp({ seat: "p0" }, 0),
      expectLp({ seat: "p1" }, 0),
      expectLp({ seat: "p2" }, 8000),
    ],
  }),
  defineScenario({
    id: "lp-pair-ffa3-button-one-qualifies-no-pick-p1-wins",
    title: "FFA3: p0 (1000 LP) activates Self-Destruct Button, only p2 (8000 LP) is 7000 or more above (p1 has 2000): no pick, p0 and p2 lose together and p1 wins",
    source: `${SOURCE} [R-COMMON-OPP-PICK] only an opponent that meets the condition can be the folded opponent`,
    rules: ["R-COMMON-OPP-PICK", "R-FFA-ELIMINATION"],
    tags: ["multiplayer", "opponent-pick", "lp", "ffa3", `card:${BUTTON_CODE}`],
    setup: baseSetup("ffa3", { p0: { lp: 1000, spells: [faceDown(BUTTON)] }, p1: { lp: 2000 }, p2: { lp: 8000 } }),
    steps: [
      activate(BUTTON, "p0"),
      expectEliminated("p0", "p2"),
      expectResult({ seat: "p1", reason: "lp" }),
      expectLp({ seat: "p0" }, 0),
      expectLp({ seat: "p1" }, 2000),
      expectLp({ seat: "p2" }, 0),
    ],
  }),
  defineScenario({
    id: "lp-pair-ffa4-button-pick-p3-the-others-play-on",
    title: "FFA4: p0 (1000 LP) activates Self-Destruct Button, p1 and p3 qualify (p2 has 2000): the pick offers exactly p1 and p3, p3 is picked, p0 and p3 are out, p1 and p2 keep their LP and the turn skips the seats that are out",
    source: `${SOURCE} [R-COMMON-OPP-PICK] the pick offers only the opponents that meet the condition; every other seat plays on`,
    rules: ["R-COMMON-OPP-PICK", "R-FFA-ELIMINATION"],
    tags: ["multiplayer", "opponent-pick", "lp", "ffa4", `card:${BUTTON_CODE}`],
    setup: baseSetup("ffa4", { p0: { lp: 1000, spells: [faceDown(BUTTON)] }, p1: { lp: 8000 }, p2: { lp: 2000 }, p3: { lp: 8000 } }),
    steps: [
      activate(BUTTON, "p0"),
      expectPickSeats(["p1", "p3"], "p0"),
      pickOpponent("p3", "p0"),
      expectEliminated("p0", "p3"),
      expectBoard({ p0: OUT, p1: ALIVE(8000), p2: ALIVE(2000), p3: OUT }),
      // The turn player is out: the turn goes to the next living seat at once.
      expectTurn("p1", 2),
      endTurn("p1"),
      expectTurn("p2", 3),
      endTurn("p2"),
      expectTurn("p1", 4),
    ],
  }),
  defineScenario({
    id: "lp-pair-ffa3-tri-and-guess-picked-opponent-has-more-recovers",
    title: "FFA3: p0 (2 Synchro) activates Tri-and-Guess, picks p2 (3 Synchro) and names Synchro: p2 recovers 3000 and p0 and p1 keep 8000 (p1 was not picked)",
    source: `${SOURCE} [R-COMMON-OPP-PICK] the compared opponent is the picked opponent, not the others`,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "opponent-pick", "lp", "ffa3", `card:${TRI_CODE}`],
    setup: baseSetup("ffa3", {
      p0: { spells: [faceDown(TRI)], extra: [SYNCHRO, SYNCHRO] }, p1: { extra: [SYNCHRO] }, p2: { extra: [SYNCHRO, SYNCHRO, SYNCHRO] },
    }),
    steps: [
      activate(TRI, "p0"),
      expectPickSeats(["p1", "p2"], "p0"),
      pickOpponent("p2", "p0"),
      choose("Synchro", "p0"),
      everySeat("ffa3", { p0: { lp: 8000, grave: [TRI] }, p1: { lp: 8000 }, p2: { lp: 11000 } }),
    ],
  }),
  defineScenario({
    id: "lp-pair-ffa3-tri-and-guess-owner-has-more-recovers",
    title: "FFA3: p0 (2 Synchro) activates Tri-and-Guess, picks p1 (1 Synchro) and names Synchro: p0 recovers 3000, p1 and p2 (3 Synchro, not picked) keep 8000",
    source: `${SOURCE} [R-COMMON-OPP-PICK] the owner of the card compares with the picked opponent only`,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "opponent-pick", "lp", "ffa3", `card:${TRI_CODE}`],
    setup: baseSetup("ffa3", {
      p0: { spells: [faceDown(TRI)], extra: [SYNCHRO, SYNCHRO] }, p1: { extra: [SYNCHRO] }, p2: { extra: [SYNCHRO, SYNCHRO, SYNCHRO] },
    }),
    steps: [
      activate(TRI, "p0"),
      pickOpponent("p1", "p0"),
      choose("Synchro", "p0"),
      everySeat("ffa3", { p0: { lp: 11000, grave: [TRI] }, p1: { lp: 8000 }, p2: { lp: 8000 } }),
    ],
  }),
  defineScenario({
    id: "lp-pair-ffa3-tri-and-guess-only-the-named-type-counts-tie",
    title: "FFA3: p0 (1 Synchro, 1 Fusion) activates Tri-and-Guess, picks p1 (1 Synchro, 2 Fusion) and names Synchro: the Synchro counts are equal, nobody recovers (the Fusion cards do not count)",
    source: `${SOURCE} [R-COMMON-OPP-PICK] only the named type is compared`,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "opponent-pick", "lp", "ffa3", `card:${TRI_CODE}`],
    setup: baseSetup("ffa3", {
      p0: { spells: [faceDown(TRI)], extra: [SYNCHRO, FUSION] }, p1: { extra: [SYNCHRO, FUSION, FUSION] }, p2: { extra: [SYNCHRO] },
    }),
    steps: [
      activate(TRI, "p0"),
      pickOpponent("p1", "p0"),
      choose("Synchro", "p0"),
      everySeat("ffa3", { p0: { lp: 8000, grave: [TRI] }, p1: { lp: 8000 }, p2: { lp: 8000 } }),
    ],
  }),
  defineScenario({
    id: "lp-pair-ffa4-tri-and-guess-no-extra-deck-not-offered",
    title: "FFA4: p0 (1 Synchro, 1 Fusion) activates Tri-and-Guess, p1 has no Extra Deck: the pick offers exactly p2 and p3, p3 (2 Fusion) is picked, Fusion is named and p3 recovers 3000",
    source: `${SOURCE} [R-COMMON-OPP-PICK] an opponent with no Extra Deck is not a valid pick`,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "opponent-pick", "lp", "ffa4", `card:${TRI_CODE}`],
    setup: baseSetup("ffa4", {
      p0: { spells: [faceDown(TRI)], extra: [SYNCHRO, FUSION] }, p2: { extra: [SYNCHRO] }, p3: { extra: [FUSION, FUSION] },
    }),
    steps: [
      activate(TRI, "p0"),
      expectPickSeats(["p2", "p3"], "p0"),
      pickOpponent("p3", "p0"),
      choose("Fusion", "p0"),
      everySeat("ffa4", { p0: { lp: 8000, grave: [TRI] }, p1: { lp: 8000 }, p2: { lp: 8000 }, p3: { lp: 11000 } }),
    ],
  }),
  defineScenario({
    id: "lp-pair-tag-tri-and-guess-pick-from-opposing-team-team-recovers",
    title: "Tag: p0 (2 Synchro) activates Tri-and-Guess, the pick offers only p1 and p3 (the opposing team, not the partner p2), p3 (3 Synchro) is picked: the opposing team recovers 3000 on its shared LP",
    source: `${SOURCE} [R-TAG-PARTNER] the partner is never the picked opponent; [R-TAG-LP] the recovered LP goes to the team`,
    rules: ["R-TAG-PARTNER", "R-TAG-LP", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "opponent-pick", "lp", "tag", `card:${TRI_CODE}`],
    setup: baseSetup("tag", {
      p0: { spells: [faceDown(TRI)], extra: [SYNCHRO, SYNCHRO] }, p1: { extra: [SYNCHRO] }, p2: { extra: [SYNCHRO] }, p3: { extra: [SYNCHRO, SYNCHRO, SYNCHRO] },
    }),
    steps: [
      activate(TRI, "p0"),
      expectPickSeats(["p1", "p3"], "p0"),
      pickOpponent("p3", "p0"),
      choose("Synchro", "p0"),
      everySeat("tag", { p0: { lp: 16000, grave: [TRI] }, p1: { lp: 19000 }, p2: { lp: 16000 }, p3: { lp: 19000 } }),
    ],
  }),
  ...(["p0", "p1"] as Seat[]).map((holder) =>
    defineScenario({
      id: `lp-pair-tag-button-${holder}-both-teams-reach-zero-draw`,
      title: `Tag: ${holder} activates Self-Destruct Button with the team LP 1000 against 8000 (7000 or more below): both teams go to 0 LP together and the duel is a draw`,
      source: `${SOURCE} [R-TAG-LOSS] a team loses at 0 LP; both teams at once is a draw`,
      rules: ["R-TAG-LOSS", "R-COMMON-OPP-PICK"],
      tags: ["multiplayer", "lp", "tag", "draw", `card:${BUTTON_CODE}`],
      setup: baseSetup("tag", {
        [holder]: { lp: 1000, spells: [faceDown(BUTTON)] },
        [holder === "p0" ? "p1" : "p0"]: { lp: 8000 },
      }),
      steps: [
        ...(holder === "p1" ? [endTurn("p0")] : []),
        activate(BUTTON, holder),
        expectResult({ team: null, reason: "lp" }),
        expectLp({ team: 0 }, 0),
        expectLp({ team: 1 }, 0),
      ],
    }),
  ),
];
