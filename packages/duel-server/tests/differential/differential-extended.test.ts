import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { engineDataDirectory } from "../fuzz/config.js";

// Every core created during this file goes through the recorder (a passthrough unless a recording is active).
vi.mock("ocgcore-wasm", async (importOriginal) => {
  const original = await importOriginal<typeof import("ocgcore-wasm")>();
  const { wrapCreateCore } = await import("./trace.js");
  return { ...original, default: wrapCreateCore(original) };
});

import { compareRecorded, recordBoard, recordSeeded, type ExtendedSeedResult } from "./extended-harness.js";
import { differentialReproCommand, writeDifferentialFailure } from "./failures.js";
import { MULTI_WASM_PATH, REFERENCE_WASM_PATH, canRun, describeDiff, readWasm, seedsFor, standardWasmPath, type Diff } from "./harness.js";
import { wasmIdentity, writeDifferentialSummary } from "./summary.js";

/**
 * Extended differential test. Same proof as differential.test.ts (the multi core plays byte
 * identical duels to the reference core when a duel has 2 duelists), for more kinds of duels.
 * Choose the kind with DIFF_EXT_MODE:
 *
 *  - long (default): Standard self-play like the main test, default DIFF_MAX_STEPS 2000.
 *  - domain: Domain duels (Deck Master, domain.lua) on the two Domain cores built with APPLY_DOMAIN=1
 *    (domain-core/dist/ocgcore.multi-ref-domain.sync.wasm and ocgcore.multi-domain.sync.wasm).
 *  - scenarios: every Layer 1 scenario (tests/scenarios/cases) starts from its board, then seeded
 *    self-play. Domain scenarios run on the Domain cores, when they exist.
 *
 * Knobs: DIFF_RUNS (default 20, long and domain), DIFF_SEED (default 20260930), DIFF_MAX_STEPS
 * (default 2000 for long, 400 for the others), DIFF_ONLY_SEEDS (comma list), DIFF_REFERENCE_WASM,
 * DIFF_MULTI_WASM, DIFF_TIMEOUT_MS, DUEL_DATA_DIR, DIFF_EXT_SCENARIOS (comma list of scenario id
 * parts, scenarios mode). Every mode writes .status/differential-summary.json and one line to
 * .status/differential-history.tsv, and one file per differing seed to tests/differential/failures/.
 * See tests/differential/README.md.
 */
const mode = (process.env.DIFF_EXT_MODE ?? "long") as "long" | "domain" | "scenarios";
if (!["long", "domain", "scenarios"].includes(mode)) throw new Error(`DIFF_EXT_MODE must be long, domain or scenarios, got "${mode}"`);

const dataDirectory = engineDataDirectory();
// Layer 1 scenarios read cards.cdb through tests/engine-data-dir.ts, which reads this variable when it loads.
process.env.DUEL_DATA_DIR ??= dataDirectory;

const distPath = (name: string) => fileURLToPath(new URL(`../../domain-core/dist/${name}`, import.meta.url));
const runs = Number(process.env.DIFF_RUNS ?? 20);
const baseSeed = Number(process.env.DIFF_SEED ?? 20260930);
const maxSteps = Number(process.env.DIFF_MAX_STEPS ?? (mode === "long" ? 2000 : 400));
const timeoutMs = Number(process.env.DIFF_TIMEOUT_MS ?? 60 * 60_000);
const onlySeeds = (process.env.DIFF_ONLY_SEEDS ?? "").split(",").filter(Boolean).map(Number);

const standardPair = { reference: REFERENCE_WASM_PATH, multi: MULTI_WASM_PATH };
const domainPair = {
  reference: resolve(process.env.DIFF_DOMAIN_REFERENCE_WASM ?? distPath("ocgcore.multi-ref-domain.sync.wasm")),
  multi: resolve(process.env.DIFF_DOMAIN_MULTI_WASM ?? distPath("ocgcore.multi-domain.sync.wasm")),
};
// The wasm pair that the summary reports for the mode (scenarios mode reports the Standard pair).
const mainPair = mode === "domain" ? domainPair : standardPair;
const both = (pair: { reference: string; multi: string }) => existsSync(pair.reference) && existsSync(pair.multi);
const domainPairReady = both(domainPair);

const dataReady = canRun(dataDirectory);
const coresReady = mode === "domain" ? domainPairReady : both(standardPair);
const ready = dataReady && coresReady;
if (!dataReady) console.warn(`differential-extended: SKIPPED. Engine data is missing (need ${standardWasmPath(dataDirectory)} and cards.cdb). Set DUEL_DATA_DIR.`);
else if (!coresReady) {
  console.warn(`differential-extended (${mode}): SKIPPED. Missing ${mainPair.reference} or ${mainPair.multi}. See tests/differential/README.md for the build commands.`);
}

/** FNV-1a of the scenario id, mixed with the base seed: the self-play seed of a scenario. */
function scenarioSeed(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return ((hash ^ baseSeed) >>> 0) % (2 ** 31 - 2) + 1;
}

