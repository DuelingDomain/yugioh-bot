// The board compiler lives in src/presets/board.ts (the duel host compiles presets with it). Tests import it from here.
// The test default for the engine data directory (DUEL_DATA_DIR, else data/duel-engine) is the same rule as the source default.
export * from "../../src/presets/board.js";
