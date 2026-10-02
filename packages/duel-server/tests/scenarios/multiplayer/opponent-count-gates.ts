import { activate, defineScenario, expectBoard, expectNotOffered, pickOpponent, select, specialSummon, type BoardExpect, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";
const SEATS: DuelistId[] = ["p0", "p1", "p2", "p3"];
const HANDS = ["Giant Rat", "Battle Ox", "Axe Raider", "Silver Fang"];
export const COUNT_GATE_CARDS = { cannons: 25096909, linkerbell: 54635100, pendransaction: 58720904, asset: 98520301 } as const;
export type CountGate = keyof typeof COUNT_GATE_CARDS;
const NAMES = { cannons: "Simultaneous Equation Cannons", linkerbell: "Linkerbell", pendransaction: "Pendransaction", asset: "Asset Mountis" };
function countGate(kind: CountGate, format: "1v1" | "ffa3" | "ffa4" | "tag", noOpponent = false): Scenario {
  const count = format === "1v1" ? 2 : format === "ffa3" ? 3 : 4;
  const last = SEATS[count - 1], lp = format === "tag" ? 16000 : 8000;
  const setup: Scenario["setup"] = { format, deckSize: 3 };
  const board: BoardExpect = {};
  const steps: Step[] = [];
  for (let i = 0; i < count; i++) {
    setup[SEATS[i]] = { hand: [HANDS[i]], monsters: ["Mystical Elf"], deck: Array<string>(3).fill("Mystical Elf") };
    board[SEATS[i]] = { lp, hand: [HANDS[i]], monsters: ["Mystical Elf"], spells: [], grave: [], banished: [], extra: [], deckCount: 3 };
  }
  if (kind === "cannons") {
    const xyz = format === "1v1" ? "Number 39: Utopia Roots" : "Number 39: Utopia";
    setup.p0!.spells = [{ card: NAMES[kind], pos: "set" }];
    setup.p0!.extra = [xyz, xyz, noOpponent ? "Giltia the D. Knight" : "Karbonala Warrior"];
    for (let i = 0; i < count; i++) {
      const hand = Array<string>(i === 0 ? (count === 3 ? 2 : 1) : count === 3 ? 3 : 2).fill(HANDS[i]);
      setup[SEATS[i]]!.hand = hand;
      board[SEATS[i]]!.hand = hand;
    }
    if (noOpponent) { board.p0!.spells = [NAMES[kind]]; board.p0!.extra = setup.p0!.extra; }
    else { board.p0!.grave = [NAMES[kind]]; board.p0!.banished = setup.p0!.extra; steps.push(activate(NAMES[kind], "p0"), ...(format === "1v1" ? [] : [pickOpponent(last, "p0")]), select(...setup.p0!.extra)); }
  } else if (kind === "linkerbell") {
    const materials = ["Mystical Elf", "Giant Rat"];
    setup.p0!.monsters = materials;
    setup.p0!.extra = [NAMES[kind], ...Array<string>(3).fill("Number 39: Utopia")];
    for (let i = 1; i < count; i++) {
      setup[SEATS[i]]!.extra = Array<string>(i === count - 1 && !noOpponent ? 1 : 2).fill("Number 39: Utopia");
      board[SEATS[i]]!.extra = setup[SEATS[i]]!.extra;
    }
    if (noOpponent) { board.p0!.monsters = materials; board.p0!.extra = setup.p0!.extra; }
    else { board.p0!.monsters = [NAMES[kind]]; board.p0!.grave = materials; board.p0!.extra = Array<string>(3).fill("Number 39: Utopia"); steps.push(specialSummon(NAMES[kind], "p0"), select({ card: "Mystical Elf", owner: "p0" }, { card: "Giant Rat", owner: "p0" })); }
  } else if (kind === "pendransaction") {
    setup.p0!.monsters = [{ card: NAMES[kind], materials: ["Mystical Elf"] }];
    setup.p0!.extra = Array<string>(2).fill("Number 39: Utopia");
    board.p0!.monsters = [NAMES[kind]]; board.p0!.extra = setup.p0!.extra;
    for (let i = 1; i < count; i++) {
      setup[SEATS[i]]!.extra = Array<string>(i === count - 1 && !noOpponent ? 1 : 5).fill("Number 39: Utopia");
      board[SEATS[i]]!.extra = setup[SEATS[i]]!.extra;
    }
    if (!noOpponent) { board.p0!.grave = ["Mystical Elf"]; steps.push(activate(NAMES[kind], "p0")); }
  } else {
    setup.p0!.monsters = [NAMES[kind]]; board.p0!.monsters = [NAMES[kind]];
    const hand = Array<string>(format === "tag" && !noOpponent ? 9 : 3).fill(HANDS[0]);
    setup.p0!.hand = hand; board.p0!.hand = hand;
    for (let i = 1; i < count; i++) {
      const otherHand = Array<string>(i === count - 1 && !noOpponent ? 1 : 6).fill(HANDS[i]);
      setup[SEATS[i]]!.hand = otherHand; board[SEATS[i]]!.hand = otherHand;
    }
    if (!noOpponent) steps.push(activate(NAMES[kind], "p0"));
  }
  if (noOpponent) steps.push(expectNotOffered(kind === "linkerbell" ? "specialSummon" : "activate", NAMES[kind], "p0"));
  steps.push(expectBoard(board));
  return defineScenario({ id: `opponent-count-gates-${kind}-${format}-${noOpponent ? "no-eligible-opponent" : "late-eligible-opponent"}`, title: `${format}: ${NAMES[kind]} ${noOpponent ? "has no eligible opponent" : "uses the eligible later opponent"}`, source: "docs/adr/0002-multiplayer-duel-rules.md [Q2] [R-COMMON-EACH-PLAYER]", ...(noOpponent ? {} : { rules: ["R-COMMON-OPP-PICK", ...(kind === "cannons" ? ["R-COMMON-EACH-PLAYER"] : []), ...(format === "tag" ? ["R-TAG-SHARED-CARDS"] : [])] }), tags: ["multiplayer", "compare", `card:${COUNT_GATE_CARDS[kind]}`, kind, ...(noOpponent ? ["negative-count"] : []), format], setup, steps });
}
export const OPPONENT_COUNT_GATES_SCENARIOS: Scenario[] = Object.keys(COUNT_GATE_CARDS).flatMap((kind) => [
  ...(["1v1", "ffa3", "ffa4", "tag"] as const).map((format) => countGate(kind as CountGate, format)),
  ...(["ffa3", "ffa4", "tag"] as const).map((format) => countGate(kind as CountGate, format, true)),
]);
