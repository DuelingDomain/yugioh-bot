import type { Scenario } from "../../support/dsl.js";

type DomainProofChange = (variant: Scenario) => Scenario;
const domainProofChanges = new WeakMap<Scenario, DomainProofChange>();

/** Keep the card fixture change in the scenario that owns the card. */
export function withDomainProof(scenario: Scenario, change: DomainProofChange): Scenario {
  domainProofChanges.set(scenario, change);
  return scenario;
}

// Standard MR5 skips the turn-1 draw. Domain draws for every duelist.
export function domainProof(scenario: Scenario, drawCard = "Mystical Elf"): Scenario {
  const out = new Set<string>();
  const variant: Scenario = {
    ...scenario, id: `${scenario.id}-domain`,
    setup: { ...scenario.setup, mode: "domain", ...Object.fromEntries(
      (scenario.setup.format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"]).map(seat =>
        [seat, { ...scenario.setup[seat as "p0"], deckMaster: "Blue-Eyes White Dragon" }]),
    ) },
    steps: scenario.steps.map(step => {
      if (step.op === "expectEliminated") step.seats.forEach(seat => out.add(seat));
      if (step.op !== "expectBoard") return step;
      return { ...step, board: Object.fromEntries(Object.entries(step.board).map(([seat, state]) => [seat, {
        ...state,
        ...(seat === "p0" && !out.has(seat) ? {
          ...(Array.isArray(state.hand) ? { hand: [...state.hand, drawCard] } : {}),
          ...(state.deckCount !== undefined ? { deckCount: state.deckCount - 1 } : {}),
        } : {}),
        deckMaster: { inZone: !out.has(seat), returns: 0, nextCost: 0 },
      }])) };
    }),
  };
  return domainProofChanges.get(scenario)?.(variant) ?? variant;
}
