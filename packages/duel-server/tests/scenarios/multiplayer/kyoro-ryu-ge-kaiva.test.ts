import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { KYORO_RYU_GE_KAIVA_SCENARIOS } from "./kyoro-ryu-ge-kaiva.js";

describeWithCores("live Kyoro Ryu-Ge Kaiva scenarios", liveNseat, () => {
  runScenarios("multiplayer/kyoro-ryu-ge-kaiva", KYORO_RYU_GE_KAIVA_SCENARIOS);
});
describeWithCores("live Domain Kyoro Ryu-Ge Kaiva scenarios", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/kyoro-ryu-ge-kaiva-domain", KYORO_RYU_GE_KAIVA_SCENARIOS.map(domainVariant));
});
