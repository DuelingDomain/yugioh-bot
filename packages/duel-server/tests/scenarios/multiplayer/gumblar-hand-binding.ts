import { activate, defineScenario, expectBoard, raw, zone, type BoardExpect, type DuelistId, type Scenario } from "../../support/dsl.js";
const SEATS: DuelistId[] = ["p0", "p1", "p2", "p3"];
const HANDS = ["Giant Rat", "Battle Ox", "Axe Raider", "Silver Fang"];
function gumblar(format: "1v1" | "ffa3" | "ffa4" | "tag", timing = false): Scenario {
  const count = format === "1v1" ? 2 : format === "ffa3" ? 3 : 4, last = SEATS[count - 1];
  const setup: Scenario["setup"] = { format, deckSize: 3 };
  const board: BoardExpect = {};
  for (let seat = 0; seat < count; seat++) {
    setup[SEATS[seat]] = { hand: [HANDS[seat]], monsters: ["Mystical Elf"], deck: Array<string>(3).fill("Mystical Elf") };
    board[SEATS[seat]] = { lp: format === "tag" ? 16000 : 8000, hand: [HANDS[seat]], monsters: ["Mystical Elf"], spells: [], grave: [], banished: [], extra: [], deckCount: 3 };
  }
  setup.p0!.monsters = [null, null, null, null, null, "Topologic Gumblar Dragon"];
  setup.p0!.hand!.push("Monster Reborn"); setup.p0!.grave = ["Mystical Elf"];
  setup[last]!.hand = [HANDS[count - 1], HANDS[count - 1]];
  board.p0!.monsters = ["Topologic Gumblar Dragon", "Mystical Elf"]; board.p0!.hand = []; board.p0!.grave = ["Monster Reborn", HANDS[0]];
  board[last]!.grave = [HANDS[count - 1]];
  return defineScenario({ id: `gumblar-hand-binding-${format}-${timing ? "activation-timing" : "hand-selection"}`, title: `${format}: Gumblar ${timing ? "binds before either hand is discarded" : "offers only the picked hand"}`, source: "docs/adr/0002-multiplayer-duel-rules.md", rules: ["R-COMMON-OPP-PICK", ...(format === "tag" ? ["R-TAG-SHARED-CARDS"] : [])], tags: ["multiplayer", "hand", "card:22593417", ...(timing ? ["picker-timing"] : []), format], setup, steps: [activate("Monster Reborn", "p0"), zone("p0", "s0", "p0"), zone("p0", "m1", "p0"), raw({ selected: ["card:0"] }, last), expectBoard(board)] });
}
export const GUMBLAR_HAND_BINDING_SCENARIOS: Scenario[] = [
  ...(["1v1", "ffa3", "ffa4", "tag"] as const).map(format => gumblar(format)),
  ...(["ffa3", "ffa4", "tag"] as const).map(format => gumblar(format, true)),
];
