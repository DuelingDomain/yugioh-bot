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

// ADR-0002 Q1: the 5 turn-count cards stay banned at the free-for-all tables. In 1v1 they are legal. The list names Tag as legal too
// (a partner turn does not count, so the cards are fair there): this test pins that as it is, see tests/host-table-legality.test.ts.
const TURN_COUNT_BANS: Array<[number, string]> = [
  [72302403, "Swords of Revealing Light"],
  [22804644, "Doom Virus Dragon"],
  [21208154, "The Wicked Avatar"],
  [22888900, "Grisaille Prison"],
  [23746827, "Million-Century Ice Prison"],
];

describe("the 5 turn-count cards stay banned after the R3 rule", () => {
  it("the list has these 5 turn-count cards and no other", () => {
    const listed = MULTIPLAYER_FORBIDDEN.filter((entry) => entry.category === "turn-count").map((entry) => [entry.code, entry.name]);
    expect(listed.sort()).toEqual([...TURN_COUNT_BANS].sort());
  });

  for (const [code, name] of TURN_COUNT_BANS) {
    it(`${name} (${code}): banned at FFA3 and FFA4, legal in 1v1 and in Tag`, () => {
      expect(multiplayerForbiddenFor("ffa3", code)?.category).toBe("turn-count");
      expect(multiplayerForbiddenFor("ffa4", code)?.category).toBe("turn-count");
      expect(multiplayerForbiddenFor("1v1", code)).toBeUndefined();
      expect(multiplayerForbiddenFor("tag", code)).toBeUndefined();
    });
  }
});
