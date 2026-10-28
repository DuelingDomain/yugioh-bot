import { defineConfig, mergeConfig } from "vitest/config";
import config from "./vitest.config.js";
import { duelTestFiles } from "../../scripts/ci/duel-test-files.mjs";

// Complement of the engine lane. Do not load files merely to skip their core cases.
export default mergeConfig(config, defineConfig({
  test: { include: duelTestFiles().unit },
}));
