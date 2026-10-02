import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { TAG_VISIBILITY_SCENARIOS } from "./tag-visibility.js";

describeWithCores("live Tag private card views", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/tag-visibility", TAG_VISIBILITY_SCENARIOS);
});
