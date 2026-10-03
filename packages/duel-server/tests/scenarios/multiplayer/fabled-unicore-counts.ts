import { activate, attack, expectBoard, type BoardExpect, type DuelistId, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
const SEATS: DuelistId[] = ["p0", "p1", "p2", "p3"];
const HANDS = ["Giant Rat", "Battle Ox", "Axe Raider", "Silver Fang"];
function unicore(format: "1v1" | "ffa3" | "ffa4" | "tag", unequal = false): Scenario {
  const count = format === "1v1" ? 2 : format === "ffa3" ? 3 : 4;
  const last = SEATS[count - 1];
  const setup: Scenario["setup"] = { format, deckSize: 3, attackFirstTurn: true };
  const board: BoardExpect = {};
  for (let i = 0; i < count; i++) {
    setup[SEATS[i]] = { hand: [HANDS[i]], monsters: ["Mystical Elf"], deck: Array<string>(3).fill("Mystical Elf") };
    board[SEATS[i]] = { lp: format === "tag" ? 16000 : 8000, hand: [HANDS[i]], monsters: ["Mystical Elf"], spells: [], grave: [], banished: [], extra: [], deckCount: 3 };
  }
  setup.p0!.monsters = ["The Fabled Unicore"];
  board.p0!.monsters = ["The Fabled Unicore"];
  setup[last]!.monsters = [{ card: "Mystical Elf", pos: "def" }];
  setup[last]!.spells = [{ card: "Mirror Force", pos: "set" }];
  board[last]!.monsters = [];
  board[last]!.grave = ["Mirror Force", "Mystical Elf"];
  if (format === "tag") {
    setup.p3!.hand = unequal ? [HANDS[3]] : [];
    board.p3!.hand = unequal ? [HANDS[3]] : [];
    setup.p2!.hand = [HANDS[2], HANDS[2], HANDS[2]];
    board.p2!.hand = [HANDS[2], HANDS[2], HANDS[2]];
    if (unequal) {
      board.p0!.monsters = []; board.p0!.grave = ["The Fabled Unicore"];
      board.p2!.monsters = []; board.p2!.grave = ["Mystical Elf"];
      board.p3!.monsters = ["Mystical Elf"]; board.p3!.grave = ["Mirror Force"];
    }
  } else {
    for (let i = 1; i < count - 1; i++) {
      setup[SEATS[i]]!.hand = [HANDS[i], HANDS[i], HANDS[i]];
      board[SEATS[i]]!.hand = [HANDS[i], HANDS[i], HANDS[i]];
    }
  }
  if (format === "ffa3" || format === "ffa4") {
    // Standard skips the opening draw. Keep two cards explicitly so Unicore
    // compares equal with the responding opponent and still negates Mirror Force.
    setup.p0!.hand!.push("Mystical Elf");
    (board.p0!.hand as string[]).push("Mystical Elf");
    setup[last]!.hand = [HANDS[count - 1], HANDS[count - 1]];
    board[last]!.hand = [HANDS[count - 1], HANDS[count - 1]];
  }
  return defineScenario({
    id: `fabled-unicore-counts-${format}-${unequal ? "unequal-team-total" : "matching-count"}`,
    title: `${format}: Unicore ${unequal ? "does not negate when the opposing team has more cards" : "negates the effect with a matching opponent hand count"}`,
    source: "docs/adr/0002-multiplayer-duel-rules.md [Q2]", rules: ["R-COMMON-OPP-PICK", ...(format === "tag" ? ["R-TAG-SHARED-CARDS"] : [])],
    tags: ["multiplayer", "compare", "hand", "card:44155002", format], setup,
    steps: [attack("The Fabled Unicore", { card: "Mystical Elf", owner: last }, "p0"), activate("Mirror Force", last), expectBoard(board)],
  });
}
export const FABLED_UNICORE_COUNTS_SCENARIOS: Scenario[] = [
  ...(["1v1", "ffa3", "ffa4", "tag"] as const).map((format) => unicore(format)), unicore("tag", true),
];
