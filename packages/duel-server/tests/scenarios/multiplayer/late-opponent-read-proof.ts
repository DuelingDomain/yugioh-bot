// C3: late opponent reads bind before cards; event reads and all/both reads keep their scope.
import {
  activate, announce, choose, defineScenario, endTurn, expectBoard, expectPickOptions,
  expectPickSeats, expectNoEvent, expectPrompt, pickOpponent, select, yes,
  type BoardExpect, type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";

type Format = "ffa3" | "ffa4" | "tag";
const FORMATS: Format[] = ["ffa3", "ffa4", "tag"];
const SEATS: DuelistId[] = ["p0", "p1", "p2", "p3"];
const ELF = "Mystical Elf";
const UTOPIA = "Number 39: Utopia";
const PEARL = "Gem-Knight Pearl";
const PAIR = "Pair Bear Scare!!";
const seats = (format: Format) => SEATS.slice(0, format === "ffa3" ? 3 : 4);
const opponents = (format: Format) => seats(format).filter(seat => format === "tag" ? seat === "p1" || seat === "p3" : seat !== "p0");

function fixture(format: Format): { setup: Scenario["setup"]; board: BoardExpect } {
  const setup: Scenario["setup"] = { format, deckSize: 4 };
  const board: BoardExpect = {};
  for (const seat of seats(format)) {
    setup[seat] = { deck: Array(4).fill(ELF), monsters: [ELF] };
    board[seat] = { lp: format === "tag" ? 16000 : 8000, hand: [], deckCount: 4,
      monsters: [ELF], spells: [], grave: [], banished: [], extra: [] };
  }
  return { setup, board };
}

function proof(format: Format, name: string, code: number, setup: Scenario["setup"], steps: Step[]): Scenario {
  return defineScenario({ id: `late-opponent-read-${format}-${name}`,
    title: `${format}: ${name}`, source: "Owner decisions 2026-10-02; docs/adr/0002-multiplayer-duel-rules.md",
    rules: name.includes("all-spell") ? ["R-COMMON-ALL-BOTH"] : ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "late-opponent-read", "opening-draw-skipped", format, `card:${code}`], setup, steps });
}

function extraDeckRead(format: Format, card: "Branded in Central Dogmatika" | "Dogmatikamatrix", code: number): Scenario {
  const { setup, board } = fixture(format);
  const last = seats(format).at(-1)!;
  for (const seat of seats(format)) {
    setup[seat]!.extra = [UTOPIA, PEARL];
    board[seat]!.extra = [UTOPIA, PEARL];
  }
  setup.p0!.spells = [card];
  board.p0!.spells = [card];
  board[last]!.extra = [PEARL];
  board[last]!.grave = [UTOPIA];
  const steps: Step[] = [];
  if (code === 14220547) {
    setup.p0!.hand = ["Black Illusion Ritual", "Relinquished", "Giant Rat"];
    board.p0!.monsters = [ELF, "Relinquished"];
    board.p0!.grave = ["Black Illusion Ritual", "Giant Rat"];
    steps.push(activate("Black Illusion Ritual", "p0"),
      expectPrompt({ kind: "sum" }), select("Giant Rat"), yes("p0"));
  } else {
    setup.p0!.monsters = ["White Knight of Dogmatika"];
    board.p0!.monsters = ["White Knight of Dogmatika"];
    steps.push(activate(card, "p0"));
  }
  steps.push(
    // Activation must declare before the chain resolves or exposes any Extra Deck.
    expectNoEvent({ kind: "chain-resolving", card: code }),
    expectPrompt({ by: "p0", kind: "choice", title: "Choose an opponent" }),
    expectPickSeats(opponents(format), "p0"), pickOpponent(last, "p0"),
  );
  steps.push(choose("opponent's Extra Deck", "p0"), expectPickOptions(
    [last].flatMap(seat => [{ seat, card: UTOPIA }, { seat, card: PEARL }]), "p0"),
    select({ card: UTOPIA, owner: last, from: "extra" }), expectPrompt({ by: "p0", context: "action" }), expectBoard(board));
  return proof(format, code === 14220547 ? "branded-binds-before-extra-deck-cards" : "matrix-binds-before-extra-deck-cards", code, setup, steps);
}

