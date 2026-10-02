import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { LAPLACIAN_SCENARIOS } from "./laplacian.js";

// Live scenarios of Primathmech Laplacian: the number of materials to detach reads the picked opponent (FFA the window of that seat, Tag the joined side with the picked hand).
// Same gate as the other live N-seat files: NSEAT_LIVE=1 and a multi core. Run it on the Standard multi core and again on the Domain multi core
// (NSEAT_WASM=domain-core/dist/ocgcore.multi-domain-P60.sync.wasm).
describeWithCores("live Primathmech Laplacian scenarios", liveNseat, () => {
  runScenarios("multiplayer/laplacian", LAPLACIAN_SCENARIOS);
});

describe("Primathmech Laplacian scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves, an outcome after an action and a card tag", () => {
    expect(new Set(LAPLACIAN_SCENARIOS.map((s) => s.id)).size).toBe(LAPLACIAN_SCENARIOS.length);
    for (const s of LAPLACIAN_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
      expect(s.tags.some((tag) => /^card:\d+$/.test(tag)), s.id).toBe(true);
    }
  });
});
