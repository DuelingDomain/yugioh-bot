// Owner rule: an empty Tag member may be attacked directly while the partner controls a monster.
import { attack, changePhase, choose, defineScenario, expectLog, expectNoLog, expectPickOptions, select, yes, type Scenario } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseSetup, everySeat, type Seat } from "./seat-kit.js";
import { teamOneVariant } from "./team-variants.js";

const DRAGON = "Blue-Eyes White Dragon";
const OX = "Battle Ox";
const FANG = "Silver Fang";

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

function proveAttackedMember(scenario: Scenario, empty: Seat): Scenario {
  const attacked = Number(empty.slice(1)) + 1;
  return {
    ...scenario,
    steps: [
      ...scenario.steps.slice(0, -1),
      expectLog(`Player ${attacked} is attacked directly`),
      ...([1, 2, 3, 4].filter((seat) => seat !== attacked)
        .map((seat) => expectNoLog(`Player ${seat} is attacked directly`))),
      scenario.steps.at(-1)!,
    ],
  };
}

const bothMembersHaveMonsters = defineScenario({
  id: "tag-direct-attack-both-members-have-monsters",
  title: "Tag: no direct attack is offered when both opposing members control a monster",
  source: `${SOURCE} [R-TAG-ATTACK] neither opposing member is empty`,
  rules: ["R-TAG-ATTACK"],
  tags: ["multiplayer", "tag", "battle", "direct-attack"],
  setup: baseSetup("tag", { p0: { monsters: [DRAGON] }, p1: { monsters: [OX] }, p3: { monsters: [FANG] } }),
  steps: [
    changePhase("battle", "p0"),
    expectPickOptions({ include: [{ id: "attack:0", card: DRAGON }], exclude: [{ id: "attack:0", label: "directly" }] }, "p0"),
    choose("attack:0", "p0"),
    expectPickOptions([{ card: OX, seat: "p1" }, { card: FANG, seat: "p3" }], "p0"),
    select({ card: OX, owner: "p1", from: "mzone" }),
    expectNoLog("is attacked directly"),
    everySeat("tag", { p0: { monsters: [DRAGON] }, p1: { grave: [OX], lp: 14700 }, p3: { monsters: [FANG] } }),
  ],
});

export const TAG_DIRECT_ATTACK_RULE_SCENARIOS: Scenario[] = [
  ...(["p1", "p3"] as const).flatMap((empty) => {
    const scenario = emptyMember(empty);
    return [proveAttackedMember(scenario, empty), proveAttackedMember(teamOneVariant(scenario), empty === "p1" ? "p0" : "p2")];
  }),
  bothMembersHaveMonsters,
  teamOneVariant(bothMembersHaveMonsters),
];
