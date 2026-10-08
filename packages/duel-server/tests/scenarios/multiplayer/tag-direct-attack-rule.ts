// Owner decision 2026-10-07: both opposing duelists' MMZ and EMZ guard the team LP.
import { attack, changePhase, choose, defineScenario, expectLog, expectNoLog, expectPickOptions, expectPickSeats, pickOpponent, select, yes, type Scenario } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseSetup, everySeat, type Seat } from "./seat-kit.js";
import { teamOneVariant } from "./team-variants.js";

const DRAGON = "Blue-Eyes White Dragon", OX = "Battle Ox", FANG = "Silver Fang", SPIDER = "Link Spider";
function guardedMember(empty: "p1" | "p3", emz: boolean, set = false): Scenario {
  const guard: Seat = empty === "p1" ? "p3" : "p1";
  const monster = emz ? SPIDER : OX;
  return defineScenario({
    id: `tag-direct-attack-empty-${empty}-blocked-by-${guard}-${set ? "set-monster" : emz ? "emz" : "mmz"}`,
    title: `Tag: empty ${empty} cannot be attacked directly while ${guard} has a ${emz ? "EMZ" : "MMZ"} monster`,
    source: `${SOURCE} [R-TAG-ATTACK] Konami Tag rules, owner decision 2026-10-07`, rules: ["R-TAG-ATTACK"],
    tags: ["multiplayer", "tag", "battle", "direct-attack"],
    setup: baseSetup("tag", { p0: { monsters: [DRAGON] }, [guard]: { monsters: emz ? [null, null, null, null, null, monster] : [set ? { card: monster, pos: "set" } : monster] } }),
    steps: [changePhase("battle", "p0"),
      expectPickOptions({ include: [{ id: "attack:0", card: DRAGON }], exclude: [{ id: "attack:0", label: "directly" }] }, "p0"),
      attack(DRAGON, { card: monster, owner: guard, from: "mzone" }, "p0"), expectNoLog("is attacked directly"),
      everySeat("tag", { p0: { monsters: [DRAGON] }, [guard]: { grave: [monster], lp: set ? 16000 : emz ? 14000 : 14700 } }),
    ],
  });
}
const bothMembersHaveMonsters = defineScenario({
  id: "tag-direct-attack-both-members-have-monsters",
  title: "Tag: monsters of both opponents remain attack targets, with no direct attack",
  source: `${SOURCE} [R-TAG-ATTACK] Konami Tag rules, owner decision 2026-10-07`, rules: ["R-TAG-ATTACK"],
  tags: ["multiplayer", "tag", "battle", "direct-attack"],
  setup: baseSetup("tag", { p0: { monsters: [DRAGON] }, p1: { monsters: [OX] }, p3: { monsters: [FANG] } }),
  steps: [changePhase("battle", "p0"),
    expectPickOptions({ include: [{ id: "attack:0", card: DRAGON }], exclude: [{ id: "attack:0", label: "directly" }] }, "p0"),
    choose("attack:0", "p0"), expectPickOptions([{ card: OX, seat: "p1" }, { card: FANG, seat: "p3" }], "p0"),
    select({ card: OX, owner: "p1", from: "mzone" }), expectNoLog("is attacked directly"),
    everySeat("tag", { p0: { monsters: [DRAGON] }, p1: { grave: [OX], lp: 14700 }, p3: { monsters: [FANG] } }),
  ],
});
function bothEmpty(defender: "p1" | "p3"): Scenario {
  return defineScenario({
    id: `tag-direct-attack-both-empty-target-${defender}`,
    title: `Tag: both opponents empty permits a direct attack at ${defender}`,
    source: `${SOURCE} [R-TAG-ATTACK] Konami Tag rules, owner decision 2026-10-07`, rules: ["R-TAG-ATTACK"],
    tags: ["multiplayer", "tag", "battle", "direct-attack"],
    setup: baseSetup("tag", { p0: { monsters: [DRAGON] }, p2: { monsters: [OX] } }),
    steps: [changePhase("battle", "p0"), attack(DRAGON, "direct", "p0"),
      expectPickSeats(["p1", "p3"], "p0"), pickOpponent(defender, "p0"),
      expectLog(`Player ${Number(defender[1]) + 1} is attacked directly`),
      everySeat("tag", { p0: { monsters: [DRAGON] }, p2: { monsters: [OX] }, [defender]: { lp: 13000 } }),
    ],
  });
}
const cardGranted = defineScenario({
  id: "tag-direct-attack-card-granted",
  title: "Tag: Jinzo #7 keeps its card-granted direct attack while both opponents have monsters",
  source: `${SOURCE} [R-TAG-ATTACK] card text exception`, rules: ["R-TAG-ATTACK"],
  tags: ["multiplayer", "tag", "battle", "direct-attack", "card:32809211"],
  setup: baseSetup("tag", { p0: { monsters: ["Jinzo #7"] }, p1: { monsters: [OX] }, p3: { monsters: [FANG] } }),
  steps: [changePhase("battle", "p0"), attack("Jinzo #7", "direct", "p0"), yes("p0"), pickOpponent("p3", "p0"),
    everySeat("tag", { p0: { monsters: ["Jinzo #7"] }, p1: { monsters: [OX] }, p3: { monsters: [FANG], lp: 15500 } }),
  ],
});
export const TAG_DIRECT_ATTACK_RULE_SCENARIOS: Scenario[] = [
  ...(["p1", "p3"] as const).flatMap((empty) => {
    const scenario = guardedMember(empty, false, true);
    return [scenario, teamOneVariant(scenario)];
  }),
  ...(["p1", "p3"] as const).flatMap((empty) => [false, true].flatMap((emz) => {
    const scenario = guardedMember(empty, emz);
    return [scenario, teamOneVariant(scenario)];
  })), bothMembersHaveMonsters, teamOneVariant(bothMembersHaveMonsters),
  ...(["p1", "p3"] as const).flatMap((defender) => {
    const scenario = bothEmpty(defender);
    const swapped = teamOneVariant(scenario);
    return [scenario, { ...swapped, steps: swapped.steps.map((s) => s.op === "expectLog" ? expectLog(`Player ${defender === "p1" ? 1 : 3} is attacked directly`) : s) }];
  }),
  cardGranted, teamOneVariant(cardGranted),
];
