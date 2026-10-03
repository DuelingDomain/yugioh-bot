import { activate, attack, changePosition, endTurn, expectBoard, pickOpponent, select, specialSummon, yes, type BoardExpect, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";

type Format = "ffa3" | "ffa4" | "tag";
const seat = (i: number) => `p${i}` as DuelistId;
const CARDS = [
  [18271561, "Chthonian Blast"], [20686759, "Morphtronic Rusty Engine"],
  [20985997, 'Detonator Circle "A"'], [21219755, "Destruction Ring"],
  [46089249, "Koa'ki Ring"], [47233801, "Dark Snake Syndrome"],
  [71782404, "Red-Eyes Burn"], [73507661, "Fairy Wind"],
  [93469007, "Assault Overload"], [35842855, "Pyrorex the Elemental Lord"],
] as const;

function lpTrigger(format: Format, actor: 0 | 1, [code, card]: typeof CARDS[number]): Scenario {
  const n = format === "ffa3" ? 3 : 4;
  const enemy = actor === 0 ? 1 : 0;
  const setup: Scenario["setup"] = { format };
  const board: BoardExpect = {};
  for (let i = 0; i < n; i++) {
    const hand = format === "tag" && i >= 2 ? ["Beaver Warrior"] : [];
    setup[seat(i)] = { hand };
    board[seat(i)] = { lp: format === "tag" ? 16000 : 8000, hand: [...hand], monsters: [], spells: [], grave: [], banished: [] };
  }
  const steps: Step[] = [];
  let damage = 1000;
  if (code === 20985997) {
    setup[seat(actor)]!.spells = [{ card, pos: "set" }];
    setup[seat(actor)]!.monsters = [{ card: "Alien Grey", pos: "set" }];
    setup[seat(enemy)]!.monsters = ["Battle Ox", "Silver Fang"];
    if (actor === 1) { steps.push(endTurn("p0")); (board.p1!.hand as string[]).push("Mystical Elf"); }
    // R-COMMON-OPP-ONE: declare the opponent before Alien Grey selects its monster.
    steps.push(changePosition("Alien Grey", seat(actor)), ...(format !== "tag" ? [pickOpponent(seat(enemy), seat(actor))] : []), select("Battle Ox"), activate(card, seat(actor)));
    board[seat(actor)]!.monsters = ["Alien Grey"]; board[seat(actor)]!.grave = [card];
    board[seat(enemy)]!.monsters = ["Silver Fang"]; board[seat(enemy)]!.grave = ["Battle Ox"];
  } else if (code === 18271561) {
    const victim = "Beaver Warrior";
    setup[seat(actor)]!.spells = [{ card, pos: "set" }];
    setup[seat(actor)]!.monsters = [{ card: victim, pos: "def" }];
    setup[seat(enemy)]!.monsters = ["Battle Ox"];
    const turns = actor === 0 ? n + 1 : n;
    for (let i = 0; i < turns; i++) steps.push(endTurn(seat(i % n)));
    steps.push(attack("Battle Ox", { card: victim, owner: seat(actor) }, seat(enemy)), activate(card, seat(actor)));
    for (let i = 0; i < n; i++) board[seat(i)]!.hand = { count: (actor === 0 && i === enemy ? 2 : 1) + (format === "tag" && i >= 2 ? 1 : 0) };
    board[seat(actor)]!.grave = [victim, card]; board[seat(enemy)]!.grave = ["Battle Ox"];
    if (code === 18271561) damage = 850;
  } else if (code === 47233801) {
    setup[seat(actor)]!.hand = [card];
    if (actor === 1) steps.push(endTurn("p0"));
    steps.push(activate(card,seat(actor)));
    for (let i = 0; i < 2 * n; i++) steps.push(endTurn(seat((actor + i) % n)));
    for (let i = 0; i < n; i++) board[seat(i)]!.hand = { count: 2 + (actor === 1 && i === 1 ? 1 : 0) + (format === "tag" && i >= 2 ? 1 : 0) };
    board[seat(actor)]!.spells = [card]; damage = 600;
  } else if (code === 35842855) {
    setup[seat(actor)]!.hand = [card]; setup[seat(actor)]!.grave = Array(5).fill("Flame Champion");
    const target = format === "tag" && actor === 1 ? 2 : n - 1;
    setup[seat(target)]!.monsters = ["Luster Dragon"];
    setup[seat(enemy)]!.monsters = ["Battle Ox"]; board[seat(enemy)]!.monsters = ["Battle Ox"];
    if (actor === 1) { steps.push(endTurn("p0")); (board.p1!.hand as string[]).push("Mystical Elf"); }
    // R-COMMON-OPP-ONE: the chosen opponent has one target, which the engine selects.
    steps.push(specialSummon(card, seat(actor)), yes(seat(actor)), format !== "tag" ? pickOpponent(seat(target), seat(actor)) : select("Luster Dragon"));
    board[seat(actor)]!.monsters = [card]; board[seat(actor)]!.grave = Array(5).fill("Flame Champion");
    board[seat(target)]!.grave = ["Luster Dragon"]; damage = 950;
  } else if (code === 20686759 || code === 71782404) {
    const victim = code === 20686759 ? "Morphtronic Celfon" : "Red-Eyes Black Dragon";
    setup[seat(actor)]!.monsters = [victim, code === 20686759 ? "Morphtronic Boomboxen" : "Red-Eyes Archfiend of Lightning"];
    setup[seat(actor)]!.hand = code === 20686759 ? [card, "Dark Hole"] : ["Dark Hole"];
    if (code === 71782404) setup[seat(actor)]!.spells = [{ card, pos: "set" }];
    if (actor === 1) { steps.push(endTurn("p0")); (board.p1!.hand as string[]).push("Mystical Elf"); }
    if (code === 20686759) steps.push(activate(card, seat(actor)), select(victim));
    steps.push(activate("Dark Hole", seat(actor)));
    if (code === 71782404) steps.push(activate(card, seat(actor)), select(victim));
    board[seat(actor)]!.grave = [victim, code === 20686759 ? "Morphtronic Boomboxen" : "Red-Eyes Archfiend of Lightning", card, "Dark Hole"]; damage = code === 20686759 ? 100 : 2400;
  } else {
    setup[seat(actor)]!.spells = [{ card, pos: "set" }];
    if (code === 46089249) { setup[seat(actor)]!.hand = ["Iron Core of Koa'ki Meiru","Iron Core of Koa'ki Meiru"]; board[seat(actor)]!.hand = ["Iron Core of Koa'ki Meiru","Iron Core of Koa'ki Meiru"]; }
    if (code === 73507661) {
      for (let i = 0; i < n; i++) { (setup[seat(i)]!.spells ??= []).push({ card: "Supply Squad", pos: "up" }); board[seat(i)]!.grave = ["Supply Squad"]; }
      damage = n * 300;
    } else {
      const victim = code === 93469007 ? "Stardust Dragon/Assault Mode" : "Beaver Warrior";
      const spare = code === 93469007 ? "Red Dragon Archfiend/Assault Mode" : "Battle Ox";
      setup[seat(actor)]!.monsters = [victim,spare]; board[seat(actor)]!.grave = [victim]; board[seat(actor)]!.monsters = [spare];
      if (code === 93469007) damage = 2000;
    }
    // Traps can respond in p0's End Phase; the Normal Spell Koa'ki Ring waits for p1's Main Phase.
    if (actor === 1) { steps.push(endTurn("p0")); if (code === 46089249) (board.p1!.hand as string[]).push("Mystical Elf"); }
    steps.push(activate(card, seat(actor)));
    // R-COMMON-OPP-ONE: these opponent LP reads declare one seat before the own-monster selection.
    if (code === 46089249) steps.push(select({card:"Iron Core of Koa'ki Meiru",nth:0}), select("Beaver Warrior"));
    if (code === 21219755) steps.push(select("Beaver Warrior"));
    if (code === 93469007) steps.push(...(format !== "tag" ? [pickOpponent(seat(enemy), seat(actor))] : []), select("Stardust Dragon/Assault Mode"));
    (board[seat(actor)]!.grave as string[]).push(card);
  }
  for (let i = 0; i < n; i++) board[seat(i)]!.lp! -= damage * (format === "tag" ? 2 : 1);
  steps.push(expectBoard(board));
  return defineScenario({ id: `each-player-lp-${code}-${format}-p${actor}`, title: `${card}: the real card trigger changes LP for every living duelist`, source: `${SOURCE} [R-COMMON-EACH-PLAYER]`, rules: ["R-COMMON-EACH-PLAYER"], tags: ["multiplayer", "each-player-lp", format, `card:${code}`], setup, steps });
}

export const EACH_PLAYER_LP_TRIGGER_SCENARIOS = CARDS.flatMap(card => ([ ["ffa3", 0], ["ffa4", 0], ["tag", 0], ["tag", 1] ] as const).map(([format, actor]) => lpTrigger(format, actor, card)));
