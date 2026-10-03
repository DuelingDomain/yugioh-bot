import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { DOMAIN_RETURN_TAX_SCENARIOS } from "./domain-return-tax.js";

describeWithCores("live Domain return tax from seat and team LP", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/domain-return-tax", DOMAIN_RETURN_TAX_SCENARIOS);
});
