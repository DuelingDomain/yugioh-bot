import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { SHARED_LOCATION_DOMAIN_PROOF_SCENARIOS, SHARED_LOCATION_PROOF_SCENARIOS } from "./shared-location-proof.js";

describeWithCores("shared hand and Graveyard locations on both cores", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/shared-location", [...SHARED_LOCATION_PROOF_SCENARIOS, ...SHARED_LOCATION_DOMAIN_PROOF_SCENARIOS]);
});
