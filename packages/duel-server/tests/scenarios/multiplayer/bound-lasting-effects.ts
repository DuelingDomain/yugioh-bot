// Owner decision 2026-10-02: an activated lasting effect keeps its declared opponent.
import { activate, defineScenario, endTurn, expectBoard, expectPickSeats, pickOpponent, select, pass,
  type BoardExpect, type Scenario, type Step } from "../../support/dsl.js";
import { withDomainProof } from "./proof-domain.js";
type Format = "ffa3" | "ffa4" | "tag";
type Seat = "p0" | "p1" | "p2" | "p3";
const formats: Format[] = ["ffa3", "ffa4", "tag"];
const seats = (f: Format): Seat[] => f === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
const opps = (f: Format): Seat[] => f === "tag" ? ["p1", "p3"] : seats(f).slice(1);
function board(f: Format, spec: BoardExpect): Step {
  return expectBoard(Object.fromEntries(seats(f).map(s => [s, { lp: f === "tag" ? 16000 : 8000,
    monsters: [], spells: [], grave: [], banished: [],
    hand: [],
    deckCount: 20, ...spec[s] }])));
}
function proof(f: Format, name: string, setup: Scenario["setup"], steps: Step[], rules: string[]): Scenario {
  return defineScenario({ id: `bound-lasting-${f}-${name}`, title: `${f}: ${name}`,
    source: "Owner answers 2026-10-02; docs/adr/0002-multiplayer-duel-rules.md",
    rules, tags: ["multiplayer", "bound-lasting", f], setup: { format: f, ...setup }, steps });
}
function damageLock(f: Format): Scenario {
  const setup: Scenario["setup"] = { p0: { hand: ["Dark Ruler No More", "Hinotama", "Hinotama"] } };
  for (const s of opps(f)) setup[s] = { monsters: ["Man-Eater Bug"] };
  const steps: Step[] = [activate("Dark Ruler No More", "p0")];
  if (f !== "tag") steps.push(expectPickSeats(opps(f), "p0"), pickOpponent("p1", "p0"));
  steps.push(activate("Hinotama", "p0"));
  if (f !== "tag") steps.push(pickOpponent("p1", "p0"));
  steps.push(activate("Hinotama", "p0"));
  if (f !== "tag") steps.push(pickOpponent("p2", "p0"));
  const result: BoardExpect = { p0: { grave: ["Dark Ruler No More", "Hinotama", "Hinotama"] } };
  for (const s of opps(f)) result[s] = { monsters: ["Man-Eater Bug"], lp: f !== "tag" && s === "p2" ? 7500 : f === "tag" ? 16000 : 8000 };
  steps.push(board(f, result));
  return proof(f, "dark-ruler-damage-lock-and-clone-only-bound-seat", setup, steps,
    f === "tag" ? ["R-TAG-SHARED-CARDS"] : ["R-FFA-OPP-ONE", "R-FFA-ACTIVATED-LOCK"]);
}
function fieldLock(f: Format): Scenario {
  const burden = "Burden of the Mighty";
  const setup: Scenario["setup"] = { p0: { hand: ["Magical Spring", "Heavy Storm"], deck: ["Axe Raider", "Battle Ox", "Celtic Guardian", ...Array(8).fill("Mystical Elf")] } };
  for (const s of opps(f)) setup[s] = { spells: [{ card: burden, pos: "up" }] };
  const steps: Step[] = [activate("Magical Spring", "p0")];
  if (f !== "tag") steps.push(expectPickSeats(opps(f), "p0"), pickOpponent("p1", "p0"));
  const discard = f === "tag" ? "Battle Ox" : "Axe Raider";
  steps.push(select(discard), activate("Heavy Storm", "p0"));
  const result: BoardExpect = { p0: { grave: ["Magical Spring", "Heavy Storm", discard],
    hand: f === "tag" ? ["Axe Raider"] : [], deckCount: f === "tag" ? 18 : 19 } };
  for (const s of opps(f)) result[s] = f === "tag" || s === "p1" ? { spells: [burden] } : { grave: [burden] };
  steps.push(board(f, result));
  return withDomainProof(proof(f, "magical-spring-protects-only-bound-field", setup, steps,
    f === "tag" ? ["R-TAG-SHARED-CARDS"] : ["R-FFA-OPP-ONE", "R-FFA-ACTIVATED-LOCK"]), (variant) => ({
    ...variant,
    // Domain draws Axe Raider first. Spring then draws Battle Ox in FFA,
    // or Battle Ox and Celtic Guardian in Tag. The discard stays in this fixture.
    steps: variant.steps.map((step) => {
      if (f !== "tag" && step.op === "select" && step.sels.includes("Axe Raider")) {
        return { ...step, sels: ["Battle Ox"] };
      }
      if (step.op !== "expectBoard" || !step.board.p0) return step;
      const p0 = step.board.p0;
      return { ...step, board: { ...step.board, p0: {
        ...p0,
        hand: f === "tag" ? ["Axe Raider", "Celtic Guardian"] : ["Axe Raider"],
        grave: (p0.grave as string[]).map((card) => card === "Axe Raider" ? "Battle Ox" : card),
      } } };
    }),
  }));
}
function ongoing(f: Format): Scenario {
  const setup: Scenario["setup"] = { p0: { spells: [{ card: "Burden of the Mighty", pos: "up" }] } };
  const result: BoardExpect = { p0: { spells: ["Burden of the Mighty"] } };
  for (const s of seats(f).slice(1)) { setup[s] = { monsters: ["Battle Ox"] }; result[s] = {
    ...(s === "p1" ? { hand: ["Mystical Elf"], deckCount: 19 } : {}),
    monsters: ["Battle Ox"], zones: { m0: { card: "Battle Ox", attack: f === "tag" && s === "p2" ? 1700 : 1300 } } }; }
  return proof(f, "face-up-continuous-still-affects-all-opponents", setup, [endTurn("p0"), board(f, result)], ["R-COMMON-ONGOING"]);
}
function watchedLeave(f: Format): Scenario {
  const ghost = "Ghost Mourner & Moonlit Chill";
  const setup: Scenario["setup"] = { p0: { hand: [ghost] }, p1: { hand: ["Monster Reborn", "Sparks"], grave: ["Battle Ox"] },
    p2: { hand: ["Mystical Elf"], spells: [{ card: "Raigeki Break", pos: "set" }] } };
  const steps: Step[] = [endTurn("p0"), activate("Monster Reborn", "p1"),
    pass("p2"), pass("p2"), activate(ghost, "p0"), pass("p2"), pass("p2"), activate("Sparks", "p1"),
    ...(f !== "tag" ? [pickOpponent("p0", "p1")] : []), activate("Raigeki Break", "p2"), select("Battle Ox")];
  const result: BoardExpect = Object.fromEntries(seats(f).map(s => [s, { hand: [], deckCount: 20 }]));
  result.p0 = { ...result.p0, grave: [ghost], lp: f === "tag" ? 15800 : 7800 };
  result.p1 = { hand: ["Mystical Elf"], deckCount: 19, grave: ["Monster Reborn", "Sparks", "Battle Ox"], lp: f === "tag" ? 14300 : 6300 };
  result.p2 = { ...result.p2, grave: ["Raigeki Break", "Mystical Elf"], lp: f === "tag" ? 15800 : 8000 };
  if (f === "tag") result.p3 = { ...result.p3, lp: 14300 };
  steps.push(board(f, result));
  return proof(f, "watched-monster-leaves-by-third-seat", setup, steps,
    ["R-FFA-OPP-RESPONSE", "R-COMMON-CTRL", ...(f === "tag" ? ["R-TAG-LP"] : [])]);
}
export const BOUND_LASTING_SCENARIOS: Scenario[] = formats.flatMap(f => [damageLock(f), fieldLock(f), ongoing(f), watchedLeave(f)]);
