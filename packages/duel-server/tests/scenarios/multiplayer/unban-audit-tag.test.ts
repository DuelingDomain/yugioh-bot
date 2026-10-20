import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { UNBAN_AUDIT_TAG_SCENARIOS } from "./unban-audit-tag.js";

describeWithCores("Tag audit outcomes and exact member binding on real multi cores", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/unban-audit-tag", UNBAN_AUDIT_TAG_SCENARIOS);
});
