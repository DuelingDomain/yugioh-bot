import { attack, pickOpponent, type Scenario } from "../../support/dsl.js";
import { stressBoard as board, stressScenario as scenario, stressSetup as setup } from "./domain-nseat-stress.js";

export const DOMAIN_NSEAT_STRESS_TARGETS: Scenario[] = (["ffa3", "ffa4", "tag"] as const).map((format) => {
  const target = format === "ffa3" ? "p2" : "p3";
  return scenario(format, "zone-master-does-not-block-a-direct-attack", {
    setup: setup(format, { p0: { monsters: ["Blue-Eyes White Dragon"] } }),
    steps: [attack("Blue-Eyes White Dragon", "direct", "p0"), pickOpponent(target, "p0"),
      board(format, { p0: { monsters: ["Blue-Eyes White Dragon"] }, [target]: { lp: format === "tag" ? 13000 : 5000 } })],
  });
});
