import { describe, expect, it } from "vitest";
import { seatCountFor, teamOfSeat } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import type { Scenario } from "../../support/dsl.js";
import { KAIJU_SCENARIOS } from "./summon-procedures.js";

// The summon procedures of the cards that the testers listed as pending (the 6 Kaiju), on a real engine. Same gate as
// procedures.test.ts: NSEAT_LIVE=1 and a multi core with Debug.SetupDuelists. With DUEL_REQUIRE_CORES=1 a closed gate fails the run.

describeWithCores("live summon procedure scenarios: Kaiju", liveNseat, () => {
  runScenarios("multiplayer/summon-procedures-kaiju", KAIJU_SCENARIOS);
});

const LISTS: Array<[string, Scenario[]]> = [["Kaiju", KAIJU_SCENARIOS]];

describe("live summon procedure scenario lists", () => {
  for (const [name, list] of LISTS) {
    it(`${name}: unique ids, a source, a multi-seat format, the rules, the card codes and an outcome after an action`, () => {
      expect(new Set(list.map((s) => s.id)).size).toBe(list.length);
      for (const s of list) {
        expect(s.source, s.id).toBeTruthy();
        expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
        expect(s.knownBug, s.id).toBeUndefined();
        expect(s.rules?.length, s.id).toBeGreaterThan(0);
        expect(s.tags.some((tag) => /^card:\d+$/.test(tag)), `${s.id}: a card:<code> tag`).toBe(true);
        expect(outcomeAsserts(s.steps), s.id).toBe(true);
      }
    });

    it(`${name}: asks for an opponent pick only while the summoning seat has two or more opponents alive`, () => {
      const seatOf = (id: string) => Number(id.slice(1));
      for (const s of list) {
        const format = s.setup.format ?? "1v1";
        for (const step of s.steps) {
          if (step.op !== "pickOpponent") continue;
          expect(step.by, `${s.id}: pickOpponent names the summoning seat`).toBeDefined();
          const actor = seatOf(step.by!);
          const opponents = Array.from({ length: seatCountFor(format) }, (_, seat) => seat).filter(
            (seat) => teamOfSeat(format, seat) !== teamOfSeat(format, actor),
          );
          expect(opponents.length, `${s.id}: opponents for ${step.by}`).toBeGreaterThanOrEqual(2);
          expect(opponents, s.id).toContain(seatOf(step.seat));
        }
      }
    });
  }
});
