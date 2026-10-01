import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The ONE test default for the engine resource bundle: `data/duel-engine-next` (standard, domain and multi cores,
 * cards.cdb, scripts). DUEL_DATA_DIR overrides it. Tests never default to the live `data/duel-engine`.
 * The production default of src/server.ts (`data/duel-engine`) is a separate rule and does not change.
 * tests/support/setup.ts also writes this value into process.env.DUEL_DATA_DIR, so source code that reads the
 * variable (src/presets/catalog.ts) agrees with the tests.
 */
export const DEFAULT_TEST_DATA_DIRECTORY = fileURLToPath(new URL("../../../data/duel-engine-next/", import.meta.url));

/** Reads DUEL_DATA_DIR at call time, for code that sets the variable after this module loaded. */
export function currentEngineDataDirectory(): string {
  return resolve(process.env.DUEL_DATA_DIR ?? DEFAULT_TEST_DATA_DIRECTORY);
}

export const engineDataDirectory = currentEngineDataDirectory();
