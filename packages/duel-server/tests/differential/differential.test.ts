import { beforeAll, describe, expect, it, vi } from "vitest";
import { engineDataDirectory } from "../fuzz/config.js";
import { setupScenario } from "../fuzz/driver.js";
import { coresReady, describeWithCores, itWithCores, needs } from "../support/cores.js";

// Every core created during this file goes through the recorder (a passthrough unless a recording is active).
vi.mock("ocgcore-wasm", async (importOriginal) => {
  const original = await importOriginal<typeof import("ocgcore-wasm")>();
  const { wrapCreateCore } = await import("./trace.js");
  return { ...original, default: wrapCreateCore(original) };
});

import { differentialReproCommand, writeDifferentialFailure } from "./failures.js";
import {
  MULTI_WASM_PATH,
  REFERENCE_WASM_PATH,
  dataNeeds,
  compareSeed,
  describeDiff,
  readWasm,
  recordStock,
  seedsFor,
  standardWasmPath,
  type Diff,
  type SeedResult,
} from "./harness.js";

/**
 * Differential test (design section 9): play a seeded self-play duel on the stock standard core
 * (pinned ygopro-core plus domain-core/patches/0001), record the response journal, every parsed
 * message, the raw bytes of every message and a field snapshot after each core process step, then
 * replay the journal on another core and require zero differences. The wrapper must also parse
 * every message (no "failed to parse a message" warning).
 *
 *  - "stock vs stock" always runs when the engine data exists. It proves the harness.
 *  - "stock vs multi" needs domain-core/dist/ocgcore.multi.sync.wasm (all patches) and
 *    ocgcore.multi-ref.sync.wasm (patches 1 and 2 only: same source meaning, different binary layout). Both are built with a fixed Lua seed (scripts/build-multi-core.sh).
 *    Without it the test is skipped (with DUEL_REQUIRE_CORES=1 it fails: tests/support/cores.ts).
 *
 * Knobs: DIFF_RUNS (default 20), DIFF_SEED (base seed, default 20260930), DIFF_MAX_STEPS (default 400),
 * DIFF_MULTI_WASM, DIFF_REFERENCE_WASM (wasm paths), DIFF_ONLY_SEEDS (comma list, replaces the seed set), DIFF_TIMEOUT_MS, DUEL_DATA_DIR.
 * A difference writes `<GATE_TAG|local>-long-<seed>.json` to DIFF_FAILURE_DIR (default tests/differential/failures) and prints a `next:` repro line.
 */
const dataDirectory = engineDataDirectory();
const runs = Number(process.env.DIFF_RUNS ?? 20);
const baseSeed = Number(process.env.DIFF_SEED ?? 20260930);
const maxSteps = Number(process.env.DIFF_MAX_STEPS ?? 400);
const timeoutMs = Number(process.env.DIFF_TIMEOUT_MS ?? 30 * 60_000);

const REFERENCE_NEED = needs.file("reference core (patches 1 and 2)", REFERENCE_WASM_PATH, "Build it with scripts/build-multi-core.sh in docker.io/emscripten/emsdk:4.0.9 (see domain-core/patches/README.md).");
const MULTI_NEEDS = [needs.file("multi core (all patches)", MULTI_WASM_PATH, "Build it with scripts/build-multi-core.sh in docker.io/emscripten/emsdk:4.0.9 (see domain-core/patches/README.md)."), REFERENCE_NEED];
const referenceReady = REFERENCE_NEED.ok;
const multiReady = coresReady(MULTI_NEEDS);

