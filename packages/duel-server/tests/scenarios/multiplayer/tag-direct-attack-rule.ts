// Owner rule: an empty Tag member may be attacked directly while the partner controls a monster.
import { attack, changePhase, defineScenario, yes, type Scenario } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseSetup, everySeat, type Seat } from "./seat-kit.js";
import { teamOneVariant } from "./team-variants.js";

const DRAGON = "Blue-Eyes White Dragon";
const OX = "Battle Ox";

function emptyMember(empty: "p1" | "p3"): Scenario {
  const guard: Seat = empty === "p1" ? "p3" : "p1";
  return defineScenario({
    id: `tag-direct-attack-empty-${empty}-partner-${guard}-has-monster`,
    title: `Tag: p0 attacks empty ${empty} directly while ${guard} keeps Battle Ox`,
    source: `${SOURCE} [R-TAG-ATTACK] owner decision: check the attacked member only`,
    rules: ["R-TAG-ATTACK"],
    tags: ["multiplayer", "tag", "battle", "direct-attack"],
    setup: baseSetup("tag", { p0: { monsters: [DRAGON] }, [guard]: { monsters: [OX] } }),
    steps: [
      changePhase("battle", "p0"),
      // The real attack option must offer a direct attack. The monster of the partner
      // also gives a monster target, so the core asks whether to attack directly.
      attack(DRAGON, "direct", "p0"), yes("p0"),
      everySeat("tag", { p0: { monsters: [DRAGON] }, [guard]: { monsters: [OX] }, [empty]: { lp: 13000 } }),
    ],
  });
}

export const TAG_DIRECT_ATTACK_RULE_SCENARIOS: Scenario[] = (["p1", "p3"] as const)
  .flatMap((empty) => { const scenario = emptyMember(empty); return [scenario, teamOneVariant(scenario)]; });
