import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { KAIRO_RYU_GE_EMVA_SCENARIOS } from "./kairo-ryu-ge-emva.js";

describeWithCores("live Kairo Ryu-Ge Emva scenarios", liveNseat, () => {
  runScenarios("multiplayer/kairo-ryu-ge-emva", KAIRO_RYU_GE_EMVA_SCENARIOS);
});
describeWithCores("live Domain Kairo Ryu-Ge Emva scenarios", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/kairo-ryu-ge-emva-domain", KAIRO_RYU_GE_EMVA_SCENARIOS.map(domainVariant));
});