describeWithCores("differential: stock core vs replay", dataNeeds(dataDirectory), () => {
  const results: { stock: SeedResult[]; multi: SeedResult[] } = { stock: [], multi: [] };
  let seconds = 0;

  /** On a difference: record the duel again on the reference core and write the repro file. Never changes the test result. */
  async function writeFailure(seed: number, diff: Diff, found: "multi" | "reference-self-check", stock: ArrayBuffer): Promise<void> {
    try {
      const { outcome } = await recordStock(seed, dataDirectory, maxSteps, stock);
      const setup = setupScenario(outcome.scenario, dataDirectory);
      const referenceWasm = referenceReady ? REFERENCE_WASM_PATH : standardWasmPath(dataDirectory);
      const path = writeDifferentialFailure({
        mode: "long",
        seed,
        recorded: {
          scenario: outcome.scenario,
          engine: { mode: outcome.scenario.mode, masterRule: outcome.scenario.masterRule, decks: outcome.decks, seed: setup.engineSeed },
          journal: outcome.journal,
          deckNotes: outcome.deckNotes,
          disjoint: outcome.disjoint,
          note: outcome.failure ? `self-play ended early: ${outcome.failure.invariant}` : outcome.ended ? "duel ended" : "step cap",
        },
        diff,
        found,
        referenceWasm,
        multiWasm: MULTI_WASM_PATH,
        dataDirectory,
      });
      const wasm = found === "multi" ? MULTI_WASM_PATH : referenceWasm;
      console.log(`${describeDiff(diff)}\n  failure file: ${path}\nnext: ${differentialReproCommand(path, wasm, dataDirectory)}`);
    } catch (error) {
      console.log(`differential: could not write the failure file for seed ${seed}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  beforeAll(async () => {
    const stock = readWasm(referenceReady ? REFERENCE_WASM_PATH : standardWasmPath(dataDirectory));
    const multi = multiReady ? readWasm(MULTI_WASM_PATH) : null;
    const started = performance.now();
    const only = (process.env.DIFF_ONLY_SEEDS ?? "").split(",").filter(Boolean).map(Number);
    for (const seed of only.length ? only : seedsFor(baseSeed, runs)) {
      const one = await compareSeed(seed, dataDirectory, maxSteps, { stock, multi });
      results.stock.push(one.stock);
      if (one.multi) results.multi.push(one.multi);
      const diff = one.multi?.diff ?? one.stock.diff;
      if (diff) await writeFailure(seed, diff, one.multi?.diff ? "multi" : "reference-self-check", stock);
    }
    seconds = (performance.now() - started) / 1000;
    const total = (list: SeedResult[], key: "answers" | "processSteps" | "messages") => list.reduce((sum, r) => sum + r[key], 0);
    const first = results.stock;
    console.log(
      `differential: base seed ${baseSeed}, ${first.length} seeds, ${total(first, "answers")} answers, ` +
        `${total(first, "processSteps")} process steps, ${total(first, "messages")} messages, ${seconds.toFixed(1)}s ` +
        `(stock diffs ${first.filter((r) => r.diff).length}, multi diffs ${results.multi.filter((r) => r.diff).length}, multi ${multiReady ? "ran" : "skipped"})`,
    );
  }, timeoutMs);

  it("stock vs stock: zero differences (harness self-check)", () => {
    expect(results.stock.length).toBeGreaterThan(0);
    const diffs = results.stock.filter((r) => r.diff);
    expect(diffs.map((r) => describeDiff(r.diff!)).join("\n")).toBe("");
    // The comparison must have looked at real duels.
    expect(results.stock.reduce((sum, r) => sum + r.processSteps, 0)).toBeGreaterThan(results.stock.length * 5);
  });

  it("the wrapper parses every message of every core", () => {
    const warnings = [...results.stock, ...results.multi].flatMap((r) => r.parseWarnings.map((text) => `seed ${r.seed} ${text}`));
    expect(warnings.slice(0, 20).join("\n")).toBe("");
  });

  itWithCores("stock vs multi (2 duelists): zero differences", MULTI_NEEDS, () => {
    expect(results.multi.length).toBe(results.stock.length);
    const diffs = results.multi.filter((r) => r.diff);
    expect(diffs.map((r) => describeDiff(r.diff!)).join("\n")).toBe("");
  });
});
