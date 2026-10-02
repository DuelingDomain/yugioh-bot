import { activate, attack, changePosition, defineScenario, endTurn, expectBoard, normalSummon, yes, type BoardExpect, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

type Format = "ffa3" | "ffa4" | "tag";
const seat = (i: number) => `p${i}` as DuelistId;
const CARDS = [
  [12694768, "Abaki", "battle", -500],
  [58071123, "Oxygeddon", "battle", -800],
  [86209650, "Stray Asmodian", "battle", 800],
  [29716911, "Capacitor Stalker", "destroy", -800],
  [34004470, "The Big Saturn", "destroy", -2800],
  [30270176, "Crimson Nova the Dark Cubic Lord", "end", -3000],
  [4807253, "Performage Flame Eater", "summon", -500],
  [6783559, "Self-Destruct Ant", "flip", -1000],
  [39767432, "Sorcerer of Sebek", "recover-trigger", -1000],
  [66719324, "Rain of Mercy", "spell", 1000],
  [29599813, "Purrely Pretty Memory", "spell", 1000],
] as const;

function eachPlayerLp(format: Format, actor: 0 | 1, [code, card, trigger, amount]: typeof CARDS[number]): Scenario {
  const n = format === "ffa3" ? 3 : 4;
  const enemy = actor === 0 ? 1 : 0;
  const setup: Scenario["setup"] = { format };
  const board: BoardExpect = {};
  for (let i = 0; i < n; i++) {
    setup[seat(i)] = format === "tag" && i >= 2 ? { hand: ["Beaver Warrior"] } : {};
    board[seat(i)] = { lp: (format === "tag" ? 16000 : 8000) + amount * (format === "tag" ? 2 : 1), hand: format === "tag" && i >= 2 ? ["Beaver Warrior"] : [], monsters: [], spells: [], grave: [], banished: [] };
  }
  const steps: Step[] = [];
  if (trigger === "battle") {
    const attacker = code === 58071123 ? "Flame Champion" : code === 86209650 ? "Luster Dragon" : "Battle Ox";
    setup[seat(actor)]!.monsters = [{ card, pos: "def" }];
    setup[seat(enemy)]!.monsters = [attacker];
    const turns = actor === 0 ? n + 1 : n;
    for (let i = 0; i < turns; i++) steps.push(endTurn(seat(i % n)));
    steps.push(attack(attacker, { card, owner: seat(actor) }, seat(enemy)));
    for (let i = 0; i < n; i++) board[seat(i)]!.hand = { count: (actor === 0 && i === enemy ? 2 : 1) + (format === "tag" && i >= 2 ? 1 : 0) };
    board[seat(enemy)]!.monsters = [attacker];
    board[seat(actor)]!.grave = [card];
  } else if (trigger === "destroy") {
    setup[seat(actor)]!.monsters = [card];
    setup[seat(enemy)]!.hand = ["Dark Hole"];
    if (enemy === 1) { steps.push(endTurn("p0")); board.p1!.hand = ["Mystical Elf"]; }
    steps.push(activate("Dark Hole", seat(enemy)));
    board[seat(enemy)]!.grave = ["Dark Hole"];
    board[seat(actor)]!.grave = [card];
  } else {
    if (trigger === "spell") setup[seat(actor)]!.hand = [card];
    else if (trigger === "summon") setup[seat(actor)]!.hand = [card];
    else setup[seat(actor)]!.monsters = [{ card, pos: trigger === "flip" ? "set" : "atk" }];
    if (trigger === "recover-trigger") setup[seat(actor)]!.hand = ["Dian Keto the Cure Master"];
    if (actor === 1) { steps.push(endTurn("p0")); board.p1!.hand = ["Mystical Elf"]; }
    if (trigger === "spell") { steps.push(activate(card, seat(actor))); board[seat(actor)]!.grave = [card]; }
    if (trigger === "summon") { steps.push(normalSummon(card, seat(actor))); board[seat(actor)]!.monsters = [card]; }
    if (trigger === "flip") { steps.push(changePosition(card, seat(actor))); board[seat(actor)]!.monsters = [card]; }
    if (trigger === "end") {
      board[seat(actor)]!.monsters = [card];
      if (format === "tag") {
        for (let j = 0; j < 3; j++) { steps.push(endTurn(seat((actor + j) % n))); (board[seat((actor + j + 1) % n)]!.hand as string[]).push("Mystical Elf"); }
      } else { steps.push({ op: "phase", to: "end", by: seat(actor) }); (board[seat(actor + 1)]!.hand as string[]).push("Mystical Elf"); }
    }
    if (trigger === "recover-trigger") {
      steps.push(activate("Dian Keto the Cure Master", seat(actor)), yes(seat(actor)));
      board[seat(actor)]!.monsters = [card]; board[seat(actor)]!.grave = ["Dian Keto the Cure Master"];
      for (let i = 0; i < n; i++) if (i === actor || (format === "tag" && i % 2 === actor % 2)) board[seat(i)]!.lp! += 1000;
    }
  }
  steps.push(expectBoard(board));
  return defineScenario({ id: `each-player-lp-${code}-${format}-p${actor}`, title: `${card}: every living side receives the stated LP change`, source: `${SOURCE} [R-COMMON-EACH-PLAYER]`, rules: ["R-COMMON-EACH-PLAYER"], tags: ["multiplayer", "each-player-lp", format, `card:${code}`], setup, steps });
}

export const EACH_PLAYER_LP_SIMPLE_SCENARIOS = CARDS.flatMap(card => ([ ["ffa3", 0], ["ffa4", 0], ["tag", 0], ["tag", 1] ] as const).map(([format, actor]) => eachPlayerLp(format, actor, card)));
