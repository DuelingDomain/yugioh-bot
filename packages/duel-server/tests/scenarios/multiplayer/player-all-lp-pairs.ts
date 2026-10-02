import { activate, choose, defineScenario, endTurn, expectBoard, expectNoEvent, expectPickOptions, normalSummon, pickOpponent, select, specialSummon, yes, type BoardExpect, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";
import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { Session, nseatWasmBinary } from "../../support/session.js";
import { SOURCE } from "./nseat-scenarios.js";
type Format = "1v1" | "ffa3" | "ffa4" | "tag";
const seat = (i: number) => `p${i}` as DuelistId;
const CARDS = [
  [26273196, "Time Wizard of Tomorrow"], [46918794, "Tremendous Fire"], [49407319, "Star Mine"],
  [65430834, "Jurassic Impact"], [6909330, "Soul Binding Gate"], [76004142, "Bad Luck Blast"],
  [81143465, "Tragic Twin Twined Jewels"], [83555666, "Ring of Destruction"], [83819309, "Cooling Embers"], [89693655, "Subspace Battle"],
] as const;

export function lpPairScenario(format: Format, actor: 0 | 1, [code, card]: typeof CARDS[number], coinRight = false, laterEvent = false, laterRecipient = false): Scenario {
  const n = format === "1v1" ? 2 : format === "ffa3" ? 3 : 4;
  const enemy = laterEvent ? 2 : laterRecipient ? n - 1 : code === 81143465 && actor === 1 ? 2 : actor === 0 ? 1 : 0;
  const recipient = enemy;
  const setup: Scenario["setup"] = { format }, board: BoardExpect = {};
  for (let i = 0; i < n; i++) {
    const hand = format === "tag" && i >= 2 ? ["Silver Fang"] : [];
    setup[seat(i)] = { hand }; board[seat(i)] = { lp: format === "tag" ? 16000 : 8000, hand: [...hand], monsters: [], spells: [], grave: [], banished: [], extra: [], deckCount: 20 };
  }
  const steps: Step[] = [];
  const beforePick = (): Step[] => {
    const lp: BoardExpect = {};
    for (let i = 0; i < n; i++) lp[seat(i)] = { lp: format === "tag" ? 16000 : i === actor && code === 83819309 ? 9000 : code === 65430834 && i === actor ? 7000 : 8000 };
    return [expectBoard(lp), expectNoEvent({ kind: "chain-resolving", card }), pickOpponent(seat(recipient), seat(actor))];
  };
  let ownDelta = 0, enemyDelta = 0;
  if (code === 46918794) {
    setup[seat(actor)]!.hand = [card];
    if (actor === 1) { steps.push(endTurn("p0")); (board.p1!.hand as string[]).push("Mystical Elf"); }
    steps.push(activate(card, seat(actor)), ...((format === "tag" || format === "1v1") ? [] : beforePick())); board[seat(actor)]!.grave = [card]; ownDelta = -500; enemyDelta = -1000;
  } else if (code === 49407319) {
    setup[seat(actor)]!.monsters = [card]; setup[seat(enemy)]!.hand = ["Dark Hole"];
    for (let i = 0; i < enemy; i++) { steps.push(endTurn(seat(i))); (board[seat(i + 1)]!.hand as string[]).push("Mystical Elf"); }
    steps.push(activate("Dark Hole", seat(enemy))); board[seat(actor)]!.grave = [card]; board[seat(enemy)]!.grave = ["Dark Hole"]; ownDelta = enemyDelta = -2000;
  } else if (code === 65430834) {
    setup[seat(actor)]!.lp = format === "tag" ? 15000 : 7000;
    for (let i = 0; i < n; i++) if (i === actor || (format === "tag" && i % 2 === actor % 2)) board[seat(i)]!.lp! -= 1000;
    setup[seat(actor)]!.monsters = ["Kabazauls", "Megalosmasher X"]; setup[seat(actor)]!.spells = [{ card, pos: "set" }];
    if (actor === 1) steps.push(endTurn("p0"));
    steps.push(activate(card, seat(actor)), ...((format === "tag" || format === "1v1") ? [] : beforePick())); board[seat(actor)]!.grave = [card, "Kabazauls", "Megalosmasher X"]; ownDelta = enemyDelta = -2000;
  } else if (code === 6909330) {
    setup[seat(actor)]!.field = { card, pos: "up" }; setup[seat(actor)]!.grave = ["Z-ONE"]; setup[seat(actor)]!.hand = ["Beaver Warrior"];
    if (actor === 1) { steps.push(endTurn("p0")); (board.p1!.hand as string[]).push("Mystical Elf"); }
    steps.push(normalSummon("Beaver Warrior", seat(actor)), ...((format === "tag" || format === "1v1") ? [] : beforePick())); board[seat(actor)]!.spells = [card]; board[seat(actor)]!.grave = ["Z-ONE", "Beaver Warrior"]; ownDelta = enemyDelta = -800;
  } else if (code === 76004142 || code === 83555666) {
    setup[seat(actor)]!.spells = [{ card, pos: "set" }]; setup[seat(enemy)]!.monsters = ["Luster Dragon", "Beaver Warrior"];
    if (actor === 1 || code === 83555666) { steps.push(endTurn("p0")); if (actor === 0) (board.p1!.hand as string[]).push("Mystical Elf"); }
    steps.push(activate(card, seat(actor)));
    if (code === 76004142 && format !== "tag" && format !== "1v1") {
      steps.push(...beforePick());
    }
    if (code === 76004142 && (format === "ffa3" || format === "ffa4")) {
      for (let i = 0; i < n; i++) if (i !== actor && i !== enemy) {
        setup[seat(i)]!.monsters = ["Battle Ox"];
        board[seat(i)]!.monsters = ["Battle Ox"];
      }
      steps.push(expectPickOptions([{ seat: seat(enemy), card: "Luster Dragon" }, { seat: seat(enemy), card: "Beaver Warrior" }], seat(actor)));
    }
    steps.push(select("Luster Dragon")); board[seat(actor)]!.grave = [card]; board[seat(enemy)]!.monsters = code === 83555666 ? ["Beaver Warrior"] : ["Luster Dragon", "Beaver Warrior"];
    if (code === 83555666) board[seat(enemy)]!.grave = ["Luster Dragon"];
    ownDelta = enemyDelta = code === 83555666 ? -1900 : -950;
  } else if (code === 83819309) {
    setup[seat(actor)]!.monsters = [card]; setup[seat(actor)]!.hand = ["Dian Keto the Cure Master"];
    if (actor === 1) { steps.push(endTurn("p0")); (board.p1!.hand as string[]).push("Mystical Elf"); }
    steps.push(activate("Dian Keto the Cure Master", seat(actor)), yes(seat(actor)), ...((format === "tag" || format === "1v1") ? [] : beforePick()), choose("Your opponent gains 1000 LP", seat(actor)));
    board[seat(actor)]!.monsters = [card]; board[seat(actor)]!.grave = ["Dian Keto the Cure Master"]; ownDelta = enemyDelta = 1000;
  } else if (code === 89693655) {
    setup[seat(actor)]!.hand = [card]; setup[seat(actor)]!.deck = ["Battle Ox", "Battle Ox", "Battle Ox"]; setup[seat(enemy)]!.deck = ["Beaver Warrior", "Beaver Warrior", "Beaver Warrior"];
    if (actor === 1) { steps.push(endTurn("p0")); (board.p1!.hand as string[]).push("Battle Ox"); }
    const drawn = actor === 1;
    steps.push(activate(card, seat(actor)), ...(format === "1v1" ? [] : beforePick()));
    for (let i = 0; i < (drawn ? 2 : 3); i++) steps.push(select({ card: "Battle Ox", nth: 0 }), select({ card: "Beaver Warrior", nth: 0 }));
    if (drawn) steps.push(select("Mystical Elf"), select("Beaver Warrior"));
    (board[seat(actor)]!.hand as string[]).push(...Array(drawn ? 2 : 3).fill("Battle Ox")); board[seat(actor)]!.grave = [card, ...(drawn ? ["Mystical Elf"] : [])]; board[seat(enemy)]!.grave = Array(drawn ? 2 : 3).fill("Beaver Warrior");
    if (drawn) (board[seat(enemy)]!.hand as string[]).push("Beaver Warrior"); enemyDelta = drawn ? -1000 : -1500; ownDelta = drawn ? -500 : 0;
  } else if (code === 81143465) {
    setup[seat(actor)]!.monsters = ["Beaver Warrior", "Mystical Elf"]; setup[seat(actor)]!.extra = ["Gagaga Cowboy"]; setup[seat(actor)]!.hand = [card];
    setup[seat(enemy)]!.monsters = ["Battle Ox", "Celtic Guardian"]; setup[seat(enemy)]!.extra = ["Gem-Knight Pearl"];
    if (actor === 1) { steps.push(endTurn("p0")); (board.p1!.hand as string[]).push("Mystical Elf"); }
    steps.push(specialSummon("Gagaga Cowboy", seat(actor)), select("Beaver Warrior", "Mystical Elf"), activate(card, seat(actor)), endTurn(seat(actor)), ...(laterEvent ? [endTurn("p1")] : []), specialSummon("Gem-Knight Pearl", seat(enemy)), select("Battle Ox", "Celtic Guardian"), yes(seat(actor)));
    if (laterEvent) (board.p1!.hand as string[]).push("Mystical Elf");
    (board[seat(enemy)]!.hand as string[]).push("Mystical Elf"); board[seat(actor)]!.grave = [card, "Gagaga Cowboy", "Beaver Warrior", "Mystical Elf"]; board[seat(enemy)]!.grave = ["Gem-Knight Pearl", "Battle Ox", "Celtic Guardian"]; ownDelta = enemyDelta = -4100;
  } else {
    setup[seat(actor)]!.hand = ["Polymerization"]; setup[seat(actor)]!.monsters = ["Time Wizard", "Penguin Soldier"]; setup[seat(actor)]!.extra = [card]; setup[seat(enemy)]!.monsters = ["Beaver Warrior"];
    if (actor === 1) { steps.push(endTurn("p0")); (board.p1!.hand as string[]).push("Mystical Elf"); }
    steps.push(activate("Polymerization", seat(actor)), select("Time Wizard", "Penguin Soldier"), activate(card, seat(actor)), ...((format === "tag" || format === "1v1") ? [] : beforePick()), choose(coinRight ? "Tails" : "Heads", seat(actor)));
    board[seat(actor)]!.grave = ["Polymerization", "Time Wizard", "Penguin Soldier", card]; board[seat(enemy)]!.grave = ["Beaver Warrior"]; if (coinRight) enemyDelta = -1600; else ownDelta = -1600;
  }
  for (let i = 0; i < n; i++) {
    if (i === actor || (format === "tag" && i % 2 === actor % 2)) board[seat(i)]!.lp! += ownDelta;
    if (i === recipient || (format === "tag" && i % 2 === recipient % 2)) board[seat(i)]!.lp! += enemyDelta;
  }
  for (const step of steps) if (step.op === "phase" && step.to === "end") {
    const next = (Number(step.by!.slice(1)) + 1) % n;
    // A set Trap from p1 responds in p0's End Phase, before p1 draws.
    if (!(actor === 1 && [65430834, 76004142, 83555666].includes(code))) board[seat(next)]!.deckCount!--;
  }
  if (code === 89693655) {
    board[seat(actor)]!.deckCount! -= 3;
    board[seat(enemy)]!.deckCount! -= 3;
  }
  steps.push(expectBoard(board));
  return defineScenario({ id: `player-all-lp-pair-${code}-${format}-p${actor}${coinRight ? "-coin-right" : ""}${laterEvent ? "-later-event" : ""}${laterRecipient ? "-later-recipient" : ""}`, title: `${card}: the stated pair or single-player result leaves the other FFA LP totals unchanged`, source: `${SOURCE} [R-COMMON-OPP-PICK] [Q4]`, rules: ["R-COMMON-OPP-PICK"], tags: ["multiplayer", "player-all-lp-pair", format, `card:${code}`], setup, steps });
}
export const PLAYER_ALL_LP_PAIR_SCENARIOS = CARDS.flatMap(card => ([ ["ffa3", 0], ["ffa4", 0], ["tag", 0], ["tag", 1] ] as const).filter(([format]) => card[0] !== 83555666 || format === "tag").map(([format, actor]) => lpPairScenario(format, actor, card)));

PLAYER_ALL_LP_PAIR_SCENARIOS.push(...([["ffa3",0],["ffa4",0],["tag",0],["tag",1]] as const).map(([format,actor])=>lpPairScenario(format,actor,CARDS[0],true)));

// A later event opponent must bind automatically; the first living opponent stays untouched.
for (const code of [49407319, 81143465]) {
  const card = CARDS.find(row => row[0] === code)!;
  for (const format of ["ffa3", "ffa4"] as const) PLAYER_ALL_LP_PAIR_SCENARIOS.push(lpPairScenario(format, 0, card, false, true));
}

export function lpPairProofs(code: number): Scenario[] {
  const card = CARDS.find(row => row[0] === code)!;
  const rows: [Format, 0 | 1][] = [["1v1", 0], ["ffa3", 0], ["ffa3", 1], ["ffa4", 0], ["ffa4", 1], ["tag", 0], ["tag", 1]];
  const scenarios = rows.map(([format, actor]) => lpPairScenario(format, actor, card));
  for (const format of ["ffa3", "ffa4"] as const) scenarios.push(lpPairScenario(format, 0, card, false, false, true));
  if (code === 26273196) {
    scenarios.push(...rows.map(([format, actor]) => lpPairScenario(format, actor, card, true)));
    for (const format of ["ffa3", "ffa4"] as const) scenarios.push(lpPairScenario(format, 0, card, true, false, true));
  }
  return scenarios;
}

/** The first Draw Phase is skipped so the card proof is independent of the host draw flag. */
export async function runLpPairScenario(scenario: Scenario): Promise<void> {
  const compiled = compileBoard(scenario.setup);
  compiled.options.startupScripts![0].content += `
  do local skip=Effect.GlobalEffect(); skip:SetType(EFFECT_TYPE_FIELD); skip:SetCode(EFFECT_SKIP_DP)
  skip:SetProperty(EFFECT_FLAG_PLAYER_TARGET); skip:SetTargetRange(1,1); Duel.RegisterEffect(skip,0)
  local undo=Effect.GlobalEffect(); undo:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS); undo:SetCode(EVENT_PHASE_START+PHASE_MAIN1)
  undo:SetOperation(function(e) skip:Reset() e:Reset() end); Duel.RegisterEffect(undo,0) end`;
  const game = await createEngineGame({ ...compiled.options, seed: scenario.seed ?? ["1", "2", "3", "4"], dataDirectory: engineDataDirectory,
    ...(scenario.setup.format !== "1v1" ? { multiWasmBinary: nseatWasmBinary() } : {}) });
  try {
    const session = new Session(scenario, game);
    session.reachMainPhase(); session.startRecording();
    scenario.steps.forEach((step, index) => session.run(step, index + 1));
  } finally { game.close(); }
}
