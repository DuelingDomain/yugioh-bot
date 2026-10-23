// Cards that compare or end the LP of "you and your opponent": Self-Destruct Button (57585212) and Tri-and-Guess (73988674).
//
// Self-Destruct Button: the FFA condition requires every living opponent to lead by 7000 or more (R-FFA-LP-COMPARE).
// Once legal, activation picks ONE opponent. You and that opponent lose together (R-COMMON-OPP-PICK, the duel-style reading Q4);
// every other seat plays on. In Tag the opposing team is the folded opponent, so both teams reach 0 LP together and the duel is a draw.
//
// Tri-and-Guess: "Each player confirms their Extra Deck, the one with more cards of the type that you named recovers 3000 LP". The activation picks
// ONE opponent (only an opponent that has an Extra Deck is offered, in Tag the pick is one of the opposing team); the owner of the
// card and that opponent confirm their Extra Decks to each other and compare the count of the named type. Every other seat is not involved.

import { activate, choose, endTurn, expectBoard, expectEliminated, expectLp, expectNotOffered, expectPickSeats, expectResult, faceDown, normalSummon, pickOpponent, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseSetup, everySeat, type Seat } from "./seat-kit.js";

const BUTTON = "Self-Destruct Button";
const BUTTON_CODE = 57585212;
const TRI = "Tri-and-Guess";
const TRI_CODE = 73988674;
const SYNCHRO = "Goyo Guardian";
const FUSION = "Elemental HERO Necroid Shaman";

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
    id: "lp-pair-ffa3-button-one-gap-too-small-cannot-activate",
    title: "FFA3: Self-Destruct Button cannot activate at 1000 LP against 2000/8000 LP: every living opponent must lead by at least 7000",
    source: `${SOURCE} [R-FFA-LP-COMPARE] the required 7000 LP gap must hold against every living opponent`,
    rules: ["R-FFA-LP-COMPARE"],
    tags: ["multiplayer", "opponent-pick", "lp", "ffa3", `card:${BUTTON_CODE}`],
    setup: baseSetup("ffa3", { p0: { lp: 1000, hand: ["Battle Ox"], spells: [faceDown(BUTTON)] }, p1: { lp: 2000 }, p2: { lp: 8000 } }),
    steps: [
      normalSummon("Battle Ox", "p0"),
      expectNotOffered("activate", BUTTON, "p0"),
      expectBoard({ p0: { monsters: ["Battle Ox"], spells: [BUTTON] } }),
      expectLp({ seat: "p0" }, 1000),
      expectLp({ seat: "p1" }, 2000),
      expectLp({ seat: "p2" }, 8000),
    ],
  }),
  defineScenario({
    id: "lp-pair-ffa4-button-one-gap-too-small-cannot-activate",
    title: "FFA4: Self-Destruct Button cannot activate at 1000 LP against 8000/2000/8000 LP: two qualifying opponents are insufficient",
    source: `${SOURCE} [R-FFA-LP-COMPARE] one living opponent below the required 7000 LP gap prevents activation`,
    rules: ["R-FFA-LP-COMPARE"],
    tags: ["multiplayer", "opponent-pick", "lp", "ffa4", `card:${BUTTON_CODE}`],
    setup: baseSetup("ffa4", { p0: { lp: 1000, hand: ["Battle Ox"], spells: [faceDown(BUTTON)] }, p1: { lp: 8000 }, p2: { lp: 2000 }, p3: { lp: 8000 } }),
    steps: [
      normalSummon("Battle Ox", "p0"),
      expectNotOffered("activate", BUTTON, "p0"),
      expectBoard({ p0: { monsters: ["Battle Ox"], spells: [BUTTON] } }),
      expectLp({ seat: "p0" }, 1000),
      expectLp({ seat: "p1" }, 8000),
      expectLp({ seat: "p2" }, 2000),
      expectLp({ seat: "p3" }, 8000),
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
