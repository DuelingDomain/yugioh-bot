import { activate, changePhase, defineScenario, expectBoard, expectNoEvent, expectPickOptions, pickOpponent, type BoardExpect, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";
const SEATS: DuelistId[] = ["p0", "p1", "p2", "p3"];
const HANDS = ["Giant Rat", "Battle Ox", "Axe Raider", "Silver Fang"];
function banquet(format: "1v1" | "ffa3" | "ffa4" | "tag"): Scenario {
  const count = format === "1v1" ? 2 : format === "ffa3" ? 3 : 4, last = SEATS[count - 1];
  const setup: Scenario["setup"] = { format, deckSize: 3 };
  const board: BoardExpect = {};
  for (let seat = 0; seat < count; seat++) {
    setup[SEATS[seat]] = { hand: [HANDS[seat]], monsters: ["Mystical Elf"], deck: Array<string>(3).fill("Mystical Elf"), extra: [seat === 0 ? "Number 39: Utopia" : "Karbonala Warrior"] };
    board[SEATS[seat]] = { lp: format === "tag" ? 16000 : 8000, hand: [HANDS[seat]], monsters: ["Mystical Elf"], spells: [], grave: [], banished: [], extra: seat === 0 ? [] : ["Karbonala Warrior"], deckCount: 3 };
  }
  setup.p0!.spells = [{ card: "Banquet of Millions", pos: "set" }];
  board.p0!.grave = ["Banquet of Millions"]; board.p0!.banished = ["Number 39: Utopia"];
  const during = structuredClone(board); during[last]!.extra = []; during[last]!.banished = ["Karbonala Warrior"];
  board.p1!.hand = [HANDS[1], "Mystical Elf"]; board.p1!.deckCount = 2;
  const before = structuredClone(during);
  for (const seat of SEATS.slice(0,count)) {
    before[seat]!.extra = [seat === "p0" ? "Number 39: Utopia" : "Karbonala Warrior"];
    before[seat]!.grave = []; before[seat]!.banished = [];
  }
  before.p0!.spells = ["Banquet of Millions"];
  const steps: Step[] = [activate("Banquet of Millions", "p0")];
  if (format !== "1v1") steps.push(
    expectBoard(before), expectNoEvent({kind:"chain-resolving",card:"Banquet of Millions"}),
    expectPickOptions(SEATS.slice(0,count).filter(seat => format === "tag" ? Number(seat[1]) % 2 === 1 : seat !== "p0").map(seat => ({seat})),"p0"),
    pickOpponent(last,"p0"),
  );
  steps.push(expectBoard(during), changePhase("end", "p0"), expectBoard(board));
  return defineScenario({
    id: `banquet-return-owner-${format}`, title: `${format}: the temporarily banished Extra card returns to its real owner`,
    source: "docs/adr/0002-multiplayer-duel-rules.md", rules: ["R-COMMON-OPP-PICK", ...(format === "tag" ? ["R-TAG-SHARED-CARDS"] : [])],
    tags: ["multiplayer", "temporary-banish", "card:48814566", format], setup, steps,
  });
}
export const BANQUET_RETURN_OWNER_SCENARIOS: Scenario[] = (["1v1", "ffa3", "ffa4", "tag"] as const).map(banquet);
