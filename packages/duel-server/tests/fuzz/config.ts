import type { DuelMasterRule, DuelMode } from "@yugidraft/shared/duels";
import { currentEngineDataDirectory } from "../engine-data-dir.js";

export type FuzzModeSetting = "normal" | "domain" | "all";

export interface FuzzConfig {
  runs: number;
  /** Fixed base seed for fast-check and for scenario seeds. Undefined means "pick a random one and print it". */
  seed: number | undefined;
  maxSteps: number;
  mode: FuzzModeSetting;
  /** 1..5, or null for "random per scenario". */
  masterRule: DuelMasterRule | null;
  /** Probability (0..1) that a finished duel is replayed and compared. */
  replayRate: number;
  dataDirectory: string;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number, got "${raw}"`);
  return Math.trunc(value);
}

/** The shared test default (tests/engine-data-dir.ts): DUEL_DATA_DIR, else data/duel-engine-next. */
export function engineDataDirectory(): string {
  return currentEngineDataDirectory();
}

export function loadFuzzConfig(defaults: Partial<FuzzConfig> = {}): FuzzConfig {
  const mode = (process.env.FUZZ_MODE ?? defaults.mode ?? "all") as FuzzModeSetting;
  if (mode !== "normal" && mode !== "domain" && mode !== "all") throw new Error(`FUZZ_MODE must be normal, domain or all`);
  const rule = process.env.FUZZ_MASTER_RULE;
  let masterRule: DuelMasterRule | null = defaults.masterRule ?? null;
  if (rule !== undefined && rule !== "" && rule !== "random") {
    const value = Number(rule);
    if (![1, 2, 3, 4, 5].includes(value)) throw new Error("FUZZ_MASTER_RULE must be 1-5 or random");
    masterRule = value as DuelMasterRule;
  }
  const seedRaw = process.env.FUZZ_SEED;
  return {
    runs: int("FUZZ_RUNS", defaults.runs ?? 12),
    seed: seedRaw !== undefined && seedRaw !== "" ? int("FUZZ_SEED", 0) : defaults.seed,
    maxSteps: int("FUZZ_MAX_STEPS", defaults.maxSteps ?? 600),
    mode,
    masterRule,
    replayRate: Number(process.env.FUZZ_REPLAY_RATE ?? defaults.replayRate ?? 1),
    dataDirectory: engineDataDirectory(),
  };
}

/** Everything needed to rebuild one duel. The scenario seed fully determines decks, engine seed and all choices. */
export interface Scenario {
  seed: number;
  mode: DuelMode;
  masterRule: DuelMasterRule;
  maxSteps: number;
}

export function scenarioFor(seed: number, config: Pick<FuzzConfig, "mode" | "masterRule" | "maxSteps">): Scenario {
  const rng = new (class {
    s = (seed ^ 0x9e3779b9) >>> 0;
    next(): number {
      this.s = (this.s + 0x6d2b79f5) >>> 0;
      let t = this.s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
  })();
  const mode: DuelMode = config.mode === "all" ? (rng.next() < 0.5 ? "normal" : "domain") : config.mode;
  let masterRule = config.masterRule;
  const roll = rng.next();
  if (masterRule === null) {
    masterRule = roll < 0.6 ? 5 : ((1 + Math.floor(rng.next() * 4)) as DuelMasterRule);
  }
  return { seed, mode, masterRule, maxSteps: config.maxSteps };
}
