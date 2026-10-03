// Owner 2026-10-02 night: Swords protects its controller in FFA.
// FFA protection uses the per-seat direct attack effect.
import { activate, attack, changePhase, choose, defineScenario, endTurn, expectBoard, expectEliminated,
  expectNotOffered, expectOffered, expectPickOptions, expectTurn, pickOpponent, select,
  type BoardExpect, type DuelistExpect, type Scenario, type Step } from "../../support/dsl.js";
import { domainVariant } from "./domain-variants.js";
import { SEATS, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

const SWORDS = "Swords of Revealing Light";
const ELF = "Mystical Elf";
const OX = "Battle Ox";
const MST = "Mystical Space Typhoon";
const BURN = "Hinotama";
type Ffa = "ffa3" | "ffa4";
const rules = ["R-COMMON-ONGOING", "R-FFA-SWORDS-PROTECT"];
const before = (format: Ffa, actor: Seat): Step[] => SEATS[format].slice(0, SEATS[format].indexOf(actor)).map(end => endTurn(end));

function setup(format: Ffa, holder: Seat): Scenario["setup"] {
  const result: Scenario["setup"] = { format, attackFirstTurn: true, skipOpeningDraw: true };
  for (const seat of SEATS[format]) result[seat] = { spells: seat === holder ? [SWORDS] : [] };
  return result;
}

// Exact state of every seat, including the draws before the current turn.
function board(format: Ffa, turn: number, spec: Partial<Record<Seat, DuelistExpect>>): Step {
  const state: BoardExpect = {};
  SEATS[format].forEach((seat, i) => {
    const draws = Math.max(0, Math.floor((turn - 1 - i) / SEATS[format].length) + 1 - (i === 0 ? 1 : 0));
    state[seat] = { lp: 8000, hand: Array.from({ length: draws }, () => ELF), monsters: [], spells: [], grave: [], banished: [], ...spec[seat] };
  });
  return expectBoard(state);
}
function proof(id: string, title: string, setup: Scenario["setup"], steps: Step[]): Scenario {
  return defineScenario({ id: `swords-protect-${id}`, title, source: `${SOURCE}; owner 2026-10-02 night correction`,
    rules: setup.format === "ffa3" || setup.format === "ffa4" ? rules : ["R-COMMON-ONGOING"], tags: ["multiplayer", setup.format!, "card:72302403"], setup, steps });
}

function monsterTargets(format: Ffa, holder: Seat, actor: Seat, facedown = false): Scenario {
  const fixture = setup(format, holder);
  for (const seat of SEATS[format]) fixture[seat]!.monsters = [seat === actor ? OX : ELF];
  if (facedown) fixture[holder]!.monsters = [{ card: ELF, pos: "set" }];
  const others = SEATS[format].filter(seat => seat !== actor && seat !== holder);
  const target = others[0];
  if (format === "ffa3") fixture[target]!.monsters = [ELF, ELF];
  const state: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) state[seat] = { monsters: seat === actor ? [OX] : seat === target ? (format === "ffa3" ? [ELF] : []) : [ELF],
    spells: seat === holder ? [SWORDS] : [], ...(seat === target ? { lp: 7100, grave: [ELF] } : {}) };
  return proof(`${format}-${holder}-${actor}-monster-targets${facedown ? "-facedown" : ""}`, `${format}: ${actor} cannot attack ${holder}'s ${facedown ? "face-down" : "face-up"} monster and can attack ${target}`,
    fixture, [...before(format, actor), changePhase("battle", actor), expectOffered("attack", OX, actor), choose("attack:0", actor),
      expectPickOptions(others.flatMap(seat => Array.from({ length: format === "ffa3" ? 2 : 1 }, () => ({ card: ELF, seat }))), actor), select({ card: ELF, owner: target, nth: 0 }),
      board(format, SEATS[format].indexOf(actor) + 1, state)]);
}

