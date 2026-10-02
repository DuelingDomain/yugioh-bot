import { activate, expectEliminated, expectResult, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { domainVariant } from "./domain-variants.js";
import { everySeat, SEATS } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

function lastSeat(format: "ffa3" | "ffa4", draw: boolean): Scenario {
  const setup: Scenario["setup"] = { format };
  const seats = SEATS[format];
  const winner = seats[seats.length - 1];
  for (const seat of seats) setup[seat] = { lp: !draw && seat === winner ? 8000 : 1000 };
  setup.p0 = { ...setup.p0, monsters: ["Mystical Elf"], spells: [{ card: "Destruction Ring", pos: "set" }] };
  return defineScenario({ id: `rule-proof-${format}-simultaneous-${draw ? "draw" : "last-seat-wins"}`,
    title: `${format}: simultaneous damage leaves ${draw ? "no winner" : `only ${winner}, which wins`}`,
    source: `${SOURCE} [R-FFA-WINNER]`, rules: ["R-FFA-WINNER"], tags: ["multiplayer", format, "card:21219755"], setup,
    steps: [activate("Destruction Ring", "p0"), expectEliminated(...seats.filter((seat) => draw || seat !== winner)),
      expectResult(draw ? null : winner), everySeat(format, Object.fromEntries(seats.map((seat) => [seat, {
        lp: !draw && seat === winner ? 7000 : 0, hand: [], extra: [],
      }])) )],
  });
}
const standard = (["ffa3", "ffa4"] as const).flatMap((format) => [lastSeat(format, false), lastSeat(format, true)]);
export const FFA_WINNER_PROOF_SCENARIOS = [...standard, ...standard.map(domainVariant)];
