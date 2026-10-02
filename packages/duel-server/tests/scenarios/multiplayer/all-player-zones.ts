// Each action checks the hand, field, GY, banished zone, Deck count and LP of every seat.
// Collect all cards before one simultaneous send or banish action.
import {
  activate, defineScenario, eliminate, expectBoard, expectEliminated, select, specialSummon,
  type BoardExpect, type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";

type Format = "1v1" | "ffa3" | "ffa4" | "tag";
type Kind = "neo" | "norleras" | "sophia" | "law";
const SEATS: DuelistId[] = ["p0", "p1", "p2", "p3"];
const HANDS = ["Giant Rat", "Battle Ox", "Axe Raider", "Silver Fang"];
const FIELDS = ["Mystical Elf", "Battle Ox", "Axe Raider", "Silver Fang"];
const CODES: Record<Kind, number> = { neo: 10485110, norleras: 48453776, sophia: 4335427, law: 66926224 };
const NAMES: Record<Kind, string> = {
  neo: "Ocean Dragon Lord - Neo-Daedalus", norleras: "Sky Scourge Norleras",
  sophia: "Sophia, Goddess of Rebirth", law: "The Law of the Normal",
};

function allHands(kind: Kind, format: Format, lost = false): Scenario {
  const count = format === "1v1" ? 2 : format === "ffa3" ? 3 : 4;
  const setup: Scenario["setup"] = { format, deckSize: 2 };
  const board: BoardExpect = {};
  for (let i = 0; i < count; i++) {
    const seat = SEATS[i];
    setup[seat] = { hand: [HANDS[i]], monsters: [FIELDS[i]], deck: ["Mystical Elf", "Mystical Elf"] };
    board[seat] = {
      lp: format === "tag" ? 16000 : 8000, hand: [], monsters: [], spells: [],
      grave: [HANDS[i], FIELDS[i]], banished: [], deckCount: 2,
    };
  }
  const own = setup.p0!;
  const expected = board.p0!;
  const name = NAMES[kind];
  const steps: Step[] = lost ? [eliminate("p3")] : [];
  if (kind === "neo") {
    own.monsters = [name];
    own.field = "Umi";
    steps.push(activate(name, "p0"));
    expected.monsters = [name];
    expected.grave = [HANDS[0], "Umi"];
  } else if (kind === "norleras") {
    own.monsters = [name];
    steps.push(activate(name, "p0"));
    expected.grave = [HANDS[0], name];
    expected.hand = ["Mystical Elf"];
    expected.deckCount = 1;
    expected.lp = format === "tag" ? 15000 : 7000;
    if (format === "tag") board.p2!.lp = 15000;
  } else if (kind === "law") {
    own.monsters = Array<string>(5).fill("Mokey Mokey");
    own.hand!.push(name);
    steps.push(activate(name, "p0"));
    expected.monsters = Array<string>(5).fill("Mokey Mokey");
    expected.grave = [HANDS[0], name];
  } else {
    own.hand!.push(name);
    const materials = ["Black Luster Soldier", "Blue-Eyes Ultimate Dragon", "Stardust Dragon", "Number 39: Utopia"];
    own.monsters = materials;
    steps.push(specialSummon(name, "p0"), select(...materials));
    expected.monsters = [name];
    expected.grave = [];
    expected.banished = [HANDS[0], ...materials];
    for (let i = 1; i < count; i++) {
      board[SEATS[i]]!.banished = [HANDS[i], FIELDS[i]];
      board[SEATS[i]]!.grave = [];
    }
  }
  if (format === "ffa3" || format === "ffa4") {
    expected.deckCount!--;
    if (kind === "sophia") (expected.banished as string[]).push("Mystical Elf");
    else (expected.grave as string[]).push("Mystical Elf");
  }
  if (lost) {
    board.p3 = { lp: 8000, hand: [], monsters: [], spells: [], grave: [], banished: [], deckCount: 0 };
    steps.push(expectEliminated("p3"));
  }
  steps.push(expectBoard(board));
  return defineScenario({
    id: `all-player-zones-${kind}-${format}${lost ? "-eliminated-seat" : ""}`,
    title: `${format}: ${name} affects every living hand${lost ? ", and skips p3" : ""}`,
    source: "docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-EACH-PLAYER], [R-FFA-ELIMINATION]",
    rules: ["R-COMMON-EACH-PLAYER", ...(lost ? ["R-FFA-ELIMINATION"] : [])],
    tags: ["multiplayer", "all-player-zones", `card:${CODES[kind]}`, format], setup, steps,
  });
}

export const ALL_PLAYER_ZONES_SCENARIOS: Scenario[] = (["neo", "norleras", "sophia", "law"] as const).flatMap((kind) => [
  ...(["1v1", "ffa3", "ffa4", "tag"] as const).map((format) => allHands(kind, format)),
  allHands(kind, "ffa4", true),
]);
