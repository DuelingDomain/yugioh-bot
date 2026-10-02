import {
  activate, attack, defineScenario, endTurn, expectBoard, yes,
  type BoardExpect, type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";

type Format = "1v1" | "ffa3" | "ffa4" | "tag";
type Kind = "crossout" | "extermination" | "tempest";
const SEATS: DuelistId[] = ["p0", "p1", "p2", "p3"];
const HANDS = ["Giant Rat", "Battle Ox", "Axe Raider", "Silver Fang"];
const CODES: Record<Kind, number> = { crossout: 71044499, extermination: 17449108, tempest: 14391920 };

function allDecks(kind: Kind, format: Format): Scenario {
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
  if (kind !== "tempest") {
    const action = kind === "crossout" ? "Nobleman of Crossout" : "Nobleman of Extermination";
    const target = kind === "crossout" ? "Hane-Hane" : "Mirror Force";
    setup.p0!.hand!.push(action);
    for (let i = 0; i < count; i++) {
      setup[SEATS[i]]!.deck = [target, "Raigeki"];
      board[SEATS[i]]!.banished = [target];
      board[SEATS[i]]!.deckCount = 1;
    }
    if (kind === "crossout") {
      setup.p1!.monsters = [{ card: target, pos: "set" }];
      board.p1!.monsters = [];
    } else {
      setup.p1!.spells = [{ card: target, pos: "set" }];
    }
    board.p1!.banished = [target, target];
    board.p0!.grave = [action];
    steps.push(activate(action, "p0"));
  } else {
    setup.deckSize = 6;
    setup.p0!.monsters = ["Blue-Eyes White Dragon"];
    setup.p1!.monsters = [];
    setup.p1!.spells = [{ card: "Inferno Tempest", pos: "set" }];
    for (let i = 0; i < count; i++) {
      setup[SEATS[i]]!.deck = Array<string>(6).fill(HANDS[i]);
      setup[SEATS[i]]!.grave = ["Mystical Elf"];
      board[SEATS[i]]!.hand = [HANDS[i], HANDS[i]];
      board[SEATS[i]]!.deckCount = 0;
      board[SEATS[i]]!.banished = [...Array<string>(5).fill(HANDS[i]), "Mystical Elf"];
      steps.push(endTurn(SEATS[i]));
    }
    board.p0!.monsters = ["Blue-Eyes White Dragon"];
    board.p1!.monsters = [];
    board.p1!.grave = ["Inferno Tempest"];
    board.p1!.lp = format === "tag" ? 13000 : 5000;
    if (format === "tag") board.p3!.lp = 13000;
    steps.push(attack("Blue-Eyes White Dragon", "direct", "p0"));
    if (format !== "1v1") steps.push(yes("p0"));
    steps.push(activate("Inferno Tempest", "p1"));
  }
  if (format === "ffa3" || format === "ffa4") {
    if (kind === "tempest") {
      board.p0!.hand = [HANDS[0], HANDS[0], HANDS[0]];
      board.p0!.banished = [...Array<string>(4).fill(HANDS[0]), "Mystical Elf"];
    } else {
      board.p0!.hand = [HANDS[0], kind === "crossout" ? "Hane-Hane" : "Mirror Force"];
      board.p0!.banished = [];
    }
  }
  steps.push(expectBoard(board));
  return defineScenario({
    id: `all-player-decks-${kind}-${format}`,
    title: `${format}: ${kind} affects every living Deck, including the Tag partner`,
    source: "docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-EACH-PLAYER]",
    rules: ["R-COMMON-EACH-PLAYER"], tags: ["multiplayer", "all-player-decks", `card:${CODES[kind]}`, format],
    setup, steps,
  });
}

export const ALL_PLAYER_DECKS_SCENARIOS: Scenario[] = (["crossout", "extermination", "tempest"] as const).flatMap((kind) =>
  (["1v1", "ffa3", "ffa4", "tag"] as const).map((format) => allDecks(kind, format)));
