// The board compiler lives in src/presets/board.ts (the duel host compiles presets with it). Tests import it from here.
// The test default for the engine data directory is tests/engine-data-dir.ts (DUEL_DATA_DIR, else data/duel-engine-next); production keeps data/duel-engine in src/server.ts.
export * from "../../src/presets/board.js";
