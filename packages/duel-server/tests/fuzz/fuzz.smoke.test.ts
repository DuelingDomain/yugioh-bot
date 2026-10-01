import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { loadFuzzConfig, scenarioFor } from "./config.js";
import { describeFailure, writeFailure } from "./failures.js";
import { knownIssueFor } from "./known-issues.js";
import { runAndVerify, type VerifiedOutcome } from "./run-one.js";

/**
 * Layer 2: seeded random self-play. Each fast-check run is one duel. The scenario seed fixes the
 * decks, the engine seed and every driver choice, so a failing seed is a full repro.
 *
 * Knobs: FUZZ_RUNS, FUZZ_SEED, FUZZ_MAX_STEPS, FUZZ_MODE=normal|domain|all, FUZZ_MASTER_RULE=1..5|random,
 * FUZZ_REPLAY_RATE, FUZZ_STRICT=1 (known issues fail too), DUEL_DATA_DIR.
 */
const config = loadFuzzConfig({ runs: 30, maxSteps: 400 });
const strict = process.env.FUZZ_STRICT === "1";
const TIMEOUT_MS = Number(process.env.FUZZ_TIMEOUT_MS ?? 120_000);

describe("duel engine self-play fuzz", () => {
  it(
    `plays ${config.runs} seeded duels (${config.mode}) without breaking an invariant`,
    async () => {
      const known = new Map<string, { count: number; seeds: number[] }>();
      const stats = { duels: 0, steps: 0, ended: 0, replayed: 0 };
      const baseSeed = config.seed ?? Math.floor(Math.random() * 2 ** 31);
      console.log(`fuzz: fast-check seed ${baseSeed}, runs ${config.runs}, mode ${config.mode}, max steps ${config.maxSteps}`);
      const t0 = performance.now();
      let failed: VerifiedOutcome | null = null;

      const property = fc.asyncProperty(fc.integer({ min: 1, max: 2 ** 31 - 1 }), async (seed) => {
        const scenario = scenarioFor(seed, config);
        const outcome = await runAndVerify(scenario, config.dataDirectory, config.replayRate);
        stats.duels++;
        stats.steps += outcome.steps;
        if (outcome.ended) stats.ended++;
        if (outcome.replayed) stats.replayed++;
        const failure = outcome.failure;
        if (!failure) return true;
        const issue = knownIssueFor(failure);
        if (issue && !strict) {
          const entry = known.get(issue.id) ?? { count: 0, seeds: [] };
          entry.count++;
          if (entry.seeds.length < 5) entry.seeds.push(seed);
          known.set(issue.id, entry);
          return true;
        }
        failed = outcome;
        const path = writeFailure(outcome, config.dataDirectory);
        throw new Error(`${describeFailure(outcome, config.dataDirectory)}\n  saved: ${path}`);
      });

      try {
        // Shrinking a seed only tries other seeds, so stop at the first failure. The failing step is in the report.
        await fc.assert(property, { numRuns: config.runs, seed: baseSeed, endOnFailure: true, verbose: 0 });
      } finally {
        const secs = (performance.now() - t0) / 1000;
        console.log(
          `fuzz: ${stats.duels} duels, ${stats.steps} steps, ${stats.ended} ended, ${stats.replayed} replayed, ` +
            `${secs.toFixed(1)}s, ${(stats.duels / secs).toFixed(1)} duels/s`,
        );
        for (const [id, entry] of known) console.log(`fuzz: known issue ${id}: ${entry.count} duels (seeds ${entry.seeds.join(", ")})`);
      }
      expect(failed).toBeNull();
      // The run must have done real work, not only hit known issues at step 0.
      expect(stats.steps).toBeGreaterThan(stats.duels);
    },
    TIMEOUT_MS,
  );
});
