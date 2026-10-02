import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { ARTIFACT_LANCEA_SCENARIOS } from "./artifact-lancea.js";

describeWithCores("Standard live Artifact Lancea", liveNseat, () => {
  runScenarios("multiplayer/artifact-lancea", ARTIFACT_LANCEA_SCENARIOS);
});
describeWithCores("Domain live Artifact Lancea", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/artifact-lancea-domain", ARTIFACT_LANCEA_SCENARIOS.map(domainVariant));
});
