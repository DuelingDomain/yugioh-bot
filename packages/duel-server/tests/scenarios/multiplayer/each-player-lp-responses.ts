import { activate, attack, changePhase, endTurn, expectBoard, pickOpponent, select, yes, type BoardExpect, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";
type Format = "ffa3" | "ffa4" | "tag";
const seat = (i: number) => `p${i}` as DuelistId;
const CARDS = [
  [37780349, "Destiny HERO - Dynatag"], [3064425, "Superheavy Samurai Soulbang Cannon"],
  [31353051, "Exploderokket Dragon"], [63378869, "Aiza the Dragoness of Deranged Devotion"],
  [89719143, "Final Fusion"], [7852509, "Loop of Destruction"], [21501961, "Pair Bear Scare!!"],
] as const;

function response(format: Format, actor: 0 | 1, [code, card]: typeof CARDS[number]): Scenario {
  const n = format === "ffa3" ? 3 : 4, enemy = actor === 0 ? 1 : 0;
  const setup: Scenario["setup"] = { format }, board: BoardExpect = {};
  for (let i = 0; i < n; i++) {
    const hand = format === "tag" && i >= 2 ? ["Beaver Warrior"] : [];
    setup[seat(i)] = { hand }; board[seat(i)] = { lp: format === "tag" ? 16000 : 8000, hand: [...hand], monsters: [], spells: [], grave: [], banished: [] };
  }
  const steps: Step[] = [];
  let delta = -1000;
  if (code === 37780349 || code === 3064425 || code === 89719143) {
    if (code === 37780349) { setup[seat(actor)]!.hand = [card]; setup[seat(enemy)]!.monsters = ["Battle Ox"]; board[seat(enemy)]!.monsters = ["Battle Ox"]; board[seat(actor)]!.grave = [card]; }
    if (code === 3064425) {
      setup[seat(actor)]!.grave = [card]; setup[seat(actor)]!.monsters = [{ card: "Superheavy Samurai Big Benkei", pos: "def" }]; setup[seat(enemy)]!.monsters = ["Drillroid"];
      board[seat(actor)]!.grave = ["Superheavy Samurai Big Benkei"]; board[seat(actor)]!.banished = [card]; board[seat(enemy)]!.grave = ["Drillroid"];
    }
    if (code === 89719143) {
      setup[seat(actor)]!.spells = [{ card, pos: "set" }]; setup[seat(actor)]!.monsters = ["Flame Swordsman"]; setup[seat(enemy)]!.monsters = ["Dragoness the Wicked Knight"];
      board[seat(actor)]!.spells = []; board[seat(actor)]!.grave = [card]; board[seat(actor)]!.monsters = ["Flame Swordsman"]; board[seat(enemy)]!.monsters = ["Dragoness the Wicked Knight"]; delta = -3000;
    }
    const turns = actor === 0 ? n + 1 : n;
    for (let i = 0; i < turns; i++) steps.push(endTurn(seat(i % n)));
    for (let i = 0; i < n; i++) board[seat(i)]!.hand = { count: (actor === 0 && i === enemy ? 2 : 1) + (format === "tag" && i >= 2 ? 1 : 0) };
    if (code === 37780349) steps.push(attack("Battle Ox", "direct", seat(enemy)), pickOpponent(seat(actor), seat(enemy)), activate(card, seat(actor)));
    if (code === 3064425) steps.push(attack("Drillroid", {card:"Superheavy Samurai Big Benkei",owner:seat(actor)}, seat(enemy)), activate(card, seat(actor)));
    if (code === 89719143) steps.push(attack("Dragoness the Wicked Knight", { card: "Flame Swordsman", owner: seat(actor) }, seat(enemy)), activate(card, seat(actor)));
  } else if (code === 31353051) {
    setup[seat(actor)]!.monsters = [card, "Borrelsword Dragon", "Beaver Warrior"];
    if (actor === 1) { steps.push(endTurn("p0")); }
    steps.push(activate("Borrelsword Dragon", seat(actor)), select(card), activate(card, seat(actor)));
    board[seat(actor)]!.monsters = ["Borrelsword Dragon", "Beaver Warrior"]; board[seat(actor)]!.grave = [card]; delta = -2000;
  } else if (code === 63378869) {
    setup[seat(actor)]!.grave = [card]; setup[seat(actor)]!.hand = ["Monster Reborn"];
    setup[seat(enemy)]!.monsters = ["Battle Ox", "Silver Fang"]; setup[seat(enemy)]!.grave = ["Celtic Guardian"];
    const turns = actor === 0 ? n : n + 1;
    for (let i = 0; i < turns; i++) steps.push(endTurn(seat(i % n)));
    for (let i = 0; i < n; i++) board[seat(i)]!.hand = { count: 1 + (actor === 1 && i === 1 ? 1 : 0) + (format === "tag" && i >= 2 ? 1 : 0) };
    // Monster Reborn reads either GY. Choose the card without an opponent declaration.
    steps.push(activate("Monster Reborn", seat(actor)), select(card), yes(seat(actor)), select("Battle Ox"), attack(card, { card: "Battle Ox", owner: seat(enemy) }, seat(actor)), yes(seat(actor)));
    board[seat(actor)]!.monsters = [card]; board[seat(actor)]!.grave = ["Monster Reborn"]; board[seat(enemy)]!.monsters = ["Silver Fang"]; board[seat(enemy)]!.grave = ["Celtic Guardian", "Battle Ox"]; delta = -1700;
  } else if (code === 7852509) {
    setup[seat(actor)]!.spells = [{ card, pos: "up" }]; setup[seat(actor)]!.hand = ["Offerings to the Doomed"]; setup[seat(actor)]!.monsters = ["Beaver Warrior", "Battle Ox", "Silver Fang"];
    if (actor === 1) { steps.push(endTurn("p0")); (board.p1!.hand as string[]).push("Mystical Elf"); }
    steps.push(activate("Offerings to the Doomed", seat(actor)), select("Beaver Warrior"), yes(seat(actor)), select("Battle Ox"));
    board[seat(actor)]!.monsters = ["Silver Fang"]; board[seat(actor)]!.spells = [card]; board[seat(actor)]!.grave = ["Offerings to the Doomed", "Beaver Warrior", "Battle Ox"]; delta = -500;
  } else {
    setup[seat(actor)]!.spells = [{ card, pos: "set" }]; setup[seat(enemy)]!.deck = [card];
    if (actor === 1) steps.push(endTurn("p0"));
    steps.push(activate(card, seat(actor)), pickOpponent(seat(enemy), seat(actor)), yes(seat(enemy)));
    board[seat(actor)]!.grave = [card]; delta = 2000;
  }
  for (let i = 0; i < n; i++) board[seat(i)]!.lp! += delta * (format === "tag" ? 2 : 1);
  steps.push(expectBoard(board));
  return defineScenario({ id: `each-player-lp-${code}-${format}-p${actor}`, title: `${card}: every duelist receives the LP change after the real response`, source: `${SOURCE} [R-COMMON-EACH-PLAYER]`, rules: ["R-COMMON-EACH-PLAYER"], tags: ["multiplayer", "each-player-lp", format, `card:${code}`], setup, steps });
}
export const EACH_PLAYER_LP_RESPONSE_SCENARIOS = CARDS.flatMap(card => ([ ["ffa3", 0], ["ffa4", 0], ["tag", 0], ["tag", 1] ] as const).map(([format, actor]) => response(format, actor, card)));
