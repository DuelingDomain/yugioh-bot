import { defineConfig, mergeConfig } from "vitest/config";
import config from "./vitest.config.js";
import { duelTestFiles } from "../../scripts/ci/duel-test-files.mjs";
import EngineSequencer from "../../scripts/ci/engine-sequencer.mjs";

export default mergeConfig(config, defineConfig({
  test: { include: duelTestFiles().engine, sequence: { sequencer: EngineSequencer } },
}));