function gravekeeper(format: Format): Scenario {
  const card = "Gravekeeper's Trap";
  const { setup, board } = fixture(format);
  for (const seat of seats(format)) {
    setup[seat]!.hand = ["Sparks"];
    board[seat]!.hand = ["Sparks"];
  }
  setup.p0!.spells = [card];
  board.p0!.spells = [card];
  board.p1!.grave = [ELF];
  board.p1!.deckCount = 3;
  return proof(format, "gravekeeper-predraw-binds-turn-opponent", 98715423, setup, [
    endTurn("p0"), expectPrompt({ by: "p0", title: "Declare a card name" }), announce(ELF, "p0"),
    expectPrompt({ by: "p1", context: "action" }), expectBoard(board),
  ]);
}

function pairReturn(format: Format): Scenario {
  const { setup, board } = fixture(format);
  const last = seats(format).at(-1)!;
  setup.p0!.hand = ["Mystical Space Typhoon"];
  setup.p0!.spells = [{ card: PAIR, pos: "set" }];
  board.p0!.grave = ["Mystical Space Typhoon"];
  board[last]!.hand = [PAIR];
  return proof(format, "pair-bear-returns-to-declared-hand", 21501961, setup, [
    activate("Mystical Space Typhoon", "p0"), select({ card: PAIR, owner: "p0" }),
    expectPickSeats(opponents(format), "p0"), pickOpponent(last, "p0"),
    expectPrompt({ by: "p0", context: "action" }), expectBoard(board),
  ]);
}

function arms(format: Format): Scenario {
  const card = "Arms of Genex Return Zero";
  const { setup, board } = fixture(format);
  const last = seats(format).at(-1)!;
  setup.p0!.monsters = [card];
  setup.p0!.grave = ["Genex Controller"];
  board.p0!.monsters = [card];
  board.p0!.deckCount = 5;
  for (const seat of seats(format)) {
    setup[seat]!.spells = [{ card: "Burden of the Mighty", pos: "up" }];
    board[seat]!.spells = seat === last ? [] : ["Burden of the Mighty"];
  }
  board[last]!.grave = ["Burden of the Mighty"];
  return proof(format, "arms-all-spell-trap-zones-stay-broad", 61775475, setup, [
    activate(card, "p0"), select("Genex Controller"), yes("p0"),
    expectPickOptions(seats(format).map(seat => ({ seat, card: "Burden of the Mighty" })), "p0"),
    select({ card: "Burden of the Mighty", owner: last, from: "szone" }), expectPrompt({ by: "p0", context: "action" }), expectBoard(board),
  ]);
}

export const LATE_OPPONENT_READ_SCENARIOS = FORMATS.flatMap(format => [
  extraDeckRead(format, "Branded in Central Dogmatika", 14220547),
  extraDeckRead(format, "Dogmatikamatrix", 35569555), gravekeeper(format), pairReturn(format), arms(format),
]);

export function lateOpponentDomain(scenario: Scenario): Scenario {
  const format = scenario.setup.format as Format;
  return { ...scenario, id: `${scenario.id}-domain`, setup: { ...scenario.setup, mode: "domain",
    ...Object.fromEntries(seats(format).map(seat => [seat, { ...scenario.setup[seat], deckMaster: "Blue-Eyes White Dragon" }])) },
    steps: scenario.steps.map(step => step.op === "expectBoard" ? { ...step, board: Object.fromEntries(
      Object.entries(step.board).map(([seat, state]) => [seat, { ...state, deckMaster: { inZone: true, returns: 0, nextCost: 0 } }]),
    ) } : step) };
}

export const LATE_OPPONENT_DOMAIN_SCENARIOS = LATE_OPPONENT_READ_SCENARIOS.map(lateOpponentDomain);
// Root's newer Pair overlay already binds in its target. The old suffix is an
// explicit replay dependency for the operation-binding diagnostic regression.
export const LEGACY_PAIR_BEAR_SCENARIOS = LATE_OPPONENT_READ_SCENARIOS
  .filter(scenario => scenario.setup.format !== "tag" && scenario.tags.includes("card:21501961"))
  .flatMap(scenario => [scenario, lateOpponentDomain(scenario)])
  .map(scenario => ({ ...scenario, id: `${scenario.id}-legacy-overlay-replay` }));
