import { activate, defineScenario, endTurn, expectBoard, expectPickOptions, pickOpponent, select, yes, type BoardExpect, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";

const CARD = "Pair Bear Scare!!";
const SEATS: DuelistId[] = ["p0", "p1", "p2", "p3"];
type Format = "ffa3" | "ffa4" | "tag";

function pairBear(format: Format, effect: "reveal" | "return", actor: 0 | 1): Scenario {
  const n = format === "ffa3" ? 3 : 4;
  const holder = SEATS[actor]!;
  const recipient = SEATS[format === "tag" && actor === 1 ? 2 : n - 1]!;
  const setup: Scenario["setup"] = { format, deckSize: 4 };
  const board: BoardExpect = {};
  for (let i = 0; i < n; i++) {
    const hand = ["Beaver Warrior"];
    setup[SEATS[i]!] = { hand, deck: ["Mystical Elf", "Mystical Elf", "Mystical Elf", "Mystical Elf"] };
    board[SEATS[i]!] = { lp: format === "tag" ? 16000 : 8000, hand: [...hand], deckCount: 4, monsters: [], spells: [], grave: [], banished: [], extra: [] };
  }
  setup[holder]!.spells = [{ card: CARD, pos: "set" }];
  const steps: Step[] = [];
  if (format !== "tag") {
    (board.p0!.hand as string[]).push("Mystical Elf");
    board.p0!.deckCount = 3;
  }
  if (actor === 1) {
    steps.push(endTurn("p0"));
    (board.p1!.hand as string[]).push("Mystical Elf");
    board.p1!.deckCount = 3;
  }
  if (effect === "reveal") {
    setup[recipient]!.hand = [CARD, "Beaver Warrior"];
    setup[recipient]!.deck = [CARD, "Mystical Elf", "Mystical Elf", "Mystical Elf"];
    board[recipient]!.hand = [CARD, "Beaver Warrior"];
    steps.push(activate(CARD, holder), pickOpponent(recipient, holder), yes(recipient), select({ card: CARD, owner: recipient, from: "hand" }));
    for (const seat of SEATS.slice(0, n)) board[seat]!.lp! += format === "tag" ? 4000 : 2000;
    board[holder]!.grave = [CARD];
  } else {
    setup[holder]!.hand = ["Mystical Space Typhoon", "Beaver Warrior"];
    steps.push(activate("Mystical Space Typhoon", holder), select({ card: CARD, owner: holder }),
      expectPickOptions(SEATS.slice(0, n).filter(seat => format === "tag" ? Number(seat[1]) % 2 !== actor % 2 : seat !== holder).map(seat => ({ seat })), holder),
      pickOpponent(recipient, holder));
    board[holder]!.grave = ["Mystical Space Typhoon"];
    (board[recipient]!.hand as string[]).push(CARD);
  }
  steps.push(expectBoard(board));
  return defineScenario({
    id: `pair-bear-binding-${format}-${effect}-p${actor}`,
    title: `${CARD}: ${effect === "reveal" ? "the selected opponent reveals one copy and every seat gains LP" : "the owner selects the opponent before the card returns to that hand"}`,
    source: "docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-OPP-PICK, R-COMMON-EACH-PLAYER]",
    rules: effect === "reveal" ? ["R-COMMON-OPP-PICK", "R-COMMON-EACH-PLAYER"] : ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "pair-bear-binding", "card:21501961", format], setup, steps,
  });
}

export const PAIR_BEAR_BINDING_SCENARIOS = (["ffa3", "ffa4", "tag"] as const)
  .flatMap(format => (["reveal", "return"] as const).flatMap(effect => [pairBear(format, effect, 0), pairBear(format, effect, 1)]));
