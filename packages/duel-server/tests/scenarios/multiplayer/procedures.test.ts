import { describe, expect, it } from "vitest";
import { seatCountFor, teamOfSeat } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import type { Scenario } from "../../support/dsl.js";
import { PROCEDURE_SCENARIOS, PROCEDURE_TAG_SCENARIOS } from "./procedures.js";

// Summon procedures that Tribute one opponent (Kaiju, Lava Golem, Volcanic Queen), the Tribute of a monster of opponent 2 (Q8)
// and a dead bound seat (W6), on a real engine. Same gate as nseat-live.test.ts: NSEAT_LIVE=1 and a multi core with
// Debug.SetupDuelists (tests/support/live-nseat.ts). With DUEL_REQUIRE_CORES=1 a closed gate fails the run instead of skipping.

describeWithCores("live procedure scenarios: FFA", liveNseat, () => {
  runScenarios("multiplayer/procedures", PROCEDURE_SCENARIOS);
});

describeWithCores("live procedure scenarios: Tag", liveNseat, () => {
  runScenarios("multiplayer/procedures-tag", PROCEDURE_TAG_SCENARIOS);
});

const LISTS: Array<[string, Scenario[]]> = [["FFA", PROCEDURE_SCENARIOS], ["Tag", PROCEDURE_TAG_SCENARIOS]];

describe("live procedure scenario lists", () => {
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
        const dead = new Set<number>();
        for (const step of s.steps) {
          if (step.op === "expectEliminated") step.seats.forEach((id) => dead.add(seatOf(id)));
          if (step.op !== "pickOpponent") continue;
          expect(step.by, `${s.id}: pickOpponent names the summoning seat`).toBeDefined();
          const actor = seatOf(step.by!);
          const opponents = Array.from({ length: seatCountFor(format) }, (_, seat) => seat).filter(
            (seat) => teamOfSeat(format, seat) !== teamOfSeat(format, actor) && !dead.has(seat),
          );
          expect(opponents.length, `${s.id}: opponents alive for ${step.by}`).toBeGreaterThanOrEqual(2);
          expect(opponents, s.id).toContain(seatOf(step.seat));
        }
      }
    });
  }
});

// Real engine bugs found while writing these scenarios. The cases are NOT scenarios: they would fail today. Repro in
// packages/duel-server/domain-core/.build/phase2/findings/.
describe("The Winged Dragon of Ra - Sphere Mode (card:10000080, Q8)", () => {
  it.todo("s1-procedures-1: all 3 Tributes come from ONE opponent (a mixed Tribute of p1 and p2 is not offered)");
  it.todo("s1-procedures-2: Ra goes to the field of the opponent that paid the Tributes (it lands on p1 when p2 paid)");
});
