import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Isolated resource bundle when DUEL_DATA_DIR is set; otherwise the canonical engine data. */
export const engineDataDirectory = resolve(
  process.env.DUEL_DATA_DIR ?? fileURLToPath(new URL("../../../data/duel-engine/", import.meta.url)),
);
