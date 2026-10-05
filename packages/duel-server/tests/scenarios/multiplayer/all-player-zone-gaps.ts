import { activate, endTurn, expectBoard, expectPrompt, no, yes,
  type BoardExpect, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { domainVariant } from "./domain-variants.js";

type Format = "1v1" | "ffa3" | "ffa4" | "tag";
type Kind = "gnomes" | "circle" | "albalos" | "card-destruction" | "hand-destruction";
const SEATS: DuelistId[] = ["p0", "p1", "p2", "p3"];
const HANDS = ["Giant Rat", "Battle Ox", "Axe Raider", "Silver Fang"];
const CODES: Record<Kind, number> = {
  gnomes: 164710, circle: 73443672, albalos: 69120785, "card-destruction": 72892473, "hand-destruction": 74519184,
};

function zoneGap(kind: Kind, format: Format): Scenario {
  const count = format === "1v1" ? 2 : format === "ffa3" ? 3 : 4;
  const setup: Scenario["setup"] = { format, deckSize: 2 };
  const board: BoardExpect = {};
  const steps: Step[] = [];
  for (let i = 0; i < count; i++) {
    const seat = SEATS[i];
    setup[seat] = { hand: [HANDS[i]], monsters: ["Mystical Elf"], deck: [HANDS[i], HANDS[i]] };
    board[seat] = {
      lp: format === "tag" ? 16000 : 8000, hand: [HANDS[i]], monsters: ["Mystical Elf"],
      spells: [], grave: [], banished: [], deckCount: 2,
    };
  }
  if (kind === "gnomes") {
    setup.p0!.spells = [{ card: "Mischief of the Gnomes", pos: "set" }];
    board.p0!.grave = ["Mischief of the Gnomes"];
    steps.push(activate("Mischief of the Gnomes", "p0"));
  } else if (kind === "card-destruction" || kind === "hand-destruction") {
    const action = kind === "card-destruction" ? "Card Destruction" : "Hand Destruction";
    setup.deckSize = 4;
    for (let i = 0; i < count; i++) {
      setup[SEATS[i]]!.hand = [HANDS[i], HANDS[i], ...(i === 0 ? [action] : [])];
      setup[SEATS[i]]!.deck = Array<string>(4).fill("Mystical Elf");
      board[SEATS[i]]!.hand = ["Mystical Elf", "Mystical Elf"];
      board[SEATS[i]]!.deckCount = 2;
      board[SEATS[i]]!.grave = [HANDS[i], HANDS[i], ...(i === 0 ? [action] : [])];
    }
    steps.push(activate(action, "p0"));
  } else if (kind === "circle") {
    setup.p0!.hand!.push("Underworld Circle");
    board.p0!.spells = ["Underworld Circle"];
    for (let i = 0; i < count; i++) {
      setup[SEATS[i]]!.grave = Array<string>(5).fill("Mystical Elf");
      setup[SEATS[i]]!.deck = ["Mystical Elf", "Mystical Elf"];
      board[SEATS[i]]!.monsters = [];
      board[SEATS[i]]!.grave = Array<string>(6).fill("Mystical Elf");
      board[SEATS[i]]!.banished = ["Mystical Elf", "Mystical Elf"];
      board[SEATS[i]]!.deckCount = 0;
    }
    // Own-GY yes/no is not an opponent declaration.
    steps.push(activate("Underworld Circle", "p0"),
      expectPrompt({ by: "p0", kind: "choice", title: "Special Summon 1 Normal Monster from your GY?" }),
      no("p0"), expectPrompt({ by: "p0", context: "action" }));
  } else {
    setup.p0!.monsters = ["The Bystial Alba Los"];
    setup.p1!.hand!.push("Dark Hole");
    for (let i = 0; i < count; i++) {
      setup[SEATS[i]]!.extra = ["Number 39: Utopia"];
      board[SEATS[i]]!.extra = [];
      board[SEATS[i]]!.monsters = [];
      board[SEATS[i]]!.banished = ["Number 39: Utopia"];
      board[SEATS[i]]!.grave = [i === 0 ? "The Bystial Alba Los" : "Mystical Elf"];
    }
    board.p1!.hand = [HANDS[1], HANDS[1]];
    board.p1!.deckCount = 1;
    board.p1!.grave = ["Mystical Elf", "Dark Hole"];
    steps.push(endTurn("p0"), activate("Dark Hole", "p1"), yes("p0"));
  }
  steps.push(expectBoard(board));
  return defineScenario({
    id: `all-player-zone-gaps-${kind}-${format}`,
    title: `${format}: ${kind} affects every living duelist`,
    source: "docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-EACH-PLAYER]",
    rules: ["R-COMMON-EACH-PLAYER"], tags: ["multiplayer", "all-player-zone-gaps", `card:${CODES[kind]}`, format],
    setup, steps,
  });
}

export const ALL_PLAYER_ZONE_GAPS_SCENARIOS: Scenario[] = [
  ...(["gnomes", "circle", "albalos"] as const).flatMap((kind) =>
    (["1v1", "ffa3", "ffa4", "tag"] as const).map((format) => zoneGap(kind, format))),
  ...(["card-destruction", "hand-destruction"] as const).flatMap((kind) =>
    (["1v1", "tag"] as const).map((format) => zoneGap(kind, format))),
];

// Multiplayer Domain draws one Deck monster before Circle banishes the remaining monster.
// In 1v1 Domain both monsters stay in the Deck for Circle to banish.
for (const format of ["1v1", "ffa3", "ffa4", "tag"] as const) {
  const scenario = structuredClone(zoneGap("circle", format));
  const final = scenario.steps.find((step) => step.op === "expectBoard");
  if (final?.op !== "expectBoard") throw new Error("Circle needs a final board check");
  if (format !== "1v1") final.board.p0!.banished = ["Mystical Elf"];
  ALL_PLAYER_ZONE_GAPS_SCENARIOS.push(domainVariant(scenario));
}
