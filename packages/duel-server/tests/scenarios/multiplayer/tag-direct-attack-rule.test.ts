import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { TAG_DIRECT_ATTACK_RULE_SCENARIOS } from "./tag-direct-attack-rule.js";

describeWithCores("live Tag direct attack owner rule", liveNseat, () => {
  runScenarios("multiplayer/tag-direct-attack-rule", TAG_DIRECT_ATTACK_RULE_SCENARIOS);
});
describeWithCores("live Domain Tag direct attack owner rule", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/tag-direct-attack-rule-domain", TAG_DIRECT_ATTACK_RULE_SCENARIOS.map(domainVariant));
});
