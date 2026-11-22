import { availableParallelism } from "node:os";
import { defineConfig, mergeConfig } from "vitest/config";
import config from "./vitest.config.js";
import { duelTestFiles } from "../../scripts/ci/duel-test-files.mjs";

// Complement of the engine lane. Do not load files merely to skip their core cases.
export default mergeConfig(config, defineConfig({
  test: {
    include: duelTestFiles().unit,
    // Host and bridge suites also start their own workers. Leave room for them and Vite.
    maxWorkers: process.env.CI ? Math.max(1, availableParallelism() - 1) : undefined,
  },
}));
