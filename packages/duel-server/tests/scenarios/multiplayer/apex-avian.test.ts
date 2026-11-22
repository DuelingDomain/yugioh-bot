import { afterAll, beforeAll, vi } from "vitest";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { APEX_AVIAN_SCENARIOS } from "./apex-avian.js";

describeWithCores("Domain live Mist Valley Apex Avian", [liveNseat, ...needs.domainMulti()], () => {
  // The stock script raised a card script error at every chain link; strict mode turns that into a failure.
  beforeAll(() => { vi.stubEnv("DUEL_SCRIPT_ERRORS", "strict"); });
  afterAll(() => { vi.unstubAllEnvs(); });
  runScenarios("multiplayer/apex-avian-domain", APEX_AVIAN_SCENARIOS.map(domainVariant));
});