function directTargets(format: Ffa, holder: Seat, actor: Seat): Scenario {
  const fixture = setup(format, holder); fixture[actor]!.monsters = [ELF];
  const others = SEATS[format].filter(seat => seat !== actor && seat !== holder);
  const state: Partial<Record<Seat, DuelistExpect>> = { [actor]: { monsters: [ELF] }, [holder]: { spells: [SWORDS] }, [others[0]]: { lp: 7200 } };
  return proof(`${format}-${holder}-${actor}-direct-targets`, `${format}: ${actor} cannot attack ${holder} directly and can attack ${others[0]} directly`,
    fixture, [...before(format, actor), changePhase("battle", actor), expectOffered("attack", ELF, actor), attack(ELF, "direct", actor),
      ...(others.length > 1 ? [expectPickOptions(others.map(seat => ({ seat })), actor), pickOpponent(others[0], actor)] : []),
      board(format, SEATS[format].indexOf(actor) + 1, state)]);
}

function duration(format: Ffa, holder: Seat): Scenario {
  const fixture = setup(format, holder); fixture[holder]!.spells = []; fixture[holder]!.hand = [SWORDS];
  const seats = SEATS[format], count = seats.length, start = seats.indexOf(holder) + 1;
  const steps: Step[] = [...before(format, holder), expectTurn(holder, start), activate(SWORDS, holder)];
  let enemyTurns = 0, turn = start;
  while (enemyTurns < 3) {
    const seat = seats[(turn - 1) % count];
    steps.push(expectTurn(seat, turn), board(format, turn, { [holder]: { spells: [SWORDS] } }), endTurn(seat));
    if (seat !== holder) enemyTurns++;
    turn++;
    const next = seats[(turn - 1) % count];
    steps.push(expectTurn(next, turn), board(format, turn, { [holder]: enemyTurns === 3 ? { grave: [SWORDS] } : { spells: [SWORDS] } }));
  }
  return proof(`${format}-${holder}-third-opponent-end`, `${format}: Swords of ${holder} goes to the GY at the End Phase of opponent turn 3, turn ${turn - 1} of ${seats[(turn - 2) % count]}`, fixture, steps);
}

function flipAll(format: Ffa, holder: Seat): Scenario {
  const fixture = setup(format, holder); fixture[holder]!.spells = []; fixture[holder]!.hand = [SWORDS];
  const state: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) {
    fixture[seat]!.monsters = [{ card: ELF, pos: "set" }];
    state[seat] = { monsters: [ELF], spells: seat === holder ? [SWORDS] : [], zones: { m0: { card: ELF, pos: seat === holder ? "set" : "def" } } };
  }
  return proof(`${format}-${holder}-flips-all-opponents`, `${format}: Swords flips every opponent's face-down monster and keeps its controller's monster face-down`,
    fixture, [...before(format, holder), activate(SWORDS, holder),
      board(format, SEATS[format].indexOf(holder) + 1, state)]);
}

function leaves(format: Ffa, holder: Seat, direct: boolean): Scenario {
  const actor = SEATS[format].find(seat => seat !== holder)!;
  const fixture = setup(format, holder); fixture[actor]!.hand = [MST]; fixture[actor]!.monsters = [OX];
  for (const seat of SEATS[format]) if (seat !== actor) fixture[seat]!.monsters = direct && seat === holder ? [] : [ELF];
  const turn = SEATS[format].indexOf(actor) + 1;
  const draws = actor === "p0" ? [] : [ELF];
  const state: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) state[seat] = { monsters: seat === actor ? [OX] : seat === holder ? [] : [ELF],
    ...(seat === actor ? { hand: draws, grave: [MST] } : seat === holder ? { lp: direct ? 6300 : 7100, grave: direct ? [SWORDS] : [SWORDS, ELF] } : {}) };
  return proof(`${format}-${holder}-leaves-${direct ? "direct" : "monster"}`, `${format}: ${holder} loses Swords and ${actor} can attack it ${direct ? "directly" : "at its monster"}`,
    fixture, [...before(format, actor), activate(MST, actor),
      attack(OX, direct ? "direct" : { card: ELF, owner: holder }, actor), ...(direct ? [{ op: "yes", by: actor } as Step] : []), board(format, turn, state)]);
}

