import { activate, choose, defineScenario, endTurn, expectBoard, expectNotOffered, expectOffered,
  expectPickSeats, expectPrompt, expectTurn, normalSummon, pickOpponent,
  type BoardExpect, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";
const ELF = "Mystical Elf";
const SEAL = "Time Seal";
const YOWIE = "Yowie";
const BOARD = "Flower Cardian Boardefly";
const PINE = "Flower Cardian Pine";
const BULB = "Glow-Up Bulb";
type Format = "1v1" | "ffa3" | "ffa4" | "tag";
function seats(format: Format): DuelistId[] {
  return (["p0", "p1", "p2", "p3"] as DuelistId[]).slice(0, format === "1v1" ? 2 : format === "ffa3" ? 3 : 4);
}
function board(format: Format, draws: number[], changes: BoardExpect = {}): Step {
  return expectBoard(Object.fromEntries(seats(format).map((seat, i) => [seat, {
    lp: format === "tag" ? 16000 : 8000, hand: Array(draws[i]).fill(ELF), deckCount: 20 - draws[i],
    monsters: [], spells: [], grave: [], banished: [], ...changes[seat],
  }])));
}
function proof(format: Format, name: string, setup: Scenario["setup"], steps: Step[]): Scenario {
  return defineScenario({ id: `declared-duration-${format}-${name}`, title: `${format}: ${name}`,
    source: "docs/adr/0002-multiplayer-duel-rules.md; [R-FFA-OPP-ONE]; [R-FFA-ACTIVATED-LOCK]; [R-FFA-DECLARED-DURATION]; card script",
    tags: ["multiplayer", "declared-duration", format],
    rules: format.startsWith("ffa") ? ["R-FFA-OPP-ONE", "R-FFA-ACTIVATED-LOCK", "R-FFA-DECLARED-DURATION"] : ["R-COMMON-ONGOING"],
    setup: { format, ...setup }, steps });
}
function drawLock(format: Format, card = SEAL): Scenario {
  const n = seats(format).length;
  const target = format === "ffa4" ? "p3" : format === "ffa3" ? "p2" : "p1";
  const state: BoardExpect = card === YOWIE ? { p0: { monsters: [YOWIE] } } : { p0: { grave: [SEAL] } };
  const steps: Step[] = card === YOWIE ? [normalSummon(YOWIE, "p0"), expectPrompt({ by: "p0", kind: "choice" }), choose("Yes", "p0")] : [activate(SEAL, "p0")];
  if (format.startsWith("ffa")) steps.push(expectPickSeats(seats(format).slice(1), "p0"), pickOpponent(target, "p0"));
  const draws = Array(n).fill(0);
  steps.push(board(format, draws, state));
  const turns = format === "tag" ? 5 : n + Number(target.slice(1)) + 1;
  for (let turn = 2; turn <= turns; turn++) {
    const previous = seats(format)[(turn - 2) % n];
    const player = seats(format)[(turn - 1) % n];
    if (!(player === target && turn === Number(target.slice(1)) + 1)) draws[Number(player.slice(1))]++;
    steps.push(endTurn(previous), expectTurn(player, turn), board(format, [...draws], state));
  }
  return proof(format, `${card === SEAL ? "time-seal" : "yowie"}-next-draw`,
    card === YOWIE ? { p0: { hand: [YOWIE] } } : { p0: { spells: [{ card: SEAL, pos: "set" }] } }, steps);
}
function endLock(format: "ffa3" | "ffa4"): Scenario {
  const target: DuelistId = format === "ffa3" ? "p2" : "p3";
  const n = seats(format).length;
  const setup: Scenario["setup"] = { p0: { monsters: [BOARD], grave: [PINE] } };
  const state: BoardExpect = { p0: { monsters: [BOARD], banished: [PINE] } };
  for (const seat of seats(format).slice(1)) { setup[seat] = { grave: [BULB] }; state[seat] = { grave: [BULB] }; }
  const steps: Step[] = [activate(BOARD, "p0"), expectPickSeats(seats(format).slice(1), "p0"),
    pickOpponent(target, "p0")];
  const draws = Array(n).fill(0);
  steps.push(board(format, draws, state));
  for (let turn = 2; turn <= 2 * n; turn++) {
    const previous = seats(format)[(turn - 2) % n];
    const player = seats(format)[(turn - 1) % n];
    draws[Number(player.slice(1))]++;
    steps.push(endTurn(previous), expectTurn(player, turn), board(format, [...draws], state));
    if (turn <= n && player !== target) steps.push(expectOffered("activate", BULB, player));
    if (turn === n) steps.push(expectNotOffered("activate", BULB, target));
  }
  steps.push(expectOffered("activate", BULB, target), activate(BULB, target));
  state[target] = { monsters: [BULB], grave: [ELF], deckCount: 17 };
  steps.push(board(format, [...draws], state));
  return proof(format, "boardefly-lock-ends-after-the-declared-turn", setup, steps);
}
export const DECLARED_DURATION_RESET_SCENARIOS = [drawLock("ffa4"), drawLock("ffa3", YOWIE), drawLock("1v1"), drawLock("tag"), endLock("ffa3"), endLock("ffa4")];
