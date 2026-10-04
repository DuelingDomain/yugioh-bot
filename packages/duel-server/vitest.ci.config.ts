import { defineConfig, mergeConfig } from "vitest/config";
import config from "./vitest.config.js";
import EngineSequencer from "../../scripts/ci/engine-sequencer.mjs";

export default mergeConfig(config, defineConfig({
  test: { sequence: { sequencer: EngineSequencer } },
}));
