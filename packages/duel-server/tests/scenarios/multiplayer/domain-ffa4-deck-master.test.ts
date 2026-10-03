import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { DOMAIN_FFA4_DECK_MASTER_SCENARIOS } from "./domain-ffa4-deck-master.js";

// FFA4 Deck Master scenarios in a Domain duel. Same gate as the other live N-seat files (NSEAT_LIVE=1), plus the Domain multi core.
describeWithCores("live Domain FFA4 Deck Master scenarios", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/domain-ffa4-deck-master", DOMAIN_FFA4_DECK_MASTER_SCENARIOS);
});

describe("Domain FFA4 Deck Master scenario list", () => {
  it("has unique ids, a source, a 4-seat Domain duel with a Deck Master for each seat, the rules it proves and an outcome after an action", () => {
    expect(new Set(DOMAIN_FFA4_DECK_MASTER_SCENARIOS.map((s) => s.id)).size).toBe(DOMAIN_FFA4_DECK_MASTER_SCENARIOS.length);
    for (const s of DOMAIN_FFA4_DECK_MASTER_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(s.setup.mode, s.id).toBe("domain");
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBe(4);
      for (const seat of ["p0", "p1", "p2", "p3"] as const) expect(s.setup[seat]?.deckMaster, `${s.id} ${seat}`).toBeTruthy();
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
    }
  });
});
