import {
  changePosition, endTurn, expectBoard, expectPickOptions, select, yes,
  type BoardExpect, type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";

type Format = "ffa3" | "ffa4" | "tag";
const seat = (i: number) => `p${i}` as DuelistId;

function returnedOwners(format: Format, actor: 0 | 1, partner = false): Scenario {
  const n = format === "ffa3" ? 3 : 4;
  const owners = partner ? [actor + 2, actor === 0 ? 3 : 0]
    : format === "tag" ? (actor === 0 ? [1, 3] : [0, 2]) : [1, 2];
  const setup: Scenario["setup"] = { format };
  const board: BoardExpect = {};
  for (let i = 0; i < n; i++) {
    setup[seat(i)] = { hand: ["Beaver Warrior"] };
    board[seat(i)] = { lp: format === "tag" ? 16000 : 8000, hand: ["Beaver Warrior"], monsters: [], spells: [], grave: [], banished: [] };
  }
  setup[seat(actor)] = { monsters: ["Criosphinx", { card: "Penguin Soldier", pos: "set" }], hand: ["Beaver Warrior"] };
  board[seat(actor)]!.monsters = ["Criosphinx", "Penguin Soldier"];
  const monsters = ["Battle Ox", "Silver Fang"];
  for (let k = 0; k < 2; k++) {
    setup[seat(owners[k])]!.monsters = [monsters[k]];
    board[seat(owners[k])]!.hand = [monsters[k]];
    board[seat(owners[k])]!.grave = ["Beaver Warrior"];
  }
  const steps: Step[] = actor === 1 ? [endTurn("p0")] : [];
  if (actor === 1) board.p1!.hand = ["Beaver Warrior", "Mystical Elf"];
  steps.push(changePosition("Penguin Soldier", seat(actor)), yes(seat(actor)), select(...monsters));
  // The card processes owners in turn order from its controller, also when the partner owns a returned monster.
  for (const owner of Array.from({ length: n }, (_, i) => (actor + i) % n).filter(i => owners.includes(i))) {
    const monster = monsters[owners.indexOf(owner)];
    steps.push(expectPickOptions([{ seat: seat(owner), card: "Beaver Warrior" }, { seat: seat(owner), card: monster }], seat(owner)), select("Beaver Warrior"));
  }
  steps.push(expectBoard(board));
  return defineScenario({
    id: `criosphinx-${format}-p${actor}-${partner ? "partner-and-opponent" : "two-opponents"}-return`,
    title: "Each owner of a returned monster discards one card; other duelists keep their hands",
    source: `${SOURCE} [R-COMMON-SEAT-STATE]`, rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "criosphinx", format, "card:18654201"], setup, steps,
  });
}

export const CRIOSPHINX_SCENARIOS = [
  returnedOwners("ffa3", 0), returnedOwners("ffa4", 0), returnedOwners("tag", 0), returnedOwners("tag", 1),
  returnedOwners("tag", 0, true), returnedOwners("tag", 1, true),
];
