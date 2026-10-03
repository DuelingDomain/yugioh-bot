import { currentEngineDataDirectory } from "../engine-data-dir.js";

// Vitest setup file (vitest.config.ts): every test file starts with the same engine data directory, also for
// source modules that read DUEL_DATA_DIR themselves. An explicit DUEL_DATA_DIR always wins.
process.env.DUEL_DATA_DIR = currentEngineDataDirectory();

// Most test files cover n-seat tables, so the flag is on for them. Tests of the flag itself set or delete it.
// MULTIPLAYER_TABLES=0 in the shell turns it off for a whole run.
process.env.MULTIPLAYER_TABLES ??= "1";

// Production starts 1v1 duels on the legacy engine (the default). The merged suites cover the merged engine, so they start on it.
// Tests of the switch set DUEL_1V1_ENGINE themselves. DUEL_1V1_ENGINE=legacy in the shell runs a whole suite on the legacy engine.
process.env.DUEL_1V1_ENGINE ??= "pinned";
