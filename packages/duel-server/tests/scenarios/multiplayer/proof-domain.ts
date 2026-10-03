import type { Scenario } from "../../support/dsl.js";

// These MR5 proof fixtures skip the opening draw in Standard. Domain draws
// once at p0's first Draw Phase in every layout; assert the actual deck top.
export function domainProof(scenario: Scenario, drawCard = "Mystical Elf"): Scenario {
  const spring = scenario.id.endsWith("magical-spring-protects-only-bound-field");
  const tag = scenario.setup.format === "tag";
  return {
    ...scenario, id: `${scenario.id}-domain`,
    setup: { ...scenario.setup, mode: "domain", ...Object.fromEntries(
      (scenario.setup.format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"]).map(seat =>
        [seat, { ...scenario.setup[seat as "p0"], deckMaster: "Blue-Eyes White Dragon" }]),
    ) },
    steps: scenario.steps.map(step => {
      // Spring's FFA one-card draw follows the opening Axe Raider draw, so
      // Battle Ox is the discard. In Tag it draws two cards, retaining Celtic Guardian.
      if (spring && !tag && step.op === "select" && step.sels.includes("Axe Raider"))
        return { ...step, sels: ["Battle Ox"] };
      if (step.op !== "expectBoard") return step;
      return { ...step, board: Object.fromEntries(Object.entries(step.board).map(([seat, state]) => [seat, {
        ...state,
        ...(seat === "p0" ? {
          hand: [...state.hand as string[], spring ? (tag ? "Celtic Guardian" : "Axe Raider") : drawCard],
          deckCount: state.deckCount! - 1,
          ...(spring && !tag ? { grave: (state.grave as string[]).map(card => card === "Axe Raider" ? "Battle Ox" : card) } : {}),
        } : {}),
        deckMaster: { inZone: true, returns: 0, nextCost: 0 },
      }])) };
    }),
  };
}
