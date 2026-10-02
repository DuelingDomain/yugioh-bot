import { describe, expect, it } from "vitest";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { AA_ZEUS_SCENARIOS } from "./aa-zeus.js";
import { domainVariant } from "./domain-variants.js";

describeWithCores("Standard live Divine Arsenal AA-ZEUS - Sky Thunder", liveNseat, () => {
  runScenarios("multiplayer/aa-zeus", AA_ZEUS_SCENARIOS);
});
describeWithCores("Domain live Divine Arsenal AA-ZEUS - Sky Thunder", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/aa-zeus-domain", AA_ZEUS_SCENARIOS.map(domainVariant));
});
describe("AA-ZEUS scenario list", () => {
  it("checks every seat after a real battle in every format", () => {
    expect(new Set(AA_ZEUS_SCENARIOS.map((s) => s.id)).size).toBe(AA_ZEUS_SCENARIOS.length);
    for (const s of AA_ZEUS_SCENARIOS) {
      const board = s.steps.findLast((step) => step.op === "expectBoard");
      expect(board?.op).toBe("expectBoard");
      if (board?.op === "expectBoard") expect(Object.keys(board.board)).toHaveLength(s.setup.format === "ffa3" ? 3 : 4);
      expect(s.steps.some((step) => step.op === "attack")).toBe(true);
    }
  });
});
