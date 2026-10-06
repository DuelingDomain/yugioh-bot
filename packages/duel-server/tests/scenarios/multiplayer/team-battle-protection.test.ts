import { describeWithCores, needs } from "../../support/cores.js";
import { runScenarios } from "../../support/runner.js";
import { TEAM_BATTLE_PROTECTION_SCENARIOS } from "./team-battle-protection.js";

describeWithCores("team battle protection", [needs.cards(), needs.standard(), needs.domain(), needs.installedMulti()], () => {
  runScenarios("multiplayer/team-battle-protection", TEAM_BATTLE_PROTECTION_SCENARIOS);
});
