// Owner 2026-11-22: a 'you win' card ends a multiplayer duel with a win for its owner (the owner's team in Tag) and a loss for every
// other player, like Exodia the Forbidden One (R-COMMON-EXODIA). Number C88: Gimmick Puppet Disaster Leo wins at the End Phase of its controller's turn
// when its opponent has 2000 LP or less. In FFA every living opponent must have 2000 LP or less (owner 2026-11-22; overlay domain-core/multi-scripts/c6165656.lua, the stock condition ran once per living opponent so one was enough). In Tag the stock team LP check stays.
// Plain data; tests/scenarios/multiplayer/alt-win.test.ts runs them on a live core (NSEAT_LIVE=1).
import { activate, defineScenario, endTurn, expectEliminated, expectLp, expectPrompt, expectResult, type Scenario } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseSetup } from "./seat-kit.js";

const LEO = "Number C88: Gimmick Puppet Disaster Leo";
const OOKAZI = "Ookazi"; // 800 damage to one opponent

const ffa3Leo: Scenario = defineScenario({
  id: "alt-win-leo-ffa3",
  title: "FFA3: Disaster Leo gives no win while one opponent has more than 2000 LP",
  source: `${SOURCE} [R-COMMON-EXODIA] owner 2026-11-22`,
  rules: ["R-COMMON-EXODIA"],
  tags: ["multiplayer", "ffa3", "card:6165656"],
  setup: baseSetup("ffa3", { p0: { monsters: [LEO] }, p1: { lp: 1000 }, p2: { lp: 2500 } }),
  steps: [
    expectLp({ seat: "p1" }, 1000), expectLp({ seat: "p2" }, 2500),
    // p1 is at 2000 LP or less but p2 is not, so the End Phase of p0 gives no win.
    endTurn("p0"),
    expectPrompt({ by: "p1", context: "action" }),
  ],
});

const ffa3LeoWin: Scenario = defineScenario({
  id: "alt-win-leo-ffa3-win",
  title: "FFA3: Disaster Leo wins when both opponents have 2000 LP or less, and then both opponents lose without places",
  source: `${SOURCE} [R-COMMON-EXODIA] owner 2026-11-22`,
  rules: ["R-COMMON-EXODIA"],
  tags: ["multiplayer", "ffa3", "card:6165656"],
  setup: baseSetup("ffa3", { p0: { monsters: [LEO] }, p1: { lp: 1000 }, p2: { lp: 1900 } }),
  steps: [
    expectLp({ seat: "p1" }, 1000), expectLp({ seat: "p2" }, 1900),
    endTurn("p0"),
    expectResult({ seat: "p0", reason: "Number C88: Gimmick Puppet Disaster Leo", victory: "alt-win" }),
    expectEliminated("p1", "p2"),
  ],
});

const tagLeo: Scenario = defineScenario({
  id: "alt-win-leo-tag",
  title: "Tag: Disaster Leo wins for its team when the opposing team has 2000 LP or less",
  source: `${SOURCE} [R-COMMON-EXODIA] owner 2026-11-22`,
  rules: ["R-COMMON-EXODIA"],
  tags: ["multiplayer", "tag", "card:6165656"],
  setup: baseSetup("tag", { p0: { monsters: [LEO], hand: [OOKAZI] }, p1: { lp: 2600 }, p3: { lp: 2600 } }),
  steps: [
    expectPrompt({ by: "p0", context: "action" }),
    activate(OOKAZI, "p0"),
    endTurn("p0"),
    expectResult({ team: 0, reason: "Number C88: Gimmick Puppet Disaster Leo", victory: "alt-win" }),
    expectEliminated("p1", "p3"),
  ],
});

export const ALT_WIN_SCENARIOS: Scenario[] = [ffa3Leo, ffa3LeoWin, tagLeo];
