import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EngineCoreInfo, EngineGame, EngineGameOptions } from "../engine.js";
import { LEGACY_DOMAIN_WASM_FILE, createEngineGame as createMainEngineGame } from "./engine.js";

/**
 * The legacy one-against-one engine (main's engine, views and prompts, see ./engine.ts) behind the merged `EngineGame`
 * interface. It plays two-seat Standard and Domain duels with board fixture scripts, but has no elimination.
 * Its diagnostics contain display data errors.
 */

const NPM_CORE_NAME = "ocgcore-wasm npm package core (built in)";

/**
 * sha256 of lib/ocgcore.sync.wasm in the npm package, or "" when it cannot be found. The core that `createCore({ sync: true })`
 * loads without a wasmBinary is these same bytes (tests/legacy-engine-identity.test.ts checks it).
 */
function npmCoreSha(): string {
  try {
    const wrapper = fileURLToPath(import.meta.resolve("ocgcore-wasm"));
    const path = join(dirname(wrapper), "..", "lib", "ocgcore.sync.wasm");
    return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : "";
  } catch {
    return "";
  }
}

function legacyCoreIdentity(options: EngineGameOptions): Pick<EngineCoreInfo, "wasmSha" | "wasmFile"> {
  if (options.mode === "domain") {
    const path = join(options.dataDirectory, LEGACY_DOMAIN_WASM_FILE);
    const sha = existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : "";
    return { wasmSha: sha, wasmFile: LEGACY_DOMAIN_WASM_FILE };
  }
  return { wasmSha: npmCoreSha(), wasmFile: NPM_CORE_NAME };
}

export async function createLegacyEngineGame(options: EngineGameOptions): Promise<EngineGame> {
  if (options.format && options.format !== "1v1") throw new Error("The legacy engine plays 1v1 tables only");
  if (options.startupScripts?.some((script) => typeof script?.name !== "string" || typeof script?.content !== "string")) {
    throw new Error("Invalid startup script: expected name and content");
  }
  const identity = legacyCoreIdentity(options);
  const inner = await createMainEngineGame({
    mode: options.mode,
    scriptErrorMode: options.scriptErrorMode,
    onScriptError: options.onScriptError,
    onFatalScriptError: options.onFatalScriptError,
    startupScripts: options.startupScripts,
    decks: options.decks,
    seed: options.seed,
    dataDirectory: options.dataDirectory,
    firstTurnDraw: options.firstTurnDraw,
    ...(options.masterRule ? { masterRule: options.masterRule } : {}),
    ...(options.settings ? { settings: options.settings } : {}),
  });
  return {
    view: (seat) => inner.view(seat),
    answer: (seat, promptId, answer) => inner.answer(seat, promptId, answer),
    searchCards: (query) => inner.searchCards(query),
    setChainMode: (seat, mode) => inner.setChainMode(seat, mode),
    eliminate() {
      throw new Error("The legacy engine plays 1v1 tables only; nobody is eliminated");
    },
    diagnostics: () => inner.diagnostics(),
    coreInfo: () => ({ ...identity, callsSinceLastPrompt: 0, messagesSinceLastPrompt: 0 }),
    close: () => inner.close(),
  };
}
