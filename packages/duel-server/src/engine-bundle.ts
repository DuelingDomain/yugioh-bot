import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { duel1v1Engine, type DuelEngineChoice } from "@yugidraft/shared/duels";
import { LEGACY_DOMAIN_LUA_FILE, LEGACY_DOMAIN_WASM_FILE } from "./legacy/engine.js";
import { MULTI_SCRIPTS_DIRECTORY_NAME, multiScriptsFolderHash } from "./multi-scripts.js";
import { cardScriptPatchesHash } from "./card-script-patches.js";

const standardHint = "Build it with docker.io/emscripten/emsdk:4.0.9 and packages/duel-server/scripts/build-standard-core.sh";
const domainHint = "Build it with docker.io/emscripten/emsdk:4.0.9 and packages/duel-server/scripts/build-domain-core.sh";
const legacyHint = "Build it with docker.io/emscripten/emsdk:4.0.9 and packages/duel-server/legacy-1v1/scripts/build-domain-core.sh (npx tsx packages/duel-server/scripts/build-domain-core.ts legacy-domain)";
const dataHint = "Run npm run duel:prepare";
const multiScriptsHint = "Run npm run duel:prepare (it installs domain-core/multi-scripts into the data directory)";

interface Manifest {
  bundleVersion?: unknown;
  sources?: Record<string, unknown>;
  integrity?: Record<string, unknown>;
}

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function defaultWrapperPath() {
  return fileURLToPath(import.meta.resolve("ocgcore-wasm"));
}

/**
 * Fails fast at startup when the engine resource bundle is incomplete or does not match its manifest.
 * Throws one error that names the file and the command that builds it.
 */
export function verifyEngineBundle(dataDirectory: string, options: { wrapperPath?: string; engine?: DuelEngineChoice } = {}) {
  // The files of the old 1v1 engine are required while 1v1 duels start on it (the default), so a bundle that lacks them stops the
  // server at startup, not in the middle of the first duel. They are always checked when the manifest lists them.
  const engine = options.engine ?? duel1v1Engine();
  const manifestPath = join(dataDirectory, "manifest.json");
  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  } catch (error) {
    throw new Error(`Engine manifest is missing or unreadable at ${manifestPath} (${error instanceof Error ? error.message : String(error)}). ${dataHint}`);
  }
  if (typeof manifest.bundleVersion !== "string" || !manifest.bundleVersion) {
    throw new Error(`Engine manifest at ${manifestPath} has no bundleVersion. ${dataHint}`);
  }

  const standardWasm = join(dataDirectory, "ocgcore.standard.wasm");
  const domainWasm = join(dataDirectory, "ocgcore.domain.wasm");
  const cards = join(dataDirectory, "cards.cdb");
  const scripts = join(dataDirectory, "card-scripts");
  if (!existsSync(standardWasm)) throw new Error(`Standard wasm is missing at ${standardWasm}. ${standardHint}`);
  if (!existsSync(domainWasm)) throw new Error(`Domain wasm is missing at ${domainWasm}. ${domainHint}`);
  if (!existsSync(cards)) throw new Error(`Card database is missing at ${cards}. ${dataHint}`);
  if (!existsSync(scripts) || !statSync(scripts).isDirectory()) throw new Error(`Card scripts directory is missing at ${scripts}. ${dataHint}`);

  const integrity = manifest.integrity ?? {};
  const legacyWasm = join(dataDirectory, LEGACY_DOMAIN_WASM_FILE);
  const legacyLua = join(dataDirectory, "card-scripts", LEGACY_DOMAIN_LUA_FILE);
  const checks: Array<{ key: string; path: () => string; hint: string; required?: boolean }> = [
    { key: "cardRemaps", path: () => join(dataDirectory, "card-remaps.json"), hint: dataHint, required: /^official-releases-prerelease-v\d+$/.test(String(manifest.sources?.databaseFormat ?? "")) },
    { key: "cardsMerged", path: () => cards, hint: dataHint },
    { key: "standardWasm", path: () => standardWasm, hint: standardHint },
    { key: "domainWasm", path: () => domainWasm, hint: domainHint },
    { key: "domainLegacyWasm", path: () => legacyWasm, hint: legacyHint, required: engine === "legacy" },
    { key: "domainLegacyLua", path: () => legacyLua, hint: legacyHint, required: engine === "legacy" },
    { key: "wrapper", path: () => options.wrapperPath ?? defaultWrapperPath(), hint: `Run npm install so patch-package re-applies patches/ocgcore-wasm+0.1.2.patch, then ${dataHint}` },
  ];
  for (const { key, path, hint, required } of checks) {
    const expected = integrity[key];
    if (typeof expected !== "string" || !expected) {
      if (required) throw new Error(`Engine manifest has no integrity.${key}, required by the selected bundle/engine. ${hint}`);
      continue;
    }
    const file = path();
    if (!existsSync(file)) throw new Error(`Engine file ${file} is missing. ${hint}`);
    const actual = sha256(file);
    if (actual !== expected) {
      throw new Error(`Engine file ${file} does not match manifest integrity.${key} (expected ${expected}, got ${actual}). ${hint}`);
    }
  }

  // The Lua overlay of duels with more than two seats. An older bundle has no integrity.multiScripts: nothing to check.
  const expectedMultiScripts = integrity.multiScripts;
  if (typeof expectedMultiScripts === "string" && expectedMultiScripts) {
    const folder = join(dataDirectory, MULTI_SCRIPTS_DIRECTORY_NAME);
    if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new Error(`Multi-scripts folder is missing at ${folder}. ${multiScriptsHint}`);
    const actual = multiScriptsFolderHash(folder);
    if (actual !== expectedMultiScripts) {
      throw new Error(`Engine folder ${folder} does not match manifest integrity.multiScripts (expected ${expectedMultiScripts}, got ${actual}). ${multiScriptsHint}`);
    }
  }
  const expectedPatches = integrity.cardScriptPatches;
  if (expectedPatches !== undefined) {
    try {
      if (typeof expectedPatches !== "string" || !/^[a-f0-9]{64}$/.test(expectedPatches)) throw new Error("invalid hash");
      const actual = cardScriptPatchesHash(scripts);
      if (actual !== expectedPatches) throw new Error(`expected ${expectedPatches}, got ${actual}`);
    } catch (error) {
      throw new Error(`Card scripts at ${scripts} do not match manifest integrity.cardScriptPatches (${error instanceof Error ? error.message : String(error)}). ${dataHint}`);
    }
  }
  return { bundleVersion: manifest.bundleVersion };
}
