import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { MULTIPLAYER_FORBIDDEN, multiplayerForbiddenFor } from "../../../src/banlists/multiplayer.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { OPPONENT_TURN_SCENARIOS } from "./opponent-turns.js";

// Live scenarios of the opponent-turn count (R3) and of refused seat answers (W9). Same gate as nseat-live.test.ts: NSEAT_LIVE=1 and a multi core.
describeWithCores("live opponent-turn scenarios", liveNseat, () => {
  runScenarios("multiplayer/opponent-turns", OPPONENT_TURN_SCENARIOS);
});

describe("opponent-turn scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves and an outcome after an action", () => {
    expect(new Set(OPPONENT_TURN_SCENARIOS.map((s) => s.id)).size).toBe(OPPONENT_TURN_SCENARIOS.length);
    for (const s of OPPONENT_TURN_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      if (!s.knownBug) {
        expect(s.rules?.length, s.id).toBeGreaterThan(0);
        expect(outcomeAsserts(s.steps), s.id).toBe(true);
      }
      expect(s.tags.some((tag) => tag.startsWith("card:")), s.id).toBe(true);
    }
  });
});

// The owner decisions of 2026-10-18 supersede the four historical FFA turn-count bans (ADR-0002 Q1).
const TURN_COUNT_CARDS: Array<[number, string]> = [
  [22804644, "Doom Virus Dragon"],
  [21208154, "The Wicked Avatar"],
  [22888900, "Grisaille Prison"],
  [23746827, "Million-Century Ice Prison"],
];

describe("the former turn-count bans are superseded by the owner rules", () => {
  it("the forbidden list has no remaining turn-count bans", () => {
    expect(MULTIPLAYER_FORBIDDEN.filter((entry) => entry.category === "turn-count")).toEqual([]);
  });

  it.each(["1v1", "ffa3", "ffa4", "tag"] as const)("Swords of Revealing Light is legal at %s", (format) => {
    expect(multiplayerForbiddenFor(format, 72302403)).toBeUndefined();
    expect(multiplayerForbiddenFor(format, 99999999, 72302403)).toBeUndefined();
  });

  for (const [code, name] of TURN_COUNT_CARDS) {
    it(`${name} (${code}) and its aliases are legal in every format`, () => {
      for (const format of ["1v1", "ffa3", "ffa4", "tag"] as const) {
        expect(multiplayerForbiddenFor(format, code), format).toBeUndefined();
        expect(multiplayerForbiddenFor(format, 99999999, code), `${format}: alias`).toBeUndefined();
      }
    });
  }
});
