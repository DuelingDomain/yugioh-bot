// Each duelist selects from its own GY or banishment. Tag includes the partner.
import {
  activate, attack, endTurn, expectBoard, expectPickOptions, expectTurn, select, zone,
  type BoardExpect, type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";

type Format = "ffa3" | "ffa4" | "tag";
const PAIRS = [
  ["Celtic Guardian", "Beaver Warrior"], ["Battle Ox", "Axe Raider"],
  ["Silver Fang", "Giant Soldier of Stone"], ["Mystical Elf", "Neo the Magic Swordsman"],
];
const CARDS = [
  [43434803, "The Shallow Grave"],
  [84136000, "The Grave of Enkindling"], [39900763, "Different Dimension Encounter"],
] as const;
const seat = (n: number) => `p${n}` as DuelistId;

function revival(format: Format, actor: 0 | 1, code: number, card: string): Scenario {
  const n = format === "ffa3" ? 3 : 4;
  const battle = code === 84136000;
  const banished = code === 39900763;
  const attacker = actor === 0 ? 1 : 0;
  const setup: Scenario["setup"] = { format };
  const board: BoardExpect = {};
  for (let i = 0; i < n; i++) {
    setup[seat(i)] = {
      ...(banished ? { banished: PAIRS[i] } : { grave: PAIRS[i] }),
      ...(i === actor ? (battle ? { monsters: ["Giant Rat"], spells: [{ card, pos: "set" }] }
        : banished ? { spells: [{ card, pos: "set" }] } : { hand: [card] }) : {}),
      ...(battle && i === attacker ? { monsters: ["Luster Dragon"] } : {}),
    };
    board[seat(i)] = {
      lp: format === "tag" ? 16000 : 8000, hand: [], monsters: [PAIRS[i][0]], spells: [],
      grave: banished ? [] : [PAIRS[i][1]], banished: banished ? [PAIRS[i][1]] : [],
    };
  }
  const steps: Step[] = [];
  if (!battle && actor === 1) {
    steps.push(endTurn("p0"));
    if (!banished) {
      steps.push(expectTurn("p1"));
      board.p1!.hand = ["Mystical Elf"];
    }
  }
  if (battle) {
    const turns = actor === 0 ? n + 1 : n;
    for (let i = 0; i < turns; i++) steps.push(endTurn(seat(i % n)));
    steps.push(attack("Luster Dragon", { card: "Giant Rat", owner: seat(actor) }, seat(attacker)));
    for (let i = 0; i < n; i++) {
      board[seat(i)]!.hand = { count: actor === 0 && i === attacker ? 2 : 1 };
      if (format === "tag" ? i % 2 === actor : i === actor) board[seat(i)]!.lp! -= 500;
    }
    board[seat(attacker)]!.monsters = ["Luster Dragon", PAIRS[attacker][0]];
    board[seat(actor)]!.grave = [PAIRS[actor][1], "Giant Rat", card];
  } else {
    board[seat(actor)]!.grave = [...(banished ? [] : [PAIRS[actor][1]]), card];
  }
  steps.push(activate(card, seat(actor)));
  if (!battle && !banished) steps.push(zone(seat(actor), "s0", seat(actor)));
  for (let k = 0; k < n; k++) {
    const i = (actor + k) % n;
    steps.push(expectPickOptions([
      ...PAIRS[i].map(name => ({ seat: seat(i), card: name })),
      ...(battle && i === actor ? [{ seat: seat(i), card: "Giant Rat" }] : []),
    ], seat(i)), select(PAIRS[i][0]));
    if (banished) steps.push(zone(seat(i), "m0", seat(i)));
  }
  steps.push(expectBoard(board));
  return defineScenario({
    id: `each-duelist-revival-${format}-p${actor}-${code}`,
    title: `${card}: every duelist selects its own monster and summons to its own field`,
    source: `${SOURCE} [R-COMMON-EACH-PLAYER]`, rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "each-duelist-revival", format, `card:${code}`], setup, steps,
  });
}

export const EACH_DUELIST_REVIVAL_SCENARIOS: Scenario[] = CARDS.flatMap(([code, card]) => [
  revival("ffa3", 0, code, card), revival("ffa4", 0, code, card),
  revival("tag", 0, code, card), revival("tag", 1, code, card),
]);
