import {
  activate, defineScenario, eliminate, expectBoard, expectEliminated, expectNotOffered, expectPrompt,
  type BoardExpect, type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";

const CARD = "The Law of the Normal";
const SEATS: DuelistId[] = ["p0", "p1", "p2", "p3"];
type Format = "1v1" | "ffa3" | "ffa4" | "tag";
type Case = "all-hands" | "empty-other" | "empty-partner" | "no-own-card" | "no-opponent-card" | "lost-seat";

function law(format: Format, kind: Case): Scenario {
  const count = format === "1v1" ? 2 : format === "ffa3" ? 3 : 4;
  const positive = kind !== "no-own-card" && kind !== "no-opponent-card";
  const setup: Scenario["setup"] = { format, deckSize: 4 };
  const board: BoardExpect = {};
  for (let seat = 0; seat < count; seat++) {
    const hand = seat === 0 ? [CARD, ...(kind === "no-own-card" ? [] : ["Silver Fang"])]
      : kind === "empty-other" && seat === count - 1
        || kind === "empty-partner" && seat === 2
        || kind === "no-opponent-card" && (format !== "tag" || seat % 2 === 1) ? [] : ["Battle Ox"];
    setup[SEATS[seat]] = { hand, monsters: seat === 0 ? Array<string>(5).fill("Mokey Mokey") : ["Mystical Elf"] };
    board[SEATS[seat]] = {
      lp: format === "tag" ? 16000 : 8000, hand: positive ? [] : hand,
      monsters: seat === 0 ? Array<string>(5).fill("Mokey Mokey") : positive ? [] : ["Mystical Elf"],
      spells: [], grave: positive ? [...hand, ...(seat === 0 ? [] : ["Mystical Elf"])] : [],
      banished: [], extra: [], deckCount: 4,
    };
  }
  const steps: Step[] = [];
  if (kind === "lost-seat") {
    steps.push(eliminate("p3"));
    board.p3 = { lp: 8000, hand: [], monsters: [], spells: [], grave: [], banished: [], extra: [], deckCount: 0 };
  }
  steps.push(positive ? activate(CARD, "p0") : expectNotOffered("activate", CARD, "p0"),
    expectPrompt({ by: "p0", context: "action" }), ...(kind === "lost-seat" ? [expectEliminated("p3")] : []), expectBoard(board));
  return defineScenario({
    id: `law-normal-${format}-${kind}`, title: `${format}: Law of the Normal ${kind}`,
    source: "docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-EACH-PLAYER]; DECISIONS-2026-10-01.md, Owner answers 2026-10-02 (afternoon)",
    rules: positive ? ["R-COMMON-EACH-PLAYER", "R-COMMON-ALL-BOTH", ...(kind === "lost-seat" ? ["R-FFA-ELIMINATION"] : [])] : [],
    tags: ["multiplayer", "law-normal", "card:66926224", format], setup, steps,
  });
}

export const LAW_NORMAL_EMPTY_HANDS_SCENARIOS: Scenario[] = [
  ...(["1v1", "ffa3", "ffa4", "tag"] as const).flatMap((format) =>
    (["all-hands", "no-own-card", "no-opponent-card"] as const).map((kind) => law(format, kind))),
  law("ffa3", "empty-other"), law("ffa4", "empty-other"), law("tag", "empty-other"),
  law("tag", "empty-partner"), law("ffa4", "lost-seat"),
];