describe.skipIf(!ready)(`differential extended: ${mode}`, () => {
  const results: ExtendedSeedResult[] = [];
  const skipped: string[] = [];
  let failureFiles: string[] = [];

  beforeAll(async () => {
    const started = performance.now();
    const loaded = new Map<string, { reference: ArrayBuffer; multi: ArrayBuffer }>();
    const coresOf = (pair: { reference: string; multi: string }) => {
      const key = `${pair.reference}|${pair.multi}`;
      if (!loaded.has(key)) loaded.set(key, { reference: readWasm(pair.reference), multi: readWasm(pair.multi) });
      return loaded.get(key)!;
    };
    const pairFor = (duelMode: string) => (duelMode === "domain" ? domainPair : standardPair);

    const one = async (seed: number, record: (reference: ArrayBuffer) => ReturnType<typeof recordSeeded>, pair: typeof standardPair) => {
      const cores = coresOf(pair);
      const recorded = await record(cores.reference);
      const result = await compareRecorded(seed, recorded, dataDirectory, cores);
      results.push(result);
      const found = result.multi.diff ? ("multi" as const) : result.reference.diff ? ("reference-self-check" as const) : null;
      if (found) {
        const diff = (result.multi.diff ?? result.reference.diff) as Diff;
        const path = writeDifferentialFailure({
          mode,
          seed,
          recorded,
          diff,
          found,
          referenceWasm: pair.reference,
          multiWasm: pair.multi,
          dataDirectory,
        });
        failureFiles.push(path);
        console.log(`${describeDiff(diff)}\n  failure file: ${path}\nnext: ${differentialReproCommand(path, found === "multi" ? pair.multi : pair.reference, dataDirectory)}`);
      }
    };

    if (mode === "scenarios") {
      const { loadAllScenarios } = await import("../support/registry.js");
      const { compileBoard } = await import("../support/board.js");
      const filter = (process.env.DIFF_EXT_SCENARIOS ?? "").split(",").filter(Boolean);
      for (const { scenario } of await loadAllScenarios()) {
        if (filter.length && !filter.some((part) => scenario.id.includes(part))) continue;
        const seed = scenarioSeed(scenario.id);
        if (onlySeeds.length && !onlySeeds.includes(seed)) continue;
        const duelMode = scenario.setup.mode ?? "normal";
        const pair = pairFor(duelMode);
        if (!both(pair)) {
          skipped.push(`${scenario.id} (needs the ${duelMode} cores)`);
          continue;
        }
        let compiled;
        try {
          compiled = compileBoard(scenario.setup, dataDirectory);
        } catch (error) {
          skipped.push(`${scenario.id} (${error instanceof Error ? error.message.split("\n")[0] : String(error)})`);
          continue;
        }
        await one(seed, (wasm) => recordBoard(seed, scenario.id, compiled, scenario.seed ?? ["1", "2", "3", "4"], dataDirectory, maxSteps, wasm), pair);
      }
    } else {
      for (const seed of onlySeeds.length ? onlySeeds : seedsFor(baseSeed, runs)) {
        await one(seed, (wasm) => recordSeeded(seed, mode === "domain" ? "domain" : "normal", dataDirectory, maxSteps, wasm), mainPair);
      }
    }

    const durationMs = performance.now() - started;
    const failing = results.filter((r) => r.reference.diff || r.multi.diff);
    const summary = {
      time: new Date().toISOString(),
      mode,
      reference: wasmIdentity(mainPair.reference),
      multi: wasmIdentity(mainPair.multi),
      baseSeed,
      seeds: results.length,
      onlySeeds,
      maxSteps,
      differences: failing.length,
      parseWarnings: results.reduce((sum, r) => sum + r.reference.parseWarnings.length + r.multi.parseWarnings.length, 0),
      firstFailingSeed: failing[0]?.seed ?? null,
      durationMs,
    };
    const written = writeDifferentialSummary(summary);
    const total = (key: "answers" | "processSteps" | "messages") => results.reduce((sum, r) => sum + r.multi[key], 0);
    console.log(
      `differential-extended ${mode}: base seed ${baseSeed}, ${results.length} seeds, ${total("answers")} answers, ${total("processSteps")} process steps, ` +
        `${total("messages")} messages, ${(durationMs / 1000).toFixed(1)}s, differences ${summary.differences}, parse warnings ${summary.parseWarnings}` +
        `${skipped.length ? `, skipped ${skipped.length}` : ""}. Summary: ${written.summaryPath}`,
    );
    for (const text of skipped) console.log(`  skipped: ${text}`);
  }, timeoutMs);

  it("compared real duels", () => {
    expect(results.length).toBeGreaterThan(0);
    expect(results.reduce((sum, r) => sum + r.multi.processSteps, 0)).toBeGreaterThan(results.length * 3);
  });

  it("reference core: a second replay matches the first (harness self-check)", () => {
    const diffs = results.filter((r) => r.reference.diff);
    expect(diffs.map((r) => describeDiff(r.reference.diff!)).join("\n")).toBe("");
  });

  it("the wrapper parses every message of every core", () => {
    const warnings = results.flatMap((r) => [...r.reference.parseWarnings, ...r.multi.parseWarnings].map((text) => `seed ${r.seed} ${text}`));
    expect(warnings.slice(0, 20).join("\n")).toBe("");
  });

  it("multi core (2 duelists): zero differences to the reference core", () => {
    const diffs = results.filter((r) => r.multi.diff);
    expect(diffs.map((r) => describeDiff(r.multi.diff!)).join("\n")).toBe("");
  });
});
