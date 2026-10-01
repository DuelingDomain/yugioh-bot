import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { repoMultiScriptsDirectory } from "../../../src/multi-scripts.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { DEAD_BOUND_OPPONENT_SCENARIOS, STOCK_SCRIPT_CARD } from "./dead-bound-opponent.js";

// Live scenarios of core fix OQ3 (a dead bound opponent is "no effect", never a Lua error). They run the STOCK script of Snake-Eyes Diabellstar:
// the overlay folder of the repo is copied without c27260347.lua (and without its manifest row) and DUEL_MULTI_SCRIPTS_DIR names the copy.
// Same gate as the other live N-seat files: NSEAT_LIVE=1 and a multi core. These scenarios need a core with the OQ3 patch. Until the patch is
// installed as a numbered repo patch, name the core: NSEAT_WASM=domain-core/dist/ocgcore.multi-oq3.sync.wasm (Standard) or
// NSEAT_WASM=domain-core/dist/ocgcore.multi-domain-oq3.sync.wasm (Domain). On an older core the duel stops with "attempt to compare nil with number".
let folder: string | undefined;
let before: string | undefined;

beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), "oq3-multi-scripts-"));
  cpSync(repoMultiScriptsDirectory(), folder, { recursive: true });
  rmSync(join(folder, `c${STOCK_SCRIPT_CARD}.lua`));
  const manifestPath = join(folder, "MANIFEST.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { cards: { code: number }[] };
  manifest.cards = manifest.cards.filter((card) => card.code !== STOCK_SCRIPT_CARD);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  before = process.env.DUEL_MULTI_SCRIPTS_DIR;
  process.env.DUEL_MULTI_SCRIPTS_DIR = folder;
});

afterAll(() => {
  if (before === undefined) delete process.env.DUEL_MULTI_SCRIPTS_DIR;
  else process.env.DUEL_MULTI_SCRIPTS_DIR = before;
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describeWithCores("live dead-bound-opponent scenarios (stock script)", liveNseat, () => {
  runScenarios("multiplayer/dead-bound-opponent", DEAD_BOUND_OPPONENT_SCENARIOS);
});

describe("dead-bound-opponent scenario list", () => {
  it("has unique ids, a source, a multi-seat format, the rules it proves and an outcome after an action", () => {
    expect(new Set(DEAD_BOUND_OPPONENT_SCENARIOS.map((s) => s.id)).size).toBe(DEAD_BOUND_OPPONENT_SCENARIOS.length);
    for (const s of DEAD_BOUND_OPPONENT_SCENARIOS) {
      expect(s.source, s.id).toBeTruthy();
      expect(seatCountFor(s.setup.format ?? "1v1"), s.id).toBeGreaterThan(2);
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(s.tags.some((tag) => /^card:\d+$/.test(tag)), s.id).toBe(true);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
    }
  });
});
