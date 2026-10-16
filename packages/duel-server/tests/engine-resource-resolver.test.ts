import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isEngineIdentity, type EngineIdentity, type ReplaySource } from "@yugidraft/shared/duels";
import { ENGINE_HOST_RULE_VERSION, ENGINE_HOST_RULE_FILES, getCurrentEngineResources, resolveEngineResourcesForSource, verifyWorkerEngineIdentity } from "../src/engine-resource-resolver.js";

const directories: string[] = [];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
afterEach(() => { vi.unstubAllEnvs(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function bundle() {
  const directory = mkdtempSync(join(tmpdir(), "replay-resources-"));
  directories.push(directory);
  vi.stubEnv("DUEL_MULTI_SCRIPTS_DIR", join(directory, "multi-scripts"));
  const files = {
    "manifest.json": JSON.stringify({ bundleVersion: "bundle-1" }),
    "cards.cdb": "cards", "card-remaps.json": "{}",
    "ocgcore.standard.wasm": "standard", "ocgcore.domain.wasm": "domain",
    "ocgcore.domain.legacy.wasm": "legacy-domain",
    "ocgcore.multi.wasm": "multi", "ocgcore.multi-domain.wasm": "multi-domain",
    "card-scripts/constant.lua": "constants", "card-scripts/domain.lua": "domain-script",
    "card-scripts/domain.legacy.lua": "legacy-script", "card-scripts/official/c1.lua": "card-script",
    "multi-scripts/mp-utility.lua": "overlay",
    "multi-scripts/MANIFEST.json": JSON.stringify({ version: 1, cards: [] }),
  };
  for (const [file, value] of Object.entries(files)) {
    mkdirSync(join(directory, file, ".."), { recursive: true });
    writeFileSync(join(directory, file), value);
  }
  return directory;
}

function source(directory: string, mode: "normal" | "domain" = "normal", format: "1v1" | "tag" | "ffa3" | "ffa4" = "1v1", engine: "legacy" | "pinned" = "pinned") {
  const resources = getCurrentEngineResources(directory, { mode, format, engine,
    ...(format !== "1v1" ? { multiScriptsDirectory: join(directory, "multi-scripts") } : {}) });
  const value = {
    session: { mode, format, masterRule: 5 }, bundleVersion: resources.bundleVersion,
    setup: { engine, firstTurnDraw: false, scriptErrorMode: "tolerant" }, engineIdentity: resources.identity,
  } as Pick<ReplaySource, "session" | "bundleVersion" | "setup" | "engineIdentity">;
  return { value, resources };
}

function fingerprintSource(source: string): string {
  const emitted = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true,
  } }).outputText;
  const ast = ts.createSourceFile("rules.js", emitted, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const tokens: Array<[number, string]> = [];
  const visit = (node: ts.Node) => {
    const children = node.getChildren(ast);
    if (children.length) children.forEach(visit);
    else tokens.push([node.kind, node.getText(ast)]);
  };
  visit(ast);
  return JSON.stringify(tokens);
}

describe("current engine identity", () => {
  it("uses a manual host-rule version rather than source bytes", () => {
    expect(ENGINE_HOST_RULE_VERSION).toMatch(/^duel-rules-\d+$/);
  });
  it("covers every local runtime dependency of the engines, journal runner and worker", () => {
    const directory = fileURLToPath(new URL("../src/", import.meta.url));
    const covered = new Set<string>(ENGINE_HOST_RULE_FILES);
    const seen = new Set<string>();
    const visit = (name: string) => {
      if (seen.has(name)) return;
      seen.add(name);
      expect(covered.has(name), `host-rule identity must include ${name}`).toBe(true);
      const path = join(directory, `${name}.ts`);
      const ast = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest);
      for (const node of ast.statements) {
        if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
        if (ts.isImportDeclaration(node)) {
          const clause = node.importClause;
          if (clause?.isTypeOnly || (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
            && !clause.name && clause.namedBindings.elements.every(element => element.isTypeOnly))) continue;
        } else if (node.isTypeOnly) continue;
        const specifier = node.moduleSpecifier;
        if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith(".")) continue;
        visit(resolve(dirname(path), specifier.text).slice(directory.length).replace(/\.js$/, ""));
      }
    };
    for (const name of ["engine", "legacy/index", "worker", "journal-runner"]) visit(name);
  });

  it("ignores comments and formatting in fingerprints while retaining runtime changes and literal text", () => {
    const before = fingerprintSource('export function add(value: number) { return value + 1; }');
    expect(fingerprintSource('/* explanation */\nexport function add ( value : number ) {\n  // same rule\n  return value + 1;\n}')).toBe(before);
    expect(fingerprintSource('export function add(value: number) { return value + 2; }')).not.toBe(before);
    expect(fingerprintSource('export const pattern = /a b/;')).not.toBe(fingerprintSource('export const pattern = /ab/;'));
    expect(fingerprintSource('export const label = "// keep spaces";')).not.toBe(fingerprintSource('export const label = "//keepspaces";'));
  });
  it("guards the manual version with the engine/journal source fingerprint", () => {
    const hash = createHash("sha256");
    const directory = fileURLToPath(new URL("../src/", import.meta.url));
    for (const name of ENGINE_HOST_RULE_FILES) hash.update(`${name}\0`).update(fingerprintSource(readFileSync(join(directory, `${name}.ts`), "utf8")));
    // These are the shared runtime helpers imported by the engine/journal path, not all of shared/dist/duels.
    for (const name of ["index", "settings", "banlist-options", "pool", "replay", "source-engine-choice"]) {
      hash.update(`shared/${name}\0`).update(fingerprintSource(readFileSync(new URL(`../../shared/src/duels/${name}.ts`, import.meta.url), "utf8")));
    }
    const baselines = JSON.parse(readFileSync(new URL("./support/host-rule-fingerprints.json", import.meta.url), "utf8"));
    // Version 5 records PR #348's fixed FFA facing pairs, board projection and Domain FFA draw setting.
    // PR #361 refreshed version 5: the Extra Deck type lookup before a duel starts is admission only (no engine/journal change).
    // PR #344 integration refreshes version 5 for async worker admission, deadlines and structural answer checks.
    // Successful journals retain the same creation rules, command ordering and board projections.
    // Version 4 includes PR #354's behavior-neutral worker startup instrumentation and cached catalog preload.
    // PR #346 refreshes version 5 for worker error metadata and card-loading fallback reporting.
    // These changes preserve engine command interpretation and replay journal behavior.
    // Stream E integration refreshes version 5 for safe error classification/reporting with async admission.
    // Successful engine commands and replay journals are unchanged.
    // Genesys refreshes version 5 for opt-in field geometry carried in saved settings. Missing/null Genesys
    // retains identical flags, views and replay source hashes (real-worker coverage includes all core variants).
    // Preserve the identity of historical sources, including active replay forks; earlier binaries cannot run Genesys.
    // Baselines for versions 1-4 remain unchanged.
    expect(hash.digest("hex"), "Runtime fingerprint changed (comments/formatting/type-only edits are ignored). Bump ENGINE_HOST_RULE_VERSION and add its fingerprint; behavior-neutral refreshes must explain why").toBe(baselines[ENGINE_HOST_RULE_VERSION]);
  });

  it("keeps the deployed host-rule identity stable after a comment-only source edit", () => {
    const directory = mkdtempSync(fileURLToPath(new URL("../.host-rule-test-", import.meta.url)));
    directories.push(directory);
    for (const name of ENGINE_HOST_RULE_FILES) {
      mkdirSync(join(directory, name, ".."), { recursive: true });
      writeFileSync(join(directory, `${name}.ts`), readFileSync(new URL(`../src/${name}.ts`, import.meta.url)));
    }
    const deployedVersion = () => execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      `import { ENGINE_HOST_RULE_VERSION } from ${JSON.stringify(join(directory, "engine-resource-resolver.ts"))}; console.log(ENGINE_HOST_RULE_VERSION);`], { encoding: "utf8" }).trim();
    const before = deployedVersion();
    const view = join(directory, "views.ts");
    writeFileSync(view, readFileSync(view, "utf8") + "\n// source-only deployment edit\n");
    expect(deployedVersion()).toBe(before);
  });

  it.each([
    ["normal", "1v1", "pinned", "standard", null],
    ["domain", "1v1", "pinned", "domain", "domain-script"],
    ["domain", "1v1", "legacy", "legacy-domain", "legacy-script"],
    ["normal", "tag", "legacy", "multi", null],
    ["domain", "ffa3", "pinned", "multi-domain", "domain-script"],
    ["domain", "ffa4", "legacy", "multi-domain", "domain-script"],
  ] as const)("identifies %s %s with choice %s", (mode, format, engine, wasm, script) => {
    const { resources } = source(bundle(), mode, format, engine);
    expect(isEngineIdentity(resources.identity)).toBe(true);
    expect(resources.identity).toMatchObject({ mode, coreFamily: format === "1v1" ? engine : "multi",
      wasmHash: hash(wasm), domainScriptHash: script === null ? null : hash(script) });
    expect(resources.multiScriptsDirectory ?? null).toBe(format === "1v1" ? null : join(resources.dataDirectory, "multi-scripts"));
  });

  it("identifies the npm legacy Normal core independently of pinned Standard", () => {
    const directory = bundle();
    const legacy = source(directory, "normal", "1v1", "legacy").resources.identity;
    const pinned = source(directory).resources.identity;
    expect(legacy.coreFamily).toBe("legacy");
    expect(legacy.wasmHash).not.toBe(pinned.wasmHash);
    expect(legacy.wrapperHash).toBe(pinned.wrapperHash);
  });

  it.each(["wasmHash", "wrapperHash", "cardDatabaseHash", "cardRemapsHash", "cardScriptsHash", "domainScriptHash", "multiOverlayHash"] as const)("refuses a changed %s", (field) => {
    const directory = bundle();
    const { value } = source(directory, "domain", "ffa4");
    value.engineIdentity = { ...value.engineIdentity!, [field]: "0".repeat(64) };
    expect(() => resolveEngineResourcesForSource(directory, value)).toThrowError(expect.objectContaining({ code: "ENGINE_UNAVAILABLE_FOR_SOURCE", status: 409 }));
  });

  it.each(["wrapperVersion", "protocolVersion", "hostRuleVersion", "coreFamily", "mode", "version"] as const)("refuses a changed %s without fallback", (field) => {
    const directory = bundle();
    const { value } = source(directory);
    value.engineIdentity = { ...value.engineIdentity!, [field]: field === "version" ? 2 : "different" } as unknown as EngineIdentity;
    expect(() => resolveEngineResourcesForSource(directory, value)).toThrowError(expect.objectContaining({ code: "ENGINE_UNAVAILABLE_FOR_SOURCE" }));
  });

  it.each(["cards.cdb", "ocgcore.standard.wasm", "card-scripts/official/c1.lua", "card-remaps.json"])("checks actual changed bytes at %s", (file) => {
    const directory = bundle();
    const { value } = source(directory);
    writeFileSync(join(directory, file), "changed");
    expect(() => resolveEngineResourcesForSource(directory, value)).toThrowError(expect.objectContaining({ code: "ENGINE_UNAVAILABLE_FOR_SOURCE" }));
  });

  it("refuses missing resources and does not look for archives", () => {
    const directory = bundle();
    const { value } = source(directory);
    rmSync(join(directory, "ocgcore.standard.wasm"));
    expect(() => resolveEngineResourcesForSource(directory, value)).toThrowError(/^Engine resources are not available: the current engine resources are incomplete\.$/);
  });

  it("refuses an old source without assigning today's identity", () => {
    const directory = bundle();
    const { value } = source(directory);
    value.engineIdentity = null;
    expect(() => resolveEngineResourcesForSource(directory, value)).toThrowError(expect.objectContaining({ code: "ENGINE_UNAVAILABLE_FOR_SOURCE" }));
    expect(value.engineIdentity).toBeNull();
  });

  it("refuses a bundle mismatch even when identity matches", () => {
    const directory = bundle();
    const { value } = source(directory);
    value.bundleVersion = "old-bundle";
    expect(() => resolveEngineResourcesForSource(directory, value)).toThrowError(expect.objectContaining({ code: "ENGINE_UNAVAILABLE_FOR_SOURCE" }));
  });
  it.each([
    ["normal", "1v1", "legacy"], ["normal", "1v1", "pinned"],
    ["domain", "1v1", "legacy"], ["domain", "1v1", "pinned"],
    ["normal", "tag", "legacy"], ["domain", "ffa4", "pinned"],
  ] as const)("selects the installed %s %s %s family for cross-version verification", (mode, format, engine) => {
    const directory = bundle(), { value, resources } = source(directory, mode, format, engine);
    value.bundleVersion = "older-bundle";
    value.engineIdentity = { ...value.engineIdentity!, cardScriptsHash: "e".repeat(64) };
    const before = structuredClone(value);
    expect(resolveEngineResourcesForSource(directory, value, undefined, "replay-verification")).toEqual(resources);
    expect(value).toEqual(before);
    value.engineIdentity = null;
    expect(resolveEngineResourcesForSource(directory, value, undefined, "replay-verification")).toEqual(resources);
  });
  it("refuses a missing pinned core during cross-version selection", () => {
    const directory = bundle(), { value } = source(directory);
    value.bundleVersion = "older-bundle"; rmSync(join(directory, "ocgcore.standard.wasm"));
    expect(() => resolveEngineResourcesForSource(directory, value, undefined, "replay-verification"))
      .toThrowError(expect.objectContaining({ code: "ENGINE_UNAVAILABLE_FOR_SOURCE" }));
  });

  it("keeps saved legacy choice when the current switch selects pinned", () => {
    const directory = bundle();
    const { value } = source(directory, "domain", "1v1", "legacy");
    expect(resolveEngineResourcesForSource(directory, value).identity.coreFamily).toBe("legacy");
    value.setup!.engine = "pinned";
    expect(() => resolveEngineResourcesForSource(directory, value)).toThrowError(expect.objectContaining({ code: "ENGINE_UNAVAILABLE_FOR_SOURCE" }));
  });

  it.each(["firstTurnDraw", "scriptErrorMode"] as const)("refuses missing recorded %s", (field) => {
    const directory = bundle();
    const { value } = source(directory);
    delete value.setup![field];
    expect(() => resolveEngineResourcesForSource(directory, value)).toThrowError(expect.objectContaining({ code: "ENGINE_UNAVAILABLE_FOR_SOURCE" }));
  });

  it("uses the pinned overlay in the worker after environment selection changes", () => {
    const directory = bundle();
    const { resources } = source(directory, "domain", "ffa4");
    vi.stubEnv("DUEL_MULTI_SCRIPTS_DIR", join(directory, "missing"));
    expect(() => verifyWorkerEngineIdentity(directory, { mode: "domain", format: "ffa4", multiScriptsDirectory: resources.multiScriptsDirectory }, resources.identity)).not.toThrow();
  });

  it("refuses changes between server selection and worker creation", () => {
    const directory = bundle();
    const { resources } = source(directory);
    writeFileSync(join(directory, "ocgcore.standard.wasm"), "changed before worker");
    expect(() => verifyWorkerEngineIdentity(directory, { mode: "normal", engine: "pinned" }, resources.identity)).toThrowError(expect.objectContaining({ code: "ENGINE_UNAVAILABLE_FOR_SOURCE" }));
  });

  it("includes multi core capabilities in the host rule identity", () => {
    const directory = bundle();
    const { value } = source(directory, "domain", "ffa4");
    writeFileSync(join(directory, "ocgcore.multi-domain.SOURCE"), `sha256=${value.engineIdentity!.wasmHash}\ncapabilities=ffa4-facing-extra-zones\n`);
    expect(() => resolveEngineResourcesForSource(directory, value)).toThrowError(expect.objectContaining({ code: "ENGINE_UNAVAILABLE_FOR_SOURCE" }));
  });

  it("accepts a current multi Domain source and does not change it", () => {
    const directory = bundle();
    const { value, resources } = source(directory, "domain", "ffa4");
    const before = structuredClone(value);
    expect(resolveEngineResourcesForSource(directory, value)).toEqual(resources);
    expect(value).toEqual(before);
  });

  it("refuses script symlinks that the folder digest would otherwise omit", () => {
    const directory = bundle();
    const { value } = source(directory);
    const target = join(directory, "outside.lua");
    writeFileSync(target, "script outside the hashed folder");
    symlinkSync(target, join(directory, "card-scripts/c2.lua"));
    expect(() => resolveEngineResourcesForSource(directory, value)).toThrowError(expect.objectContaining({ code: "ENGINE_UNAVAILABLE_FOR_SOURCE" }));
  });
});
