import { currentEngineDataDirectory } from "../engine-data-dir.js";

// Vitest setup file (vitest.config.ts): every test file starts with the same engine data directory, also for
// source modules that read DUEL_DATA_DIR themselves. An explicit DUEL_DATA_DIR always wins.
process.env.DUEL_DATA_DIR = currentEngineDataDirectory();
