import {
  activate, attack, changePhase, defineScenario, endTurn, expectBoard, expectNotOffered, expectSeatNotOffered,
  expectOffered, expectPickSeats, expectPrompt, faceDown, pass, pickOpponent,
  type BoardExpect, type Scenario, type Step,
} from "../../support/dsl.js";

type Seat = "p0" | "p1" | "p2" | "p3";
type Format = "ffa3" | "ffa4" | "tag";
const seats = (format: Format): Seat[] => format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
const ELF = "Mystical Elf";
const CURE = "Dian Keto the Cure Master";
const ROAR = "Threatening Roar";
const DUST = "Dust Storm of Gusto";
const GUSTO = "Gusto Gulldo";
const OX = "Battle Ox";
const WABOKU = "Waboku";
const DM = { inZone: true, returns: 0, nextCost: 0 };

function scenario(format: Format, name: string, setup: Scenario["setup"], steps: Step[], domain: boolean): Scenario {
  const result: Scenario["setup"] = { format, attackFirstTurn: true, ...setup, ...(domain ? { mode: "domain" } : {}) };
  for (const seat of seats(format)) result[seat] = {
    deck: Array(20).fill(ELF), ...result[seat], ...(domain ? { deckMaster: "Blue-Eyes White Dragon" } : {}),
  };
  return defineScenario({ id: `activation-only-lock-${format}-${name}${domain ? "-domain" : ""}`,
    title: `${format}: ${name}${domain ? " (Domain)" : ""}`, setup: result, steps,
    source: "Owner answers 2026-10-02; R-FFA-ACTIVATED-LOCK", rules: ["R-FFA-ACTIVATED-LOCK", "R-FFA-OPP-ONE"],
    tags: ["multiplayer", "activation-only-lock", format, ...(domain ? ["domain"] : [])] });
}

function finalBoard(format: Format, domain: boolean, spec: BoardExpect, drawn: (seat: Seat) => number): Step {
  const board: BoardExpect = {};
  for (const seat of seats(format)) {
    const draws = drawn(seat);
    board[seat] = { lp: format === "tag" ? 16000 : 8000, monsters: [], spells: [], grave: [], banished: [],
      hand: Array(draws).fill(ELF), deckCount: 20 - draws,
      ...(domain ? { deckMaster: DM } : {}), ...spec[seat] };
  }
  return expectBoard(board);
}

function roar(format: Format, blocked: boolean, domain: boolean): Scenario {
  const ss = seats(format);
  const actor = "p0";
  const setup: Scenario["setup"] = { p1: { spells: [faceDown(ROAR)] }, p2: { monsters: [ELF] },
    p0: { hand: [CURE], monsters: [OX] } };
  const steps: Step[] = [activate(CURE, actor), activate(ROAR, "p1")];
  if (format !== "tag") steps.push(expectPickSeats(ss.filter(s => s !== "p1"), "p1"), pickOpponent(blocked ? actor : "p2", "p1"));
  steps.push(expectPrompt({ by: actor, context: "action" }), changePhase("battle", actor));
  const board: BoardExpect = { p1: { grave: [ROAR] }, p2: { monsters: [ELF] },
    p0: { monsters: [OX], grave: [CURE], lp: format === "tag" ? 17000 : 9000 } };
  if (blocked || format === "tag") {
    steps.push(expectNotOffered("attack", OX, actor));
    if (format === "tag") board.p2!.lp = 17000;
  } else {
    steps.push(expectOffered("attack", OX, actor), attack(OX, { card: ELF, owner: "p2" }, actor));
    board.p2 = { grave: [ELF], lp: 7100 };
  }
  steps.push(finalBoard(format, domain, board, seat => seat === "p0" && domain ? 1 : 0));
  return scenario(format, `threatening-roar-${blocked || format === "tag" ? "blocks-declared-attacker" : "spares-undeclared-attacker"}`, setup, steps, domain);
}

function dust(format: Format, domain: boolean): Scenario {
  const ss = seats(format);
  const setup: Scenario["setup"] = { p0: { monsters: [GUSTO], spells: [faceDown(DUST)] } };
  for (const seat of ss.slice(1)) setup[seat] = { spells: [faceDown(WABOKU)] };
  const steps: Step[] = [activate(DUST, "p0")];
  if (format !== "tag") steps.push(expectPickSeats(ss.slice(1), "p0"), pickOpponent("p1", "p0"));
  // Resolve Dust Storm without spending the traps that will prove its lasting scope.
  steps.push(pass("p1"));
  if (format !== "tag") steps.push(pass("p2"));
  if (format !== "ffa3") steps.push(pass("p3"));
  if (format === "tag") steps.push(pass("p2"));
  steps.push(pass("p1"));
  if (format !== "tag") steps.push(pass("p2"));
  if (format !== "ffa3") steps.push(pass("p3"));
  if (format === "tag") steps.push(pass("p2"));
  steps.push(changePhase("battle", "p0"), pass("p1"));
  if (format !== "tag") steps.push(pass("p2"));
  if (format !== "ffa3") steps.push(pass("p3"));
  if (format === "tag") steps.push(pass("p2"));
  steps.push(pass("p1"), pass("p2"));
  if (format !== "ffa3") steps.push(pass("p3"));
  steps.push(attack(GUSTO, "direct", "p0"), pickOpponent("p1", "p0"));
  const board: BoardExpect = { p0: { monsters: [GUSTO], grave: [DUST] } };
  for (const seat of ss.slice(1)) board[seat] = { spells: [WABOKU] };
  if (format === "tag") {
    steps.push(expectSeatNotOffered("activate", WABOKU, "p1"), expectSeatNotOffered("activate", WABOKU, "p3"), expectOffered("activate", WABOKU, "p2"), activate(WABOKU, "p2"));
    board.p2 = { grave: [WABOKU] };
    board.p1!.lp = board.p3!.lp = 15500;
  } else {
    // p1 has a legal response trap but the lock skips it. Every other seat gets its own real attack response.
    steps.push(expectSeatNotOffered("activate", WABOKU, "p1"), expectOffered("activate", WABOKU, "p2"), activate(WABOKU, "p2"));
    board.p2 = { grave: [WABOKU] };
    if (format === "ffa4") { steps.push(expectOffered("activate", WABOKU, "p3"), activate(WABOKU, "p3")); board.p3 = { grave: [WABOKU] }; }
    board.p1!.lp = 7500;
  }
  steps.push(expectPrompt({ by: "p0", context: "action" }), finalBoard(format, domain, board, seat => seat === "p0" && domain ? 1 : 0));
  return scenario(format, "dust-storm-lock-spares-other-seats", setup, steps, domain);
}

const formats: Format[] = ["ffa3", "ffa4", "tag"];
export const ACTIVATION_ONLY_LOCK_SCENARIOS: Scenario[] = [false, true].flatMap(domain => formats.flatMap(format => [
  roar(format, true, domain), ...(format === "tag" ? [] : [roar(format, false, domain)]), dust(format, domain),
]));
