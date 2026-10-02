import { fileURLToPath } from "node:url";

// Apply before importing env.mjs: build and runtime must bake in the same ws URL.
export function applyManualDefaults(env = process.env) {
  env.E2E_MANUAL = "1";
  env.E2E_WEB_PORT ??= "3400";
  env.E2E_WS_PORT ??= "3402";
  env.E2E_WS_INTERNAL_PORT ??= "4402";
  env.E2E_DUEL_PORT ??= "4403";
  env.E2E_DUEL_DATA_DIR ??= fileURLToPath(new URL("../../../data/duel-engine-snap", import.meta.url));
  env.E2E_BOT_STEP_MS ??= "900";
}
