import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installMultiScripts } from "../src/multi-scripts.js";

const sources = {
  corePackage: "ocgcore-wasm@0.1.2",
  scripts: "e25331536ab3c15a901e80098b955d804b5a6842",
  database: "f59125367f43ae566604e75ea4f5307fcc83b349",
  strings: "54a6e2395c532648ff762540e9615319fac4f51b",
};
const directory = resolve(process.env.DUEL_DATA_DIR ?? fileURLToPath(new URL("../../../data/duel-engine/", import.meta.url)));
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
// integrity.multiScripts (the Lua overlay of duels with more than two seats) is not part of bundleVersion: the host pins
// it for those duels only (pinnedEngineVersion), so an overlay edit never touches a 1v1 duel or its replay.
// build-domain-core.sh and build-standard-core.sh compute the same value.
const bundleVersionOf = (sources: Record<string, unknown>, integrity: Record<string, string>) => {
  const { multiScripts: _overlay, ...engine } = integrity;
  return hash(JSON.stringify({ sources, integrity: engine }));
};

type Manifest = {
  sources: Record<string, unknown>;
  integrity: Record<string, string>;
  bundleVersion: string;
};

if (existsSync(join(directory, "bot.sqlite"))) {
  throw new Error(`refusing to prepare engine resources in ${directory} because it contains bot.sqlite`);
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Resource download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function readManifest(path: string): Promise<Manifest | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Manifest;
  } catch {
    return null;
  }
}

async function catalogIsCurrent(manifest: Manifest | null): Promise<boolean> {
  if (!manifest) return false;
  if (manifest.sources.corePackage !== sources.corePackage) return false;
  if (manifest.sources.scripts !== sources.scripts) return false;
  if (manifest.sources.database !== sources.database) return false;
  if (manifest.sources.strings !== sources.strings) return false;
  try {
    const cards = await readFile(join(directory, "cards.cdb"));
    const stringsFile = await readFile(join(directory, "strings.conf"));
    if (hash(cards) !== manifest.integrity.cards) return false;
    if (hash(stringsFile) !== manifest.integrity.strings) return false;
  } catch {
    return false;
  }
  return existsSync(join(directory, "card-scripts"));
}

await mkdir(directory, { recursive: true });
const previous = await readManifest(join(directory, "manifest.json"));
// The Lua overlay of duels with more than two seats ships as <data>/multi-scripts. It is not part of card-scripts
// (this script replaces that folder), and it changes with the repo, so it is installed on every run.
const multiScriptsHash = installMultiScripts(directory);
if (previous && await catalogIsCurrent(previous)) {
  const integrity = { ...previous.integrity, multiScripts: multiScriptsHash };
  const bundleVersion = bundleVersionOf(previous.sources, integrity);
  if (previous.integrity.multiScripts !== multiScriptsHash || previous.bundleVersion !== bundleVersion) {
    previous.integrity = integrity;
    previous.bundleVersion = bundleVersion;
    await writeFile(join(directory, "manifest.json"), JSON.stringify(previous, null, 2) + "\n");
  }
  console.log(JSON.stringify({ directory, skipped: true, ...previous }, null, 2));
  process.exit(0);
}

const luaPath = join(directory, "card-scripts", "domain.lua");
const savedLua = existsSync(luaPath) ? await readFile(luaPath) : null;
// The Domain Lua of the legacy 1v1 engine (built by legacy-1v1/scripts/build-domain-core.sh) is kept the same way.
const legacyLuaPath = join(directory, "card-scripts", "domain.legacy.lua");
const savedLegacyLua = existsSync(legacyLuaPath) ? await readFile(legacyLuaPath) : null;
const temporary = await mkdtemp(join(tmpdir(), "yugidraft-resources-"));
try {
  const [cards, strings, scripts] = await Promise.all([
    download(`https://raw.githubusercontent.com/ProjectIgnis/BabelCDB/${sources.database}/cards.cdb`),
    download(`https://raw.githubusercontent.com/ProjectIgnis/Distribution/${sources.strings}/config/strings.conf`),
    download(`https://codeload.github.com/ProjectIgnis/CardScripts/tar.gz/${sources.scripts}`),
  ]);
  const archive = join(temporary, "scripts.tar.gz");
  await writeFile(archive, scripts);
  const scriptStaging = join(temporary, "card-scripts");
  await mkdir(scriptStaging, { recursive: true });
  execFileSync("tar", ["-xzf", archive, "--strip-components=1", "-C", scriptStaging]);
  if (savedLua) await writeFile(join(scriptStaging, "domain.lua"), savedLua);
  if (savedLegacyLua) await writeFile(join(scriptStaging, "domain.legacy.lua"), savedLegacyLua);
  const scriptDirectory = join(directory, "card-scripts");
  await rm(scriptDirectory, { recursive: true, force: true });
  await cp(scriptStaging, scriptDirectory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, "cards.cdb"), cards),
    writeFile(join(directory, "strings.conf"), strings),
  ]);
  const wasm = await readFile(fileURLToPath(import.meta.resolve("ocgcore-wasm/lib/ocgcore.sync.wasm")));
  const wrapper = await readFile(fileURLToPath(import.meta.resolve("ocgcore-wasm")));
  const integrity: Record<string, string> = {
    cards: hash(cards),
    strings: hash(strings),
    scripts: hash(scripts),
    wasm: hash(wasm),
    wrapper: hash(wrapper),
    multiScripts: multiScriptsHash,
  };
  const mergedSources: Record<string, unknown> = { ...sources };
  const domainWasmPath = join(directory, "ocgcore.domain.wasm");
  const domainLuaPath = join(directory, "card-scripts", "domain.lua");
  if (previous?.sources.domainCore && existsSync(domainWasmPath) && existsSync(domainLuaPath)) {
    mergedSources.domainCore = previous.sources.domainCore;
    integrity.domainWasm = hash(await readFile(domainWasmPath));
    integrity.domainLua = hash(await readFile(domainLuaPath));
    if (previous.integrity.domainPatch) integrity.domainPatch = previous.integrity.domainPatch;
  }
  const legacyWasmPath = join(directory, "ocgcore.domain.legacy.wasm");
  if (previous?.sources.domainCoreLegacy && existsSync(legacyWasmPath) && existsSync(legacyLuaPath)) {
    mergedSources.domainCoreLegacy = previous.sources.domainCoreLegacy;
    integrity.domainLegacyWasm = hash(await readFile(legacyWasmPath));
    integrity.domainLegacyLua = hash(await readFile(legacyLuaPath));
    if (previous.integrity.domainLegacyPatch) integrity.domainLegacyPatch = previous.integrity.domainLegacyPatch;
  }
  const standardWasmPath = join(directory, "ocgcore.standard.wasm");
  if (previous?.sources.standardCore && existsSync(standardWasmPath)) {
    mergedSources.standardCore = previous.sources.standardCore;
    integrity.standardWasm = hash(await readFile(standardWasmPath));
  }
  const manifest = { sources: mergedSources, integrity, bundleVersion: bundleVersionOf(mergedSources, integrity) };
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ directory, ...manifest }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
