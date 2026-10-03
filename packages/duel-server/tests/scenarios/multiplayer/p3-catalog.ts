// Real-engine proofs for catalog rows changed by the declared-opponent rule.
import {
  activate, attack, changePhase, choose, defineScenario, endTurn, expectBoard, expectPickSeats, expectPrompt, expectPickOptions, specialSummon, yes,
  normalSummon, pickOpponent, select, type BoardExpect, type Scenario, type Step,
} from "../../support/dsl.js";

import { domainVariant } from "./domain-variants.js";

type Mode = "standard" | "domain";
type Format = "ffa3" | "ffa4" | "tag";
type Seat = "p0" | "p1" | "p2" | "p3";
const formats: Format[] = ["ffa3", "ffa4", "tag"];
const seatsOf = (format: Format): Seat[] => format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
const monsters: Record<Seat, string[]> = {
  p0: ["Silver Fang"], p1: ["Mystical Elf", "Battle Ox"],
  p2: ["Beaver Warrior", "Celtic Guardian"], p3: ["Axe Raider", "Gaia The Fierce Knight"],
};
const spells = ["Sparks", "Hinotama"];
const filler = "Skull Servant";
const opponent = (format: Format): Seat => format === "ffa4" || format === "tag" ? "p3" : "p2";
const opposing = (format: Format): Seat[] => format === "tag" ? ["p1", "p3"] : seatsOf(format).slice(1);
function allSeats(format: Format, states: BoardExpect): Step {
  return expectBoard(Object.fromEntries(seatsOf(format).map(seat => [seat, {
    lp: format === "tag" ? 16000 : 8000, monsters: [], spells: [], grave: [], banished: [], hand: [], ...states[seat],
  }])));
}
function proof(format: Format, mode: Mode, slug: string, code: number, setup: Scenario["setup"], steps: Step[], all = false): Scenario {
  return defineScenario({
    id: `p3-catalog-${format}-${slug}`, title: `${format}: ${slug}`,
    source: "docs/adr/0002-multiplayer-duel-rules.md; owner answers 2026-10-02",
    // R-FFA-FIRST-DRAW: all these MR5 tables skip the turn-1 draw in Standard and draw in Domain.
    rules: ["R-FFA-FIRST-DRAW", ...(all ? ["R-COMMON-ALL-BOTH"] : format === "tag" ? ["R-TAG-PARTNER", "R-TAG-SHARED-CARDS"]
      : [(code === 44095762 || code === 88240808) ? "R-FFA-OPP-RESPONSE" : "R-FFA-OPP-ONE"])],
    tags: ["multiplayer", "p3-catalog", format, `card:${code}`, "ffa-first-draw-included"],
    // Snapshots and discard choices already include the mode-specific draw; domainVariant must not add it again.
    setup: { format, ...(mode === "domain" ? { mode } : {}), deckSize: 8, ...setup }, steps,
  });
}
const rows = [
  { name: "Raigeki", code: 12580477 },
  { name: "Harpie's Feather Duster", code: 18144506, spell: true },
  { name: "Dark Magic Attack", code: 2314238, spell: true },
  { name: "Lightning Storm", code: 14532163, option: "Attack Position" },
  { name: "Lightning Storm", code: 14532163, option: "Spell/Trap", spell: true },
  { name: "Lightning Vortex", code: 69162969 },
  { name: "Fissure", code: 66788016 },
];
function wipe(format: Format, mode: Mode, row: typeof rows[number]): Scenario {
  const lightning = row.name === "Lightning Storm";
  const vortex = row.name === "Lightning Vortex";
  const setup: Scenario["setup"] = {};
  const result: BoardExpect = {};
  for (const seat of seatsOf(format)) {
    const own = seat === "p0" || format === "tag" && seat === "p2";
    const field = lightning && own ? [] : row.name === "Dark Magic Attack" && seat === (format === "tag" ? "p2" : "p0")
      ? ["Dark Magician"] : monsters[seat];
    setup[seat] = { monsters: field, spells: spells.map(card => ({ card, pos: "set" })),
      hand: seat === "p0" ? [row.name, ...(vortex ? ["Giant Soldier of Stone"] : [])] : [], deck: Array(8).fill(filler) };
    const hit = format === "tag" ? opposing(format).includes(seat) : seat === opponent(format);
    const lost = row.spell ? (hit ? spells : []) : hit ? (row.name === "Fissure" ? [monsters[format === "tag" ? "p1" : seat][0]] : field) : [];
    // Fissure uses the minimum ATK on the joined opposing field in Tag.
    const monsterLoss = row.name === "Fissure" && format === "tag" ? seat === "p1" ? [monsters.p1[0]] : [] : row.spell ? [] : lost;
    result[seat] = { monsters: field.filter(card => !monsterLoss.includes(card)), spells: row.spell && hit ? [] : spells,
      grave: [...(seat === "p0" ? [row.name, ...(vortex ? ["Giant Soldier of Stone"] : [])] : []),
        ...(row.spell ? lost : monsterLoss)], hand: seat === "p0" && mode === "domain" ? [filler] : [] };
  }
  const steps: Step[] = [activate(row.name, "p0")];
  if (format !== "tag") steps.push(expectPickSeats(opposing(format), "p0"), pickOpponent(opponent(format), "p0"));
  // R-FFA-FIRST-DRAW leaves one cost card in Standard (auto-selected), but two in Domain.
  if (vortex && mode === "domain") steps.push(expectPrompt({ by: "p0", kind: "cards" }),
    expectPickOptions([{ card: "Giant Soldier of Stone", seat: "p0" }, { card: filler, seat: "p0" }], "p0"),
    select("Giant Soldier of Stone"));
  if (lightning) steps.push(expectPrompt({ by: "p0", title: "Select an option" }), choose(row.spell ? "Spells" : "Attack Position", "p0"));
  steps.push(allSeats(format, result));
  return proof(format, mode, `${row.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}${row.option ? `-${row.spell ? "spells" : "monsters"}` : ""}`, row.code, setup, steps);
}
function allWipe(format: Format, mode: Mode, name: string, code: number): Scenario {
  const spell = name === "Heavy Storm";
  const setup: Scenario["setup"] = {};
  const result: BoardExpect = {};
  for (const seat of seatsOf(format)) {
    setup[seat] = { monsters: monsters[seat], spells: spells.map(card => ({ card, pos: "set" })),
      hand: seat === "p0" ? [name] : [], deck: Array(8).fill(filler) };
    result[seat] = { monsters: spell ? monsters[seat] : [], spells: spell ? [] : spells,
      grave: [...(seat === "p0" ? [name] : []), ...(spell ? spells : monsters[seat])],
      hand: seat === "p0" && mode === "domain" ? [filler] : [] };
  }
  return proof(format, mode, name.toLowerCase().replace(/ /g, "-"), code, setup, [activate(name, "p0"), allSeats(format, result)], true);
}
function mirror(format: Format, mode: Mode): Scenario {
  const attacker: Seat = format === "tag" ? "p0" : "p2";
  const defender: Seat = format === "tag" ? "p3" : "p0";
  const setup: Scenario["setup"] = {};
  const result: BoardExpect = {};
  const turns = [...seatsOf(format), ...seatsOf(format).slice(0, seatsOf(format).indexOf(attacker))];
  for (const seat of seatsOf(format)) {
    setup[seat] = { monsters: [monsters[seat][0]], hand: [], deck: Array(8).fill(filler),
      ...(seat === "p1" ? { spells: [{ card: "Mirror Force", pos: "set" }] } : {}) };
    const hit = format === "tag" ? seat === "p0" || seat === "p2" : seat === attacker;
    const draws = turns.filter(turnSeat => turnSeat === seat).length + (seat === attacker ? 1 : 0) - (mode === "standard" && seat === "p0" ? 1 : 0);
    result[seat] = { monsters: hit ? [] : [monsters[seat][0]],
      grave: [...(hit ? [monsters[seat][0]] : []), ...(seat === "p1" ? ["Mirror Force"] : [])], hand: Array(draws).fill(filler) };
  }
  return proof(format, mode, "third-duelist-mirror-force", 44095762, setup, [
    ...turns.map(seat => endTurn(seat)), changePhase("battle", attacker),
    attack(monsters[attacker][0], { card: monsters[defender][0], owner: defender }, attacker), activate("Mirror Force", "p1"),
    allSeats(format, result),
  ]);
}
function torrential(format: Format, mode: Mode): Scenario {
  const setup: Scenario["setup"] = {};
  const result: BoardExpect = {};
  for (const seat of seatsOf(format)) {
    setup[seat] = { monsters: seat === "p1" ? [] : [monsters[seat][0]], deck: Array(8).fill(filler),
      hand: seat === "p1" ? [monsters.p1[0]] : [], ...(seat === "p0" ? { spells: [{ card: "Torrential Tribute", pos: "set" }] } : {}) };
    result[seat] = { grave: [monsters[seat][0], ...(seat === "p0" ? ["Torrential Tribute"] : [])],
      hand: seat === "p0" && mode === "domain" || seat === "p1" ? [filler] : [] };
  }
  return proof(format, mode, "torrential-tribute", 53582587, setup, [endTurn("p0"), normalSummon(monsters.p1[0], "p1"),
    activate("Torrential Tribute", "p0"), allSeats(format, result)], true);
}
function gameciel(format: Format, mode: Mode): Scenario {
  const name = "Gameciel, the Sea Turtle Kaiju";
  const target = opponent(format);
  const setup: Scenario["setup"] = {};
  const result: BoardExpect = {};
  for (const seat of seatsOf(format)) {
    const field = monsters[seat];
    setup[seat] = { monsters: field, hand: seat === "p0" ? [name] : [], deck: Array(8).fill(filler) };
    result[seat] = { monsters: seat === target ? [field[1], name] : field,
      grave: seat === target ? [field[0]] : [], hand: seat === "p0" && mode === "domain" ? [filler] : [],
      deckCount: seat === "p0" && mode === "domain" ? 7 : 8 };
  }
  return proof(format, mode, "gameciel-tribute-controller", 55063751, setup, [
    specialSummon({ card: name, nth: 0 }, "p0"),
    expectPrompt({ by: "p0", context: "opponent" }), expectPickSeats(opposing(format), "p0"), pickOpponent(target, "p0"),
    expectPickOptions({ count: 2, include: monsters[target].map(card => ({ card, seat: target })) }, "p0"),
    select({ card: monsters[target][0], owner: target }), allSeats(format, result),
  ]);
}
function kycoo(format: Format, mode: Mode): Scenario {
  const name = "Kycoo the Ghost Destroyer";
  const target = opponent(format);
  const setup: Scenario["setup"] = {};
  const result: BoardExpect = {};
  for (const seat of seatsOf(format)) {
    const removed = format === "tag" ? seat === "p1" || seat === "p3" ? [monsters[seat][0]] : []
      : seat === target ? monsters[seat] : [];
    const draws = seat === "p0" && mode === "domain" ? 2 : 1;
    setup[seat] = { monsters: seat === "p0" ? [name] : [], grave: monsters[seat], hand: [], deck: Array(8).fill(filler) };
    result[seat] = { monsters: seat === "p0" ? [name] : [], grave: monsters[seat].filter(card => !removed.includes(card)),
      banished: removed, hand: Array(draws).fill(filler), deckCount: 8 - draws,
      lp: (format === "tag" ? 16000 : 8000) - (seat === target || format === "tag" && seat === "p1" ? 1800 : 0) };
  }
  const legal = format === "tag" ? ["p1", "p3"] as Seat[] : [target];
  const targets = format === "tag" ? [{ card: monsters.p1[0], owner: "p1" as const, from: "grave" as const },
    { card: monsters.p3[0], owner: "p3" as const, from: "grave" as const }]
    : monsters[target].map(card => ({ card, owner: target, from: "grave" as const }));
  return proof(format, mode, "kycoo-battle-opponent", 88240808, setup, [
    ...seatsOf(format).map(seat => endTurn(seat)), expectPrompt({ by: "p0" }), changePhase("battle", "p0"),
    attack(name, "direct", "p0"), expectPickSeats(opposing(format), "p0"), pickOpponent(target, "p0"), yes("p0"),
    expectPrompt({ by: "p0", kind: "cards" }),
    expectPickOptions({ count: legal.reduce((count, seat) => count + monsters[seat].length, 0),
      include: legal.flatMap(seat => monsters[seat].map(card => ({ card, seat }))),
      exclude: seatsOf(format).filter(seat => !legal.includes(seat)).flatMap(seat => monsters[seat].map(card => ({ card, seat }))) }, "p0"),
    select(...targets), allSeats(format, result),
  ]);
}
const catalogScenarios = (mode: Mode): Scenario[] => formats.flatMap(format => [
  ...rows.map(row => wipe(format, mode, row)), allWipe(format, mode, "Dark Hole", 53129443), allWipe(format, mode, "Heavy Storm", 19613556),
  mirror(format, mode), torrential(format, mode), gameciel(format, mode), kycoo(format, mode),
]);

export const P3_CATALOG_SCENARIOS: Scenario[] = [...catalogScenarios("standard"), ...catalogScenarios("domain").map(domainVariant)];
