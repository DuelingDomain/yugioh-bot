/**
 * Engine switch DUEL_1V1_ENGINE. It picks the engine that runs one-against-one duels (Standard and Domain):
 * - `legacy` (default): the engine that production ran before the n-seat work. Same wasm cores, same Lua, same message
 *   parser and same view code as that release.
 * - `pinned`: the merged engine (the same code that 3-player, 4-player and Tag tables use, with two-seat rules).
 * Tables with more than two seats always use the multi-duelist core, whatever this switch says.
 * The value is read from the process environment each time it is asked, so a restart (not a build) switches it.
 * Anything other than "pinned" means `legacy`, so a typo falls back to the old engine.
 */
export const DUEL_1V1_ENGINE_ENV = "DUEL_1V1_ENGINE";

export type DuelEngineChoice = "legacy" | "pinned";

export const DEFAULT_DUEL_1V1_ENGINE: DuelEngineChoice = "legacy";

export function isDuelEngineChoice(value: unknown): value is DuelEngineChoice {
  return value === "legacy" || value === "pinned";
}

export function duel1v1Engine(env: Record<string, string | undefined> = process.env): DuelEngineChoice {
  const value = env[DUEL_1V1_ENGINE_ENV]?.trim().toLowerCase();
  return value === "pinned" ? "pinned" : DEFAULT_DUEL_1V1_ENGINE;
}
