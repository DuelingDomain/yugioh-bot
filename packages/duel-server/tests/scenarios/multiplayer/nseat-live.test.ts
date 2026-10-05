import { describe, expect, it } from "vitest";
import { seatCountFor, teamOfSeat } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import type { Scenario } from "../../support/dsl.js";
import { DSL_STEP_SCENARIOS } from "./nseat-dsl-steps.js";
import { FFA_SCENARIOS } from "./nseat-ffa.js";
import { TAG_SCENARIOS } from "./nseat-tag.js";
import { domainVariant } from "./domain-variants.js";

// Live N-seat scenarios beyond the basic list in nseat.test.ts: Tag and FFA end states. Same gate: NSEAT_LIVE=1 and a multi core with
// Debug.SetupDuelists (tests/support/live-nseat.ts). With DUEL_REQUIRE_CORES=1 a closed gate fails the run instead of skipping.

describeWithCores("live N-seat scenarios: Tag", liveNseat, () => {
  runScenarios("multiplayer/nseat-tag", TAG_SCENARIOS);
});

describeWithCores("live N-seat scenarios: FFA", liveNseat, () => {
  runScenarios("multiplayer/nseat-ffa", FFA_SCENARIOS);
});

describeWithCores("live N-seat scenarios: DSL steps", liveNseat, () => {
  runScenarios("multiplayer/nseat-dsl-steps", DSL_STEP_SCENARIOS);
});

describeWithCores("live Domain N-seat leave scenarios", [liveNseat, ...needs.domainMulti()], () => {
  // These two-card deck-out fixtures start after the opening Draw Phase.
  runScenarios("multiplayer/nseat-ffa-domain-leave", FFA_SCENARIOS.filter((scenario) =>
    scenario.tags.some((tag) => tag === "elimination")).map((scenario) => domainVariant(
      scenario.setup.deckSize === 2 ? { ...scenario, setup: { ...scenario.setup, skipOpeningDraw: true } } : scenario)));
});

const LISTS: Array<[string, Scenario[]]> = [["Tag", TAG_SCENARIOS], ["FFA", FFA_SCENARIOS], ["DSL steps", DSL_STEP_SCENARIOS]];

describe("live N-seat scenario lists", () => {
  for (const [name, list] of LISTS) {
    it(`${name}: unique ids, a source, a multi-seat format, the rules it proves and an outcome after an action`, () => {
      expect(new Set(list.map((s) => s.id)).size).toBe(list.length);
      for (const s of list) {
        expect(s.source, s.id).toBeTruthy();
        expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
        if (!s.knownBug) {
          expect(s.rules?.length, s.id).toBeGreaterThan(0);
          expect(outcomeAsserts(s.steps), s.id).toBe(true);
        }
      }
    });

    it(`${name}: asks for an opponent pick only while the attacker has two or more opponents alive`, () => {
      const seatOf = (id: string) => Number(id.slice(1));
      for (const s of list) {
        const format = s.setup.format ?? "1v1";
        const dead = new Set<number>();
        for (const step of s.steps) {
          if (step.op === "expectEliminated") step.seats.forEach((id) => dead.add(seatOf(id)));
          if (step.op !== "pickOpponent") continue;
          expect(step.by, `${s.id}: pickOpponent names the attacker`).toBeDefined();
          const attacker = seatOf(step.by!);
          const opponents = Array.from({ length: seatCountFor(format) }, (_, seat) => seat).filter(
            (seat) => teamOfSeat(format, seat) !== teamOfSeat(format, attacker) && !dead.has(seat),
          );
          expect(opponents.length, `${s.id}: opponents alive for ${step.by}`).toBeGreaterThanOrEqual(2);
          expect(opponents, s.id).toContain(seatOf(step.seat));
        }
      }
    });
  }
});
