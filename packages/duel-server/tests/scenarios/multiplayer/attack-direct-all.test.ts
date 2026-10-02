import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { readManifest } from "../../../scripts/generate-multi-scripts.js";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { ATTACK_ALL_ROWS, ATTACK_ALL_SCENARIOS, ATTACK_FALLBACK_SCENARIOS } from "./attack-direct-all.js";
import { ATTACK_COUNT_SCENARIOS } from "./attack-count.js";
import { ATTACK_DIRECT_SCENARIOS } from "./attack-direct.js";

// One row per ATTACK card that the other attack files do not run: the holder is offered the effect at an attack at the holder, and is not
// asked at an attack at another opponent, at FFA3 and at FFA4. Same gate as attack-direct.test.ts: NSEAT_LIVE=1 and a multi core.
describeWithCores("live direct attack table", liveNseat, () => {
  runScenarios("multiplayer/attack-direct-all", [...ATTACK_ALL_SCENARIOS, ...ATTACK_FALLBACK_SCENARIOS]);
});

const codesOf = (list: { tags?: string[] }[]): number[] =>
  list.flatMap((s) => (s.tags ?? []).filter((tag) => /^card:\d+$/.test(tag)).map((tag) => Number(tag.slice(5))));

describe("direct attack table", () => {
  const attackCodes = readManifest().cards.filter((card) => card.classes.includes("ATTACK")).map((card) => card.code);

  it("covers every ATTACK card of the manifest, in the table or in the scenarios of attack-direct and attack-count, and lists no other card", () => {
    const own = new Set(ATTACK_ALL_ROWS.map((row) => row.code));
    expect(own.size, "a code is in the table twice").toBe(ATTACK_ALL_ROWS.length);
    const elsewhere = new Set([...codesOf(ATTACK_DIRECT_SCENARIOS), ...codesOf(ATTACK_COUNT_SCENARIOS)]);
    expect(attackCodes.filter((code) => !own.has(code) && !elsewhere.has(code)), "ATTACK cards with no scenario").toEqual([]);
    expect([...own].filter((code) => !attackCodes.includes(code)), "table rows that are not ATTACK cards").toEqual([]);
    expect([...own].filter((code) => elsewhere.has(code)), "table rows that another file runs already").toEqual([]);
  });

  it("has a holder scenario and an other-opponent scenario of every row at FFA3 and FFA4", () => {
    expect(ATTACK_ALL_SCENARIOS).toHaveLength(ATTACK_ALL_ROWS.length * 4);
    for (const row of ATTACK_ALL_ROWS) {
      const mine = ATTACK_ALL_SCENARIOS.filter((s) => s.tags.includes(`card:${row.code}`));
      expect(mine.map((s) => `${s.setup.format}:${s.id.includes("not-offered") ? "other" : "holder"}`).sort(), row.name).toEqual(["ffa3:holder", "ffa3:other", "ffa4:holder", "ffa4:other"]);
    }
  });

  it("has unique ids, a source, a multi-seat format, the rules it proves, an outcome after an action and a card tag", () => {
    const all = [...ATTACK_ALL_SCENARIOS, ...ATTACK_FALLBACK_SCENARIOS];
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    for (const s of all) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
      expect(s.tags.some((tag) => /^card:\d+$/.test(tag)), s.id).toBe(true);
    }
  });
});
