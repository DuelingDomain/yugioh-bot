import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { TAG_PARTNER_SOURCE_SCENARIOS } from "./tag-partner-source.js";

for (const mode of ["normal", "domain"] as const) {
  const required = mode === "domain" ? [liveNseat, ...needs.domainMulti()] : liveNseat;
  describeWithCores(`live Tag partner source cards (${mode})`, required, () => {
    runScenarios(`multiplayer/tag-partner-source (${mode})`, TAG_PARTNER_SOURCE_SCENARIOS.filter((scenario) => (scenario.setup.mode ?? "normal") === mode));
  });
}
