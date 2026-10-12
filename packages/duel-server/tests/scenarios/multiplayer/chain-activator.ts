import { activate, choose, defineScenario, expectBoard, expectChain, expectEvents, expectPrompt, pickOpponent, type Scenario } from "../../support/dsl.js";

export function mausoleumActivatorScenario(format: "1v1" | "ffa3" | "ffa4"): Scenario {
  return defineScenario({
    id: `${format}-opponents-mausoleum-activator`,
    title: `${format}: the player using another player's Mausoleum owns the chain link`,
    source: "Mausoleum of the Emperor card text; GitHub issue #331",
    tags: ["chain", "both-side", format],
    setup: {
      format,
      p0: { hand: ["Summoned Skull", "Blue-Eyes White Dragon"], spells: [{ card: "Waboku", pos: "set" }] },
      p1: { field: "Mausoleum of the Emperor", spells: [{ card: "Waboku", pos: "set" }] },
      ...(format !== "1v1" ? { p2: { spells: [{ card: "Waboku", pos: "set" as const }] } } : {}),
      ...(format === "ffa4" ? { p3: { spells: [{ card: "Waboku", pos: "set" as const }] } } : {}),
    },
    steps: [
      activate({ card: "Mausoleum of the Emperor", owner: "p1" }, "p0"),
      ...(format !== "1v1" ? [pickOpponent("p1", "p0")] : []),
      // Both tribute requirements are available, so the activation includes a separate target/LP choice.
      choose("requires 1 Tribute", "p0"),
      expectBoard({ p0: { lp: 7000 }, p1: { lp: 8000 } }),
      expectChain("Mausoleum of the Emperor"),
      expectPrompt({ by: "p1", context: "chain" }),
      expectEvents({ kind: "activate", card: "Mausoleum of the Emperor", by: "p0", text: "Mausoleum of the Emperor is activating" }),
    ],
  });
}

export const CHAIN_ACTIVATOR_SCENARIOS = (["ffa3", "ffa4"] as const).map(mausoleumActivatorScenario);
