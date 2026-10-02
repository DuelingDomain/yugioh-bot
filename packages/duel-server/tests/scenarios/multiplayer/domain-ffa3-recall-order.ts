import {
  activate, defineScenario, endTurn, expectBoard, expectEliminated,
  expectPrompt, expectTurn, no, normalSummon, yes, type BoardExpect, type Scenario,
} from "../../support/dsl.js";

const ELF = "Mystical Elf";
const MASTERS = { p0: "Axe Raider", p1: "Celtic Guardian", p2: "Battle Ox" } as const;
const SOURCE = "docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-SEP-FIELDS] [R-FFA-ORDER]";

function finalBoard(actor: "p0" | "p1", recalled: "p0" | "p2", refused: "p0" | "p2"): BoardExpect {
  const board: BoardExpect = {};
  for (const seat of ["p0", "p1", "p2"] as const) {
    const draws = seat === "p0" || (seat === "p1" && actor === "p1") ? 2 : 1;
    board[seat] = {
      lp: 8000,
      hand: Array.from({ length: draws }, () => ELF),
      deckCount: 20 - draws,
      monsters: [],
      spells: [],
      grave: [
        ...(seat === refused ? [MASTERS[seat]] : []),
        ...(seat === "p1" ? [ELF] : []),
        ...(seat === actor ? ["Dark Hole"] : []),
      ],
      banished: [],
      extra: [],
      deckMaster: {
        inZone: seat !== refused,
        returns: seat === recalled ? 1 : 0,
        nextCost: seat === recalled ? 500 : 0,
      },
    };
  }
  return board;
}

export const DOMAIN_FFA3_RECALL_ORDER_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "domain-ffa3-two-masters-recall-from-turn-player",
    title: "Domain FFA3: Dark Hole destroys two Deck Masters; p0 recalls before p2 refuses",
    source: SOURCE,
    rules: ["R-COMMON-SEP-FIELDS", "R-FFA-ORDER"],
    tags: ["multiplayer", "domain", "ffa3", "deck-master", "recall", "card:53129443"],
    setup: {
      mode: "domain",
      format: "ffa3",
      deckSize: 20,
      p0: { deckMaster: MASTERS.p0, hand: ["Dark Hole"] },
      p1: { deckMaster: MASTERS.p1, monsters: [ELF] },
      p2: { deckMaster: MASTERS.p2 },
    },
    steps: [
      normalSummon({ card: MASTERS.p0, from: "dmz" }, "p0"),
      endTurn("p0"),
      endTurn("p1"),
      normalSummon({ card: MASTERS.p2, from: "dmz" }, "p2"),
      endTurn("p2"),
      expectTurn("p0", 4),
      activate("Dark Hole", "p0"),
      expectPrompt({ by: "p0", context: "deck-master-recall" }),
      expectBoard({
        p0: { monsters: [], grave: [MASTERS.p0, "Dark Hole"], deckMaster: { inZone: false, returns: 0, nextCost: 0 } },
        p1: { monsters: [], grave: [ELF], deckMaster: { inZone: true, returns: 0, nextCost: 0 } },
        p2: { monsters: [], grave: [MASTERS.p2], deckMaster: { inZone: false, returns: 0, nextCost: 0 } },
      }),
      yes("p0"),
      expectPrompt({ by: "p2", context: "deck-master-recall" }),
      expectBoard({
        p0: { grave: ["Dark Hole"], deckMaster: { inZone: true, returns: 1, nextCost: 500 } },
        p1: { grave: [ELF], deckMaster: { inZone: true, returns: 0, nextCost: 0 } },
        p2: { grave: [MASTERS.p2], deckMaster: { inZone: false, returns: 0, nextCost: 0 } },
      }),
      no("p2"),
      expectPrompt({ by: "p0", context: "action" }),
      expectEliminated(),
      expectBoard(finalBoard("p0", "p0", "p2")),
    ],
  }),
  defineScenario({
    id: "domain-ffa3-two-masters-recall-wraps-from-p1",
    title: "Domain FFA3: on p1's turn, p2 recalls before p0 refuses after two Deck Masters leave together",
    source: SOURCE,
    rules: ["R-COMMON-SEP-FIELDS", "R-FFA-ORDER"],
    tags: ["multiplayer", "domain", "ffa3", "deck-master", "recall", "card:53129443"],
    setup: {
      mode: "domain",
      format: "ffa3",
      deckSize: 20,
      p0: { deckMaster: MASTERS.p0 },
      p1: { deckMaster: MASTERS.p1, monsters: [ELF], hand: ["Dark Hole"] },
      p2: { deckMaster: MASTERS.p2 },
    },
    steps: [
      normalSummon({ card: MASTERS.p0, from: "dmz" }, "p0"),
      endTurn("p0"),
      endTurn("p1"),
      normalSummon({ card: MASTERS.p2, from: "dmz" }, "p2"),
      endTurn("p2"),
      endTurn("p0"),
      expectTurn("p1", 5),
      activate("Dark Hole", "p1"),
      expectPrompt({ by: "p2", context: "deck-master-recall" }),
      expectBoard({
        p0: { monsters: [], grave: [MASTERS.p0], deckMaster: { inZone: false, returns: 0, nextCost: 0 } },
        p1: { monsters: [], grave: [ELF, "Dark Hole"], deckMaster: { inZone: true, returns: 0, nextCost: 0 } },
        p2: { monsters: [], grave: [MASTERS.p2], deckMaster: { inZone: false, returns: 0, nextCost: 0 } },
      }),
      yes("p2"),
      expectPrompt({ by: "p0", context: "deck-master-recall" }),
      expectBoard({
        p0: { grave: [MASTERS.p0], deckMaster: { inZone: false, returns: 0, nextCost: 0 } },
        p1: { grave: [ELF, "Dark Hole"], deckMaster: { inZone: true, returns: 0, nextCost: 0 } },
        p2: { grave: [], deckMaster: { inZone: true, returns: 1, nextCost: 500 } },
      }),
      no("p0"),
      expectPrompt({ by: "p1", context: "action" }),
      expectEliminated(),
      expectBoard(finalBoard("p1", "p2", "p0")),
    ],
  }),
];
