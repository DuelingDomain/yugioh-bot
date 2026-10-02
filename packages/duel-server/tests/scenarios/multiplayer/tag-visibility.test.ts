import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { TAG_VISIBILITY_SCENARIOS } from "./tag-visibility.js";

describeWithCores("live Standard Tag private card views", liveNseat, () => {
  runScenarios("multiplayer/tag-visibility", TAG_VISIBILITY_SCENARIOS.filter((scenario) => scenario.setup.mode !== "domain"));
});

describeWithCores("live Domain Tag private card views", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/tag-visibility-domain", TAG_VISIBILITY_SCENARIOS.filter((scenario) => scenario.setup.mode === "domain"));
});
