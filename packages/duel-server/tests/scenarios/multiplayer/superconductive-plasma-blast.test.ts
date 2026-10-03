import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { SUPERCONDUCTIVE_PLASMA_BLAST_SCENARIOS } from "./superconductive-plasma-blast.js";

describeWithCores("live Superconductive Plasma Blast scenarios", liveNseat, () => {
  runScenarios("multiplayer/superconductive-plasma-blast", SUPERCONDUCTIVE_PLASMA_BLAST_SCENARIOS);
});
describeWithCores("live Domain Superconductive Plasma Blast scenarios", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/superconductive-plasma-blast-domain", SUPERCONDUCTIVE_PLASMA_BLAST_SCENARIOS.map(scenario => {
    const variant = domainVariant(scenario);
    // Domain draws a second p0 card before Exchange; the recipient now has a real choice.
    if (scenario.id.endsWith("exchanged-card-uses-current-holder-turn")) {
      variant.steps.splice(2, 0, { op: "select", sels: ["Superconductive Plasma Blast"], by: scenario.setup.format === "ffa3" ? "p2" : "p3" });
    }
    return variant;
  }));
});
