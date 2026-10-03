// Owner decision 2026-10-02: an activated FFA effect declares one opponent.
import {
  activate, attack, changePhase, choose, defineScenario, endTurn, expectBoard, expectPickSeats, expectPickOptions, expectNotOffered,
  expectPrompt, normalSummon, pickOpponent, select, xyz, type BoardExpect, type Scenario, type Step,
} from "../../support/dsl.js";

type Format = "ffa3" | "ffa4" | "tag";
type Seat = "p0" | "p1" | "p2" | "p3";
const formats: Format[] = ["ffa3", "ffa4", "tag"];
const seats = (f: Format): Seat[] => f === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
const mon: Record<Seat, string> = { p0: "Mystical Elf", p1: "Battle Ox", p2: "Celtic Guardian", p3: "Axe Raider" };
const spell = "Sparks";
const opponents = (f: Format): Seat[] => f === "tag" ? ["p1", "p3"] : seats(f).slice(1);
function board(f: Format, spec: BoardExpect): Step {
  return expectBoard(Object.fromEntries(seats(f).map(s => [s, { lp: f === "tag" ? 16000 : 8000,
    monsters: [], spells: [], grave: [], banished: [],
    hand: [],
    deckCount: 20, ...spec[s] }])));
}
function scenario(f: Format, name: string, setup: Scenario["setup"], steps: Step[]): Scenario {
  return defineScenario({ id: `declared-opponent-${f}-${name}`, title: `${f}: ${name}`,
    source: "Owner answers 2026-10-02; docs/adr/0002-multiplayer-duel-rules.md",
    rules: ["R-COMMON-OPP-PICK"], tags: ["multiplayer", "declared-opponent", f], setup: { format: f, ...setup }, steps });
}
function wipe(f: Format, card: string): Scenario {
  const st = card === "Harpie's Feather Duster";
  const lightning = card === "Lightning Storm";
  const setup: Scenario["setup"] = {};
  for (const s of seats(f)) setup[s] = { monsters: lightning && (s === "p0" || (f === "tag" && s === "p2")) ? [] : [mon[s]],
    spells: [{ card: spell, pos: "set" }], ...(s === "p0" ? { hand: [card] } : {}) };
  const steps: Step[] = [activate(card, "p0")];
  if (f !== "tag") steps.push(expectPickSeats(opponents(f), "p0"), pickOpponent("p2", "p0"));
  if (lightning) steps.push(expectPrompt({ by: "p0", kind: "choice", title: "Select an option" }), choose("Attack Position", "p0"));
  const result: BoardExpect = {};
  for (const s of seats(f)) {
    const hit = f === "tag" ? opponents(f).includes(s) : s === "p2";
    result[s] = { monsters: st || !hit ? (setup[s]?.monsters as string[]) : [],
      spells: st && hit ? [] : [spell], grave: [...(s === "p0" ? [card] : []), ...(hit ? [st ? spell : mon[s]] : [])] };
  }
  steps.push(board(f, result));
  return scenario(f, card.toLowerCase().replace(/[^a-z0-9]+/g, "-"), setup, steps);
}
function allWipe(f: Format, card: string): Scenario {
  const st = card === "Heavy Storm" || card === "Giant Trunade";
  const bounce = card === "Giant Trunade";
  const setup: Scenario["setup"] = {};
  for (const s of seats(f)) setup[s] = { monsters: [mon[s]], spells: [{ card: spell, pos: "set" }],
    ...(s === "p0" ? { hand: [card] } : {}) };
  const result: BoardExpect = {};
  for (const s of seats(f)) result[s] = { monsters: st ? [mon[s]] : [], spells: st ? [] : [spell],
    ...(bounce ? { hand: [spell] } : {}), grave: [...(s === "p0" ? [card] : []), ...(!bounce ? [st ? spell : mon[s]] : [])] };
  return scenario(f, `all-${card.toLowerCase().replace(/ /g, "-")}`, setup, [activate(card, "p0"), board(f, result)]);
}
function legalOnly(f: Format): Scenario {
  const target: Seat = f === "ffa4" ? "p3" : f === "tag" ? "p3" : "p2";
  return scenario(f, "only-opponent-with-monsters-binds-without-pick", { p0: { hand: ["Raigeki"], monsters: [mon.p0] },
    [target]: { monsters: [mon[target]] } }, [activate("Raigeki", "p0"), board(f, {
      p0: { monsters: [mon.p0], grave: ["Raigeki"] }, [target]: { grave: [mon[target]] },
    })]);
}
function targetCards(f: Format): Scenario {
  const setup: Scenario["setup"] = { p0: { hand: ["D.D. Crow"] } };
  for (const s of opponents(f)) setup[s] = { grave: [mon[s], "Silver Fang"] };
  const target: Seat = f === "tag" ? "p3" : "p2";
  const steps: Step[] = [activate("D.D. Crow", "p0")];
  if (f !== "tag") steps.push(expectPickSeats(opponents(f), "p0"), pickOpponent(target, "p0"));
  steps.push(select({ card: mon[target], owner: target, from: "grave" }));
  const result: BoardExpect = { p0: { grave: ["D.D. Crow"] } };
  for (const s of opponents(f)) result[s] = s === target ? { grave: ["Silver Fang"], banished: [mon[s]] } : { grave: [mon[s], "Silver Fang"] };
  steps.push(board(f, result));
  return scenario(f, "graveyard-opponent-before-card", setup, steps);
}
function mirror(f: Format): Scenario {
  // p1 may answer an attack by p2 (FFA) or p0 (Tag) at a third duelist.
  const attacker: Seat = f === "tag" ? "p0" : "p2";
  const defender: Seat = f === "tag" ? "p3" : "p0";
  const setup: Scenario["setup"] = {};
  for (const s of seats(f)) setup[s] = { monsters: [mon[s]], ...(s === "p1" ? { spells: [{ card: "Mirror Force", pos: "set" }] } : {}) };
  const steps: Step[] = [...seats(f).map(s => endTurn(s)),
    ...seats(f).slice(0, seats(f).indexOf(attacker)).map(s => endTurn(s)),
    changePhase("battle", attacker), attack(mon[attacker], { card: mon[defender], owner: defender }, attacker), activate("Mirror Force", "p1")];
  const result: BoardExpect = {};
  for (const s of seats(f)) { const hit = f === "tag" ? s === "p0" || s === "p2" : s === attacker;
    const draws = s === "p0" || f === "tag" || s === "p3" ? 1 : 2;
    result[s] = { hand: Array(draws).fill("Mystical Elf"), deckCount: 20 - draws, monsters: hit ? [] : [mon[s]], grave: [...(hit ? [mon[s]] : []), ...(s === "p1" ? ["Mirror Force"] : [])] }; }
  steps.push(board(f, result));
  return scenario(f, "mirror-force-by-third-duelist-only-hits-attacker", setup, steps);
}
function torrential(f: Format): Scenario {
  const setup: Scenario["setup"] = { p0: { spells: [{ card: "Torrential Tribute", pos: "set" }] }, p1: { hand: [mon.p1] } };
  for (const s of seats(f).filter(s => s !== "p1")) setup[s] = { ...setup[s], monsters: [mon[s]] };
  const result: BoardExpect = {};
  for (const s of seats(f)) result[s] = { grave: [mon[s], ...(s === "p0" ? ["Torrential Tribute"] : [])],
    ...(s === "p1" ? { hand: ["Mystical Elf"], deckCount: 19 } : {}) };
  return scenario(f, "torrential-still-hits-every-seat", setup, [endTurn("p0"), normalSummon(mon.p1, "p1"), activate("Torrential Tribute", "p0"), board(f, result)]);
}
function banished(f: Format): Scenario {
  const card = "Terrors of the Underroot";
  const setup: Scenario["setup"] = { p0: { spells: [{ card, pos: "set" }] } };
  for (const s of opponents(f)) setup[s] = { grave: [mon[s], "Silver Fang"], ...(s !== "p1" ? { banished: ["Mystical Elf", "Beaver Warrior"] } : {}) };
  const target: Seat = f === "ffa4" || f === "tag" ? "p3" : "p2";
  const steps: Step[] = [endTurn("p0"), activate(card, "p0")];
  if (f === "ffa4") steps.push(expectPickSeats(["p2", "p3"], "p0"), pickOpponent(target, "p0"));
  if (f !== "tag") steps.push(expectPickOptions([{ seat: target, card: mon[target] }, { seat: target, card: "Silver Fang" }], "p0"));
  steps.push(select({ card: mon[target], owner: target, from: "grave" }), select({ card: "Mystical Elf", owner: target, from: "banished" }));
  const result: BoardExpect = { p0: { grave: [card] } };
  for (const s of opponents(f)) result[s] = s === target ? { grave: ["Silver Fang", "Mystical Elf"], banished: [mon[s], "Beaver Warrior"] }
    : { grave: [mon[s], "Silver Fang"], banished: s === "p1" ? [] : ["Mystical Elf", "Beaver Warrior"] };
  // endTurn reaches p1's Main Phase before the Trap activates.
  result.p1 = { ...result.p1, hand: ["Mystical Elf"], deckCount: 19 };
  steps.push(board(f, result));
  return scenario(f, "grave-and-banished-reads-share-legal-opponent", setup, steps);
}
function anyCondition(f: Format): Scenario {
  const card = "Terminal World NEXT";
  const setup: Scenario["setup"] = { p0: { hand: [card] } };
  const result: BoardExpect = { p0: { spells: f === "tag" ? [] : [card],
    ...(f === "tag" ? { hand: [card] } : {}) },
    ...(f === "tag" ? { p1: { hand: ["Mystical Elf"], deckCount: 19 } } : {}) };
  for (const s of opponents(f)) { setup[s] = { monsters: [mon[s], "Silver Fang"] }; result[s] = { ...result[s], monsters: [mon[s], "Silver Fang"] }; }
  const steps: Step[] = f === "tag" ? [expectNotOffered("activate", card, "p0"), endTurn("p0")]
    : [activate(card, "p0"), expectPickSeats(opponents(f), "p0"), pickOpponent("p1", "p0")];
  steps.push(board(f, result));
  return scenario(f, "condition-only-one-opponent-is-enough", setup, steps);
}
function bothMaterials(f: Format): Scenario {
  const card = "Night Papilloperative";
  const setup: Scenario["setup"] = { p0: { monsters: [xyz(card, ["Mystical Elf"])] } };
  const result: BoardExpect = { p0: { monsters: [card], grave: ["Mystical Elf"],
    zones: { m0: { card, materials: 0, attack: 2600 + 600 * (seats(f).length - 1) } } } };
  for (const s of seats(f).slice(1)) {
    setup[s] = { monsters: [xyz("Number 39: Utopia", ["Silver Fang", "Battle Ox"])] };
    result[s] = { monsters: ["Number 39: Utopia"], zones: { m0: { card: "Number 39: Utopia", materials: 2, attack: 2500 } } };
  }
  return scenario(f, "both-fields-count-all-xyz-materials", setup, [activate(card, "p0"), board(f, result)]);
}
export const DECLARED_OPPONENT_SCENARIOS: Scenario[] = formats.flatMap(f => [
  ...["Raigeki", "Harpie's Feather Duster", "Lightning Storm"].map(c => wipe(f, c)), legalOnly(f), targetCards(f), banished(f), anyCondition(f), mirror(f),
  ...["Dark Hole", "Heavy Storm", "Giant Trunade"].map(c => allWipe(f, c)), torrential(f), bothMaterials(f),
]);
