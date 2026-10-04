import {
  activate, changePosition, defineScenario, faceDown, endTurn, expectBoard, expectPrompt, pickOpponent, select,
  type BoardExpect, type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";

type Format = "ffa3" | "ffa4" | "tag" | "1v1";
const ELF = "Mystical Elf";
const OX = "Battle Ox";
const REMOVE = "Heavy Storm";
const seatsFor = (format: Format): DuelistId[] => format === "1v1" ? ["p0", "p1"]
  : format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];

function theft(format: Format, domain: boolean, thief: DuelistId, victim: DuelistId,
  spell: "Snatch Steal" | "Change of Heart" | "Mind Control"): Scenario {
  const seats = seatsFor(format);
  const ti = seats.indexOf(thief);
  const setup: Scenario["setup"] = { format, ...(domain ? { mode: "domain" } : {}) };
  const draws = seats.map((_, i) => i === 0 ? Number(domain) : Number(i <= ti));
  const continuous = spell === "Snatch Steal";
  for (const seat of seats) setup[seat] = {
    monsters: seat === thief ? [ELF] : seat === victim ? [OX, ELF] : [],
    hand: seat === thief ? [spell, ...(continuous ? [REMOVE] : [])] : [],
    deck: Array(20).fill(ELF), ...(domain ? { deckMaster: "Blue-Eyes White Dragon" } : {}),
  };
  const board = (stolen: boolean, returned: boolean): BoardExpect => Object.fromEntries(seats.map((seat, i) => [seat, {
    lp: format === "tag" ? 16000 : 8000,
    monsters: [...(seat === thief || seat === victim ? [ELF] : []), ...(seat === (stolen ? thief : victim) ? [OX] : [])],
    spells: seat === thief && continuous && !returned ? [spell] : [],
    grave: seat === thief ? continuous ? returned ? [spell, REMOVE] : [] : [spell] : [],
    hand: [...(seat === thief && continuous && !returned ? [REMOVE] : []), ...Array(draws[i]).fill(ELF)],
    deckCount: 20 - draws[i], banished: [], extra: [],
    ...(domain ? { deckMaster: { inZone: true, returns: 0, nextCost: 0 } } : {}),
  }]));
  const steps: Step[] = [...seats.slice(0, ti).map(seat => endTurn(seat)), activate(spell, thief),
    select({ card: OX, owner: victim }), expectPrompt({ by: thief, context: "action" }), expectBoard(board(true, false))];
  if (continuous) {
    // Removing the real equip must return the monster to its prior owner, at every seat.
    steps.push(activate(REMOVE, thief),
      expectPrompt({ by: thief, context: "action" }), expectBoard(board(false, true)));
  } else {
    const next = (ti + 1) % seats.length;
    draws[next]++;
    steps.push(endTurn(thief), expectPrompt({ by: seats[next], context: "action" }), expectBoard(board(false, true)));
  }
  return defineScenario({
    id: `control-steal-${format}-${domain ? "domain" : "standard"}-${spell.toLowerCase().replaceAll(" ", "-")}-${thief}-from-${victim}`,
    title: `${spell}: ${thief} takes and returns ${victim}'s monster`,
    source: "Stock Snatch Steal 45986603, Change of Heart 4031928, Mind Control 37520316; ADR 0002",
    rules: ["R-COMMON-SEP-FIELDS", ...(format.startsWith("ffa") ? ["R-FFA-OPP-ONE"] : format === "tag" ? ["R-TAG-SHARED-CARDS"] : [])],
    tags: ["control-change", format, "stock-card"], setup, steps,
  });
}

