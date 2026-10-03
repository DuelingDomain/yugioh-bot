import { activate, changePhase, endTurn, expectBoard, select, type BoardExpect, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";
type Format = "ffa3" | "ffa4" | "tag";
const seat = (i: number) => `p${i}` as DuelistId;
const CARDS = [[14989021, "Simorgh, Bird of Divinity"], [75797046, "Photon Alexandra Queen"], [34449261, "Fusion Fright Waltz"]] as const;
function amount(format: Format, actor: 0 | 1, [code, card]: typeof CARDS[number]): Scenario {
  const n = format === "ffa3" ? 3 : 4, enemy = actor === 0 ? 1 : 0;
  const setup: Scenario["setup"] = { format }, board: BoardExpect = {};
  for (let i = 0; i < n; i++) {
    const hand = format === "tag" && i >= 2 ? ["Silver Fang"] : [];
    setup[seat(i)] = { hand }; board[seat(i)] = { lp: format === "tag" ? 16000 : 8000, hand: [...hand], monsters: [], spells: [], grave: [], banished: [] };
  }
  const steps: Step[] = [];
  if (code === 14989021) {
    setup[seat(actor)]!.monsters = [card]; board[seat(actor)]!.monsters = [card];
    setup.p0!.spells = [{ card: "Supply Squad", pos: "up" }]; setup.p1!.spells = [{ card: "Supply Squad", pos: "up" }, { card: "Supply Squad", pos: "up" }];
    board.p0!.spells = ["Supply Squad"]; board.p1!.spells = ["Supply Squad", "Supply Squad"];
    for (let i = 0; i < n; i++) board[seat(i)]!.lp! -= format === "tag" ? (i % 2 === 0 ? 1000 : 0) : i === 0 ? 500 : i === 1 ? 0 : 1000;
    steps.push(changePhase("end", "p0")); (board.p1!.hand as string[]).push("Mystical Elf");
  } else if (code === 75797046) {
    for (let i = 0; i < n; i++) { setup[seat(i)]!.monsters = ["Beaver Warrior"]; (board[seat(i)]!.hand as string[]).push("Beaver Warrior"); board[seat(i)]!.lp! -= format === "tag" ? 600 : 300; }
    setup[seat(actor)]!.monsters!.push({ card, materials: ["Celtic Guardian"] });
    if (actor === 1) { steps.push(endTurn("p0")); (board.p1!.hand as string[]).push("Mystical Elf"); }
    steps.push(activate(card, seat(actor))); board[seat(actor)]!.grave = ["Celtic Guardian"]; board[seat(actor)]!.extra = [card];
  } else {
    setup[seat(actor)]!.monsters = ["Frightfur Bear"]; setup[seat(enemy)]!.monsters = ["Flame Swordsman"];
    setup[seat(actor)]!.spells = [{ card, pos: "set" }]; setup[seat(actor)]!.hand = ["Monster Reborn"];
    setup[seat(actor)]!.grave = ["Beaver Warrior", "Celtic Guardian"];
    if (actor === 1) { steps.push(endTurn("p0")); (board.p1!.hand as string[]).push("Mystical Elf"); }
    steps.push(activate("Monster Reborn", seat(actor)), select("Beaver Warrior"), activate(card, seat(actor)));
    board[seat(actor)]!.monsters = ["Frightfur Bear"]; board[seat(enemy)]!.monsters = ["Flame Swordsman"];
    board[seat(actor)]!.grave = ["Beaver Warrior", "Celtic Guardian", "Monster Reborn", card];
    for (let i = 0; i < n; i++) if (i === actor || (format === "tag" && i % 2 === actor % 2)) board[seat(i)]!.lp! -= 4000;
  }
  steps.push(expectBoard(board));
  return defineScenario({ id: `each-player-lp-${code}-${format}-p${actor}`, title: `${card}: LP uses the cards on the correct field or in the correct hand`, source: `${SOURCE} [R-COMMON-EACH-PLAYER]`, rules: ["R-COMMON-EACH-PLAYER"], tags: ["multiplayer", "each-player-lp", format, `card:${code}`], setup, steps });
}
export const EACH_PLAYER_LP_AMOUNT_SCENARIOS = CARDS.flatMap(card => ([ ["ffa3", 0], ["ffa4", 0], ["tag", 0], ["tag", 1] ] as const).map(([format, actor]) => amount(format, actor, card)));
