import { describe, expect, it } from "vitest";
import createCore, { type OcgCardData } from "ocgcore-wasm";
import { seatCountFor } from "@yugidraft/shared/duels";
import { readManifest } from "../../../scripts/generate-multi-scripts.js";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { nseatWasmBinary } from "../../support/session.js";
import { SEATS_SCENARIOS } from "./seats.js";

// Live scenarios of the seat rules of the overlay (R1 each duelist, Q10 script fixes). Same gate as the other live N-seat scenario files
// (NSEAT_LIVE=1 and a multi core), and the core must have Duel.MPNthDuelist (patch 0053). A core without it (P52) is a missing need (a skip with a warning, a failure with DUEL_REQUIRE_CORES=1) and the
// message names the patch. Run it on the Standard multi core and again on the Domain multi core:
//   NSEAT_WASM=domain-core/dist/ocgcore.multi-P53.sync.wasm          (Standard)
//   NSEAT_WASM=domain-core/dist/ocgcore.multi-domain-P53.sync.wasm   (Domain)
async function probeNthDuelist(): Promise<boolean> {
  try {
    const wasmBinary = nseatWasmBinary();
    if (!wasmBinary) return false;
    const lib = await createCore({ sync: true, wasmBinary });
    const team = { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 };
    const handle = lib.createDuel({
      flags: 0n, seed: [1n, 2n, 3n, 4n], team1: team, team2: team,
      cardReader: () => null as OcgCardData | null, scriptReader: () => null, errorHandler: () => undefined,
    });
    if (!handle) return false;
    const ok = lib.loadScript(handle, "probe.lua", "Debug.SetupDuelists(3,0,1,2) assert(Duel.MPNthDuelist and Duel.MPSeat and Duel.MPSeatOf and Duel.MPBindSeat)");
    lib.destroyDuel(handle);
    return ok;
  } catch {
    return false;
  }
}
// A core without the seats is a missing need: it fails with DUEL_REQUIRE_CORES=1 and skips (with a warning) without it, never a silent it.skip.
const nthDuelist = needs.coreFeature("multi core with patch 0053 (MPNthDuelist, MPSeat, MPSeatOf, MPBindSeat)", process.env.NSEAT_LIVE !== "1" || (await probeNthDuelist()), "Set NSEAT_WASM to a build with patch 0053 or later (ocgcore.multi-P59.sync.wasm).");

describeWithCores("live scenarios of the seat rules (R1 each duelist, Q10)", [liveNseat, nthDuelist], () => {
  runScenarios("multiplayer/seats", SEATS_SCENARIOS);
});

describe("seats scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves and an outcome after an action", () => {
    expect(new Set(SEATS_SCENARIOS.map((s) => s.id)).size).toBe(SEATS_SCENARIOS.length);
    for (const s of SEATS_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
    }
  });

  it("tags every scenario with at least one card that has an overlay file", () => {
    const codes = new Set(readManifest().cards.map((card) => card.code));
    for (const s of SEATS_SCENARIOS) {
      const tagged = (s.tags ?? []).filter((tag) => tag.startsWith("card:")).map((tag) => Number(tag.slice(5)));
      expect(tagged.some((code) => codes.has(code)), `${s.id}: card tags ${tagged.join(", ")}`).toBe(true);
    }
  });
});