function swap(format: Format, domain: boolean, thief: DuelistId): Scenario {
  const seats = seatsFor(format), ti = seats.indexOf(thief);
  const ffa = format.startsWith("ffa");
  const victim = seats[(ti + 1) % seats.length];
  const monsters = ["Battle Ox", "Dark Magician", "Summoned Skull", "Blue-Eyes White Dragon"];
  const setup: Scenario["setup"] = { format, ...(domain ? { mode: "domain" } : {}) };
  const board: BoardExpect = {};
  for (const [i, seat] of seats.entries()) {
    const active = ffa || seat === thief || seat === victim;
    setup[seat] = { monsters: active ? [monsters[i], ELF] : [], hand: seat === thief ? ["Creature Swap"] : [],
      deck: Array(20).fill(ELF), ...(domain ? { deckMaster: "Blue-Eyes White Dragon" } : {}) };
    const received = ffa ? (i + seats.length - 1) % seats.length : seat === thief ? seats.indexOf(victim) : ti;
    const drawn = i === 0 ? Number(domain) : Number(i <= ti);
    board[seat] = { lp: format === "tag" ? 16000 : 8000, monsters: active ? [monsters[received], ELF] : [],
      grave: seat === thief ? ["Creature Swap"] : [], spells: [], banished: [], extra: [],
      hand: Array(drawn).fill(ELF), deckCount: 20 - drawn,
      ...(domain ? { deckMaster: { inZone: true, returns: 0, nextCost: 0 } } : {}) };
  }
  const steps: Step[] = [...seats.slice(0, ti).map(seat => endTurn(seat)), activate("Creature Swap", thief)];
  const picks = ffa ? [...seats.slice(ti), ...seats.slice(0, ti)] : [thief, victim];
  for (const seat of picks) {
    if (format === "tag" && seat === victim) steps.push(pickOpponent(victim, thief));
    steps.push(expectPrompt({ by: seat, kind: "cards" }), select({ card: monsters[seats.indexOf(seat)], owner: seat }));
  }
  steps.push(expectPrompt({ by: thief, context: "action" }), expectBoard(board));
  return defineScenario({ id: `control-steal-${format}-${domain ? "domain" : "standard"}-creature-swap-${thief}`,
    title: `${thief} activates Creature Swap; each seat receives the correct monster`,
    source: "Creature Swap 31036355; stock script in Tag and 1v1; approved FFA rotation overlay",
    rules: ["R-COMMON-SEP-FIELDS", ...(ffa ? ["R-FFA-RESOURCE-ROTATION"] : format === "tag" ? ["R-TAG-SHARED-CARDS"] : [])],
    tags: ["control-change", format, "card:31036355"], setup, steps });
}

export const CONTROL_STEAL_SEAT_SCENARIOS: Scenario[] = [];
for (const domain of [false, true]) for (const format of ["ffa3", "ffa4", "tag", "1v1"] as const) {
  const seats = seatsFor(format);
  for (const [ti, thief] of seats.entries()) {
    for (const [vi, victim] of seats.entries()) {
      if (ti === vi || format === "tag" && ti % 2 === vi % 2) continue;
      for (const spell of ["Snatch Steal", "Change of Heart", "Mind Control"] as const)
        CONTROL_STEAL_SEAT_SCENARIOS.push(theft(format, domain, thief, victim, spell));
    }
    CONTROL_STEAL_SEAT_SCENARIOS.push(swap(format, domain, thief));
  }
}

// Stock Eria creates a numeric EFFECT_SET_CONTROL with SetValue(tp).
// This is the second form of the same Lua-side versus real-seat error.
for (const domain of [false, true]) for (const format of ["ffa3", "ffa4", "tag", "1v1"] as const) {
  const seats = seatsFor(format);
  for (const [ti, thief] of seats.entries()) {
    const victim = seats[(ti + 1) % seats.length];
    const source = "Eria the Water Charmer", target = "Gagagigo", other = "7 Colored Fish";
    const setup: Scenario["setup"] = { format, ...(domain ? { mode: "domain" } : {}) };
    const board: BoardExpect = {};
    for (const [i, seat] of seats.entries()) {
      const drawn = i === 0 ? Number(domain) : Number(i <= ti);
      setup[seat] = { monsters: seat === thief ? [faceDown(source)] : seat === victim ? [target, other] : [],
        deck: Array(20).fill(ELF), ...(domain ? { deckMaster: "Blue-Eyes White Dragon" } : {}) };
      board[seat] = { monsters: seat === thief ? [source, target] : seat === victim ? [other] : [],
        lp: format === "tag" ? 16000 : 8000, spells: [], grave: [], banished: [], extra: [],
        hand: Array(drawn).fill(ELF), deckCount: 20 - drawn,
        ...(domain ? { deckMaster: { inZone: true, returns: 0, nextCost: 0 } } : {}) };
    }
    CONTROL_STEAL_SEAT_SCENARIOS.push(defineScenario({
      id: `control-steal-${format}-${domain ? "domain" : "standard"}-eria-literal-${thief}-from-${victim}`,
      title: `${thief}'s stock Eria takes ${victim}'s WATER monster with a literal control value`,
      source: "Eria the Water Charmer 74364659; stock c74364659.lua SetValue(tp)",
      rules: ["R-COMMON-SEP-FIELDS"], tags: ["control-change", format, "card:74364659"], setup,
      steps: [...seats.slice(0, ti).map(seat => endTurn(seat)), changePosition(source, thief), ...(format.startsWith("ffa") ? [pickOpponent(victim, thief)] : []),
        select({ card: target, owner: victim }), expectPrompt({ by: thief, context: "action" }), expectBoard(board)],
    }));
  }
}
