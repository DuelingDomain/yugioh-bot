import { defineConfig, mergeConfig } from "vitest/config";
import config from "./vitest.config.js";

// DUEL_1V1_ENGINE selects the legacy engine in the production host/worker only.
// Tests that call src/engine directly still use the merged engine, as do all multi-seat scenarios.
// The full engine shards cover those files. Keep main's frozen legacy tests and the 1v1 integration gates here.
// Add any new host test that starts a default 1v1 table to this include list.
export default mergeConfig(config, defineConfig({
  test: {
    include: [
      "tests/legacy-main/**/*.test.ts",
      "tests/legacy-engine-identity.test.ts",
      "tests/host-engine-switch.test.ts",
      "tests/host.test.ts",
    ],
  },
}));
