import { describe, expect, it, vi } from "vitest";
import { seatCountFor, teamOfSeat } from "@yugidraft/shared/duels";
import { readManifest } from "../../../scripts/generate-multi-scripts.js";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores, needs } from "../../support/cores.js";
import type { Scenario } from "../../support/dsl.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { runScenario } from "../../support/session.js";
import { COMPARE_GAP_SCENARIOS } from "./compare-gaps.js";
import { domainVariant } from "./domain-variants.js";

const proof = vi.hoisted(() => ({
  checkSkyNegation: false,
  bug: null as Partial<import("ocgcore-wasm").OcgCardQueryInfo> | null,
  witch: null as Partial<import("ocgcore-wasm").OcgCardQueryInfo> | null,
}));
// Inspect the real core before the scenario closes it. No engine response is changed.
vi.mock("ocgcore-wasm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ocgcore-wasm")>();
  return { ...actual, default: async (options: Parameters<typeof actual.default>[0]) => {
    const core = await actual.default(options) as import("ocgcore-wasm").OcgCoreSync;
    const destroyDuel = core.destroyDuel.bind(core);
    core.destroyDuel = (handle) => {
      try {
        if (proof.checkSkyNegation) {
          const flags = (actual.OcgQueryFlags.CODE | actual.OcgQueryFlags.STATUS) as import("ocgcore-wasm").OcgQueryFlags;
          // The N-seat core accepts seat 2; the SDK types describe the two-seat core.
          const controller = 2 as 0 | 1;
          proof.bug = core.duelQuery(handle, { controller, location: actual.OcgLocation.MZONE, sequence: 0, overlaySequence: 0, flags });
          proof.witch = core.duelQuery(handle, { controller, location: actual.OcgLocation.MZONE, sequence: 2, overlaySequence: 0, flags });
        }
      } finally {
        destroyDuel(handle);
      }
    };
    return core;
  } };
});

const W8_IDS = [
  "compare-gaps-ffa3-surrender-while-the-opponent-pick-is-open",
  "compare-gaps-ffa4-surrender-while-the-opponent-pick-is-open",
];

async function runCompareGap(scenario: Scenario): Promise<void> {
  proof.checkSkyNegation = W8_IDS.some((id) => scenario.id === id || scenario.id === `${id}-domain`);
  try {
    await runScenario(scenario);
    if (proof.checkSkyNegation) {
      expect(proof.bug?.code, "p2.m0 is the selected Man-Eater Bug").toBe(54652250);
      expect(proof.witch?.code, "p2.m2 is the unselected Witch of the Black Forest").toBe(78010363);
      expect(proof.bug?.status).toBeDefined();
      expect(proof.witch?.status).toBeDefined();
      // constant.lua: STATUS_DISABLED = 0x1. Only the selected target is negated.
      expect(proof.bug!.status! & 0x1, "Man-Eater Bug is negated by Ultimate Sky").toBe(0x1);
      expect(proof.witch!.status! & 0x1, "Witch of the Black Forest remains enabled").toBe(0);
    }
  } finally {
    proof.checkSkyNegation = false;
    proof.bug = proof.witch = null;
  }
}

// Live scenarios of the scan-gap compare cards (Three in One, Sangen Kaiho, Exciton Knight, Ghost Reaper, Mimighoul Slime), Kaiser Colosseum and the per-opponent Mystic Mine (domain-core/multi-scripts). Same gate as compare.test.ts:
// NSEAT_LIVE=1 and a multi core.
describeWithCores("live compare scenarios of the scan-gap cards, Kaiser Colosseum, Ultimate Sky and Mystic Mine", liveNseat, () => {
  runScenarios("multiplayer/compare-gaps", COMPARE_GAP_SCENARIOS, runCompareGap);
});

describeWithCores("live Domain W8 opponent pick after surrender", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/compare-gaps-domain", COMPARE_GAP_SCENARIOS.filter((scenario) => scenario.tags.includes("elimination")).map(domainVariant), runCompareGap);
});

describe("compare gap scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves and an outcome after an action", () => {
    expect(new Set(COMPARE_GAP_SCENARIOS.map((s) => s.id)).size).toBe(COMPARE_GAP_SCENARIOS.length);
    for (const s of COMPARE_GAP_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
    }
  });

  it("tags every scenario with at least one card that has an overlay file", () => {
    const codes = new Set(readManifest().cards.map((card) => card.code));
    for (const s of COMPARE_GAP_SCENARIOS) {
      const tagged = (s.tags ?? []).filter((tag) => tag.startsWith("card:")).map((tag) => Number(tag.slice(5)));
      expect(tagged.some((code) => codes.has(code)), `${s.id}: card tags ${tagged.join(", ")}`).toBe(true);
    }
  });

  it("asks for an opponent pick only while the duelist has two or more opponents alive", () => {
    const seatOf = (id: string) => Number(id.slice(1));
    for (const s of COMPARE_GAP_SCENARIOS) {
      const format = s.setup.format ?? "1v1";
      for (const step of s.steps) {
        if (step.op !== "pickOpponent") continue;
        expect(step.by, `${s.id}: pickOpponent names the duelist`).toBeDefined();
        const duelist = seatOf(step.by!);
        const opponents = Array.from({ length: seatCountFor(format) }, (_, seat) => seat).filter(
          (seat) => teamOfSeat(format, seat) !== teamOfSeat(format, duelist),
        );
        expect(opponents.length, s.id).toBeGreaterThanOrEqual(2);
        expect(opponents, s.id).toContain(seatOf(step.seat));
      }
    }
  });
});
