import { activate, attack, changePhase, defineScenario, endTurn, expectBoard, expectEliminated, expectPrompt, expectTurn, pickOpponent, type DuelistExpect, type Scenario, type Step } from "../../support/dsl.js";
import { domainVariant } from "./domain-variants.js";
import { everySeat, SEATS, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

const ELF = "Mystical Elf";

function ffaFirstBattle(format: "ffa3" | "ffa4", earlyLoss: boolean): Scenario {
  const seats = SEATS[format];
  const living = seats.filter((seat) => !earlyLoss || seat !== "p1");
  const last = living[living.length - 1];
  const setup: Scenario["setup"] = { format };
  for (const seat of seats) setup[seat] = { monsters: [ELF],
    ...(earlyLoss && seat === "p1" ? { lp: 500 } : {}),
    ...(earlyLoss && seat === "p0" ? { hand: ["Hinotama"] } : {}) };
  const steps: Step[] = [expectPrompt({ by: "p0", context: "action", notOffers: ["to_bp"] })];
  if (earlyLoss) steps.push(activate("Hinotama", "p0"), pickOpponent("p1", "p0"), expectEliminated("p1"));
  for (const [index, seat] of living.slice(0, -1).entries()) {
    steps.push(expectTurn(seat, index + 1), expectPrompt({ by: seat, context: "action", notOffers: ["to_bp"] }), endTurn(seat));
  }
  steps.push(expectTurn(last, living.length), expectPrompt({ by: last, context: "action", offers: ["to_bp"] }),
    changePhase("battle", last), attack(ELF, { card: ELF, owner: "p0" }, last),
    expectEliminated(...(earlyLoss ? ["p1" as const] : [])),
    everySeat(format, Object.fromEntries(seats.map((seat) => [seat, {
      lp: earlyLoss && seat === "p1" ? 0 : 8000,
      monsters: seat === "p0" || seat === last || earlyLoss && seat === "p1" ? [] : [ELF],
      hand: earlyLoss && seat === "p1" ? [] : [ELF],
      grave: seat === "p0" ? [...(earlyLoss ? ["Hinotama"] : []), ELF] : seat === last ? [ELF] : [],
      spells: [], banished: [], extra: [], deckCount: earlyLoss && seat === "p1" ? 0 : 19,
    }]))));
  return defineScenario({ id: `df-first-battle-phase-${format}-${earlyLoss ? "early-loss" : "all-live"}`,
    title: `${format}: ${last} battles on turn ${living.length}${earlyLoss ? " after p1 loses before its first turn" : " when the last duelist starts its first turn"}`,
    source: `${SOURCE} [R-FFA-NO-ATTACK]`, rules: ["R-FFA-NO-ATTACK"], tags: ["multiplayer", format, "battle", "ffa-first-draw-included"], setup, steps });
}

function stockControl(format: "tag" | "1v1"): Scenario {
  const seats: Seat[] = format === "tag" ? SEATS.tag : ["p0", "p1"];
  const last = seats[seats.length - 1];
  const setup: Scenario["setup"] = { format };
  for (const seat of seats) setup[seat] = { monsters: [ELF] };
  const steps: Step[] = [];
  for (const [index, seat] of seats.entries()) {
    steps.push(expectTurn(seat, index + 1), expectPrompt({ by: seat, context: "action",
      ...(seat === last ? { offers: ["to_bp"] } : { notOffers: ["to_bp"] }) }));
    if (seat !== last) steps.push(endTurn(seat));
  }
  const board: Record<string, DuelistExpect> = Object.fromEntries(seats.map((seat) => [seat, {
    lp: format === "tag" ? 16000 : 8000, monsters: seat === "p0" || seat === last ? [] : [ELF],
    hand: seat === "p0" ? [] : [ELF], grave: seat === "p0" || seat === last ? [ELF] : [],
    spells: [], banished: [], extra: [], deckCount: seat === "p0" ? 20 : 19,
  }]));
  steps.push(changePhase("battle", last), attack(ELF, { card: ELF, owner: "p0" }, last), expectBoard(board));
  return defineScenario({ id: `df-first-battle-phase-${format}-control`,
    title: `${format}: the first Battle Phase and first draw keep the stock rules`,
    source: `${SOURCE} [${format === "tag" ? "R-TAG-ORDER" : "R-FFA-NO-ATTACK"}]`,
    rules: [format === "tag" ? "R-TAG-ORDER" : "R-FFA-NO-ATTACK"], tags: ["multiplayer", format, "battle"], setup, steps });
}

const ffa = (["ffa3", "ffa4"] as const).flatMap((format) => [ffaFirstBattle(format, false), ffaFirstBattle(format, true)]);
const ffaScenarios = [...ffa, ...ffa.map(domainVariant)];
const controls = [stockControl("tag"), stockControl("1v1")];
export const DF_FIRST_BATTLE_PHASE_SCENARIOS = [...ffaScenarios, ...controls, ...controls.map(domainVariant)];
