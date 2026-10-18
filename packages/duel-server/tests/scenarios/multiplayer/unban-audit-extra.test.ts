import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { UNBAN_AUDIT_EXTRA_GAP_SCENARIOS, UNBAN_AUDIT_EXTRA_SCENARIOS } from "./unban-audit-extra.js";

describeWithCores("remaining turn effect live audit", liveNseat, () => {
  runScenarios("multiplayer/unban-audit-extra", UNBAN_AUDIT_EXTRA_SCENARIOS);
  runScenarios("multiplayer/unban-audit-extra-known-gaps", UNBAN_AUDIT_EXTRA_GAP_SCENARIOS);
});
