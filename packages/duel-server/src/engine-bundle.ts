import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MULTI_SCRIPTS_DIRECTORY_NAME, multiScriptsFolderHash } from "./multi-scripts.js";

const standardHint = "Build it with docker.io/emscripten/emsdk:4.0.9 and packages/duel-server/scripts/build-standard-core.sh";
const domainHint = "Build it with docker.io/emscripten/emsdk:4.0.9 and packages/duel-server/scripts/build-domain-core.sh";
const dataHint = "Run npm run duel:prepare";
const multiScriptsHint = "Run npm run duel:prepare (it installs domain-core/multi-scripts into the data directory)";

interface Manifest {
  bundleVersion?: unknown;
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
export function verifyEngineBundle(dataDirectory: string, options: { wrapperPath?: string } = {}) {
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
  const checks: Array<{ key: string; path: () => string; hint: string }> = [
    { key: "standardWasm", path: () => standardWasm, hint: standardHint },
    { key: "domainWasm", path: () => domainWasm, hint: domainHint },
    { key: "wrapper", path: () => options.wrapperPath ?? defaultWrapperPath(), hint: `Run npm install so patch-package re-applies patches/ocgcore-wasm+0.1.2.patch, then ${dataHint}` },
  ];
  for (const { key, path, hint } of checks) {
    const expected = integrity[key];
    if (typeof expected !== "string" || !expected) continue;
    const file = path();
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
  return { bundleVersion: manifest.bundleVersion };
}