function eliminated(format: Ffa, holder: Seat): Scenario {
  const actor = SEATS[format].find(seat => seat !== holder)!;
  const victim = SEATS[format].find(seat => seat !== holder && seat !== actor)!;
  const fixture = setup(format, holder); fixture[holder]!.lp = 500; fixture[holder]!.monsters = [ELF];
  fixture[actor]!.hand = [BURN]; fixture[actor]!.monsters = [OX]; fixture[victim]!.monsters = [ELF];
  const state: Partial<Record<Seat, DuelistExpect>> = { [holder]: { lp: 0, hand: [], grave: [], monsters: [], spells: [] },
    [actor]: { hand: actor === "p0" ? [] : [ELF], monsters: [OX], grave: [BURN] }, [victim]: { lp: 7100, grave: [ELF] } };
  return proof(`${format}-${holder}-eliminated`, `${format}: ${holder} is eliminated by effect damage and its Swords no longer limits attacks`, fixture,
    [...before(format, actor), activate(BURN, actor), pickOpponent(holder, actor), expectEliminated(holder),
      attack(OX, { card: ELF, owner: victim }, actor), board(format, SEATS[format].indexOf(actor) + 1, state)]);
}

function setSwords(format: Ffa, holder: Seat): Scenario {
  const actor = SEATS[format].find(seat => seat !== holder)!;
  const fixture = setup(format, holder);
  fixture[holder]!.spells = [{ card: SWORDS, pos: "set" }];
  const state: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) {
    fixture[seat]!.monsters = [seat === actor ? OX : ELF];
    state[seat] = { monsters: seat === actor ? [OX] : seat === holder ? [] : [ELF],
      ...(seat === holder ? { lp: 7100, grave: [ELF], spells: [SWORDS], zones: { s0: { card: SWORDS, pos: "set" } } } : {}) };
  }
  return proof(`${format}-${holder}-set-swords-control`, `${format}: face-down Swords does not protect ${holder}`, fixture,
    [...before(format, actor), attack(OX, { card: ELF, owner: holder }, actor), board(format, SEATS[format].indexOf(actor) + 1, state)]);
}

function stockControl(format: "tag" | "1v1"): Scenario {
  const seats: Seat[] = format === "tag" ? SEATS.tag : ["p0", "p1"];
  const fixture: Scenario["setup"] = { format, attackFirstTurn: true, skipOpeningDraw: true };
  seats.forEach(seat => { fixture[seat] = { monsters: [ELF], ...(seat === "p0" ? { spells: [SWORDS] } : {}) }; });
  const steps: Step[] = [changePhase("battle", "p0"), expectOffered("attack", ELF, "p0"), endTurn("p0")];
  for (const seat of seats.slice(1)) steps.push(changePhase("battle", seat), seat === "p2" ? expectOffered("attack", ELF, seat) : expectNotOffered("attack", ELF, seat),
    expectBoard(Object.fromEntries(seats.map((owner, i) => [owner, { lp: format === "tag" ? 16000 : 8000, monsters: [ELF],
      spells: owner === "p0" ? [SWORDS] : [], hand: i > 0 && i <= seats.indexOf(seat) ? [ELF] : [], grave: [], banished: [] }]))), endTurn(seat));
  return proof(`${format}-stock-control`, `${format}: the stock Swords attack lock stays on the opponents`, fixture, steps);
}

const standard: Scenario[] = [];
for (const format of ["ffa3", "ffa4"] as const) for (const holder of SEATS[format]) {
  for (const actor of SEATS[format].filter(seat => seat !== holder)) standard.push(monsterTargets(format, holder, actor), monsterTargets(format, holder, actor, true), directTargets(format, holder, actor));
  standard.push(duration(format, holder), flipAll(format, holder), leaves(format, holder, false), leaves(format, holder, true), eliminated(format, holder), setSwords(format, holder));
}
standard.push(stockControl("tag"), stockControl("1v1"));
export const SWORDS_PROTECT_SCENARIOS = standard.flatMap(scenario => [scenario, domainVariant(scenario)]);
