import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { extraFullSuites, fullSuiteReason, runtimeDependencies, sourceFile } from "./pr-test-inputs.mjs";
import { planUnitShards } from "./unit-test-plan.mjs";
import { WEB_FULL_SHARDS } from "./web-test-plan.mjs";

const workspaceNames = {
  web: "web", shared: "shared", bot: "bot", ws: "ws", worker: "worker", duel_unit: "duel-server",
};
const packageName = specifier => specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
const repoPath = (root, file) => relative(root, file).split(sep).join("/");
const modulePath = path => path.split("?")[0];
const pos = (node, source) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

function moduleReferences(source) {
  const modules = [];
  const paths = [];
  let opaque = false;
  function collect(argument) {
    if (argument && ts.isStringLiteralLike(argument)) modules.push([argument.text, pos(argument, source)]);
    else opaque = true;
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) collect(node.moduleSpecifier);
    } else if (ts.isExternalModuleReference(node)) {
      collect(node.expression);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      collect(node.argument.literal);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(source);
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || callee === "require" || callee === "require.resolve") {
        collect(node.arguments[0]);
      } else if (/^vi\.(?:mock|unmock|doMock|doUnmock|importActual|importMock)$/.test(callee)) {
        // Vitest also accepts vi.mock(import("...")), visited as a child.
        if (!node.arguments[0] || !ts.isCallExpression(node.arguments[0])) collect(node.arguments[0]);
      } else if (callee === "import.meta.glob" || callee === "import.meta.resolve") {
        opaque = true;
      }
    } else if (ts.isNewExpression(node) && node.expression.getText(source) === "URL" &&
      node.arguments?.[1]?.getText(source) === "import.meta.url") {
      // Captures worker and subprocess entry points passed through fileURLToPath.
      const argument = node.arguments[0];
      const candidates = ts.isConditionalExpression(argument) ? [argument.whenTrue, argument.whenFalse] : [argument];
      for (const candidate of candidates) {
        if (ts.isStringLiteralLike(candidate) && sourceFile.test(modulePath(candidate.text))) paths.push(modulePath(candidate.text));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const reference of source.referencedFiles) paths.push(reference.fileName);
  return { modules, paths, opaque };
}

function createResolver(root) {
  const packages = new Map();
  for (const entry of readdirSync(resolve(root, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = resolve(root, "packages", entry.name);
    const manifest = resolve(dir, "package.json");
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, "utf8"));
      packages.set(pkg.name, { dir, exports: pkg.exports });
    }
  }

  const host = { ...ts.sys, readDirectory: () => [] };
  const configs = new Map();
  const configFor = importer => {
    const config = ts.findConfigFile(dirname(importer), ts.sys.fileExists) ?? resolve(root, "tsconfig.json");
    if (!configs.has(config)) {
      const loaded = ts.readConfigFile(config, ts.sys.readFile);
      if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"));
      const parsed = ts.parseJsonConfigFileContent(loaded.config, host, dirname(config), undefined, config);
      const errors = parsed.errors.filter(error => error.code !== 18003);
      if (errors.length) throw new Error(ts.flattenDiagnosticMessageText(errors[0].messageText, "\n"));
      const options = parsed.options;
      const bundler = { ...options, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
      configs.set(config, [options, bundler].map(options => ({
        options,
        cache: ts.createModuleResolutionCache(root, path => path, options),
      })));
    }
    return configs.get(config);
  };

  function resolveTs(specifier, importer) {
    for (const { options, cache } of configFor(importer)) {
      const result = ts.resolveModuleName(specifier, importer, options, ts.sys, cache, undefined, ts.ModuleKind.ESNext);
      if (result.resolvedModule) return result.resolvedModule.resolvedFileName;
    }
  }

  function resolveWorkspace(specifier, importer) {
    const name = packageName(specifier);
    const workspace = packages.get(name);
    if (!workspace) return;
    const subpath = specifier === name ? "." : "." + specifier.slice(name.length);
    const entry = workspace.exports?.[subpath];
    // Workspace exports prefer built types at runtime/typecheck. Use their
    // explicit source condition or resolve the matching src/ entry via TS's
    // JS-to-TS substitution for workspaces that only export dist/.
    const target = entry?.source ?? entry?.default ?? (typeof entry === "string" ? entry : undefined);
    if (typeof target !== "string" || !target.startsWith("./")) return;
    return resolveTs(resolve(workspace.dir, target.replace(/^\.\/dist\//, "./src/")), importer);
  }

  return {
    resolveModule(specifier, importer) {
      if (isBuiltin(specifier)) return specifier;
      if (packages.has(packageName(specifier))) return resolveWorkspace(specifier, importer);
      const id = modulePath(specifier);
      const source = id.startsWith(".") && id.includes("/dist/")
        ? resolveTs(id.replace("/dist/", "/src/"), importer) : undefined;
      const path = source ?? resolveTs(id, importer);
      if (path) return path;
      try {
        return createRequire(importer).resolve(specifier);
      } catch {
        return undefined;
      }
    },
    resolvePath(specifier, importer) {
      const path = resolve(dirname(importer), specifier);
      return resolveTs(path, importer) ?? resolveTs(path.replace(/\/dist\//, "/src/"), importer);
    },
  };
}

export async function selectSuiteFiles({ root, suite, tests, setup = [], changes, existing, viteResolve, resolver }) {
  const cwd = resolve(root, "packages", workspaceNames[suite]);
  const affected = file => changes.includes(repoPath(root, file));
  const full = (reason, hasHit = false) => ({ files: null, affected: existing || hasHit, reason });
  const reason = fullSuiteReason(root, changes);
  if (reason) return full(reason, changes?.some(file => extraFullSuites[suite]?.test(file)));
  if (!tests.length) return full("Vitest discovered no test files");
  resolver ??= createResolver(root);

  const importers = new Map();
  const visited = new Set();
  const opaque = new Set();
  const problems = new Set();
  const setupPaths = new Set(setup.map(file => resolve(file)));
  const pending = [...tests.map(file => resolve(root, file)), ...setupPaths];
  const link = (importer, dependency) => {
    if (!isAbsolute(dependency)) return;
    const path = realpathSync(modulePath(dependency));
    const local = repoPath(root, path);
    if (local.startsWith("../") || local.split("/").includes("node_modules")) return;
    if (!importers.has(path)) importers.set(path, new Set());
    importers.get(path).add(importer);
    if (sourceFile.test(path)) pending.push(path);
  };

  for (const file of pending) {
    if (visited.has(file)) continue;
    visited.add(file);
    const name = repoPath(root, file);
    for (const target of runtimeDependencies[name] ?? []) {
      const path = resolve(root, target);
      if (existsSync(path)) link(file, path);
      else problems.add(`${name} cannot resolve subprocess input ${target}`);
    }
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const references = moduleReferences(source);
    if (references.opaque) opaque.add(file);
    if (source.parseDiagnostics.length) problems.add(`could not parse ${repoPath(root, file)}`);
    for (const [specifier, line] of references.modules) {
      const path = resolver.resolveModule(specifier, file) ?? await viteResolve?.(specifier, file);
      if (path) link(file, path);
      else problems.add(`${repoPath(root, file)}:${line} cannot resolve ${specifier}`);
    }
    for (const specifier of references.paths) {
      const path = resolver.resolvePath(specifier, file);
      if (path) link(file, path);
      else problems.add(`${repoPath(root, file)} cannot resolve path ${specifier}`);
    }
  }

  const reverseReach = seeds => {
    const reachable = new Set(seeds);
    for (const file of reachable) {
      for (const importer of importers.get(file) ?? []) reachable.add(importer);
    }
    return reachable;
  };
  const direct = reverseReach([...visited, ...importers.keys()].filter(affected));
  const absoluteTests = tests.map(file => resolve(root, file));
  const hasHit = absoluteTests.some(file => direct.has(file)) || [...setupPaths].some(file => direct.has(file));
  if (problems.size) return full([...problems].join("\n"), hasHit);

  // Setup dependencies affect every test. Unknown computed import targets keep
  // every test that reaches their importer for any otherwise selected suite.
  const selected = reverseReach([...direct, ...opaque]);
  if ([...setupPaths].some(file => selected.has(file))) return full("global test setup dependency", hasHit);
  return {
    files: absoluteTests.filter(file => selected.has(file)).map(file => repoPath(cwd, file)).sort(),
    affected: existing || hasHit,
  };
}

async function main() {
  const { appendFileSync } = await import("node:fs");
  const { createVitest } = await import("vitest/node");
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const layers = JSON.parse(process.env.CI_LAYERS);
  const changes = JSON.parse(layers.test_diff);
  const output = {};
  const reason = fullSuiteReason(root, changes);
  const resolver = reason ? undefined : createResolver(root);
  for (const [suite, workspace] of Object.entries(workspaceNames)) {
    const existing = layers[suite] === "true";
    const group = { root, suite, changes, existing, resolver };
    let result;
    if (reason) {
      result = await selectSuiteFiles({ ...group, tests: [] });
    } else {
      const cwd = resolve(root, "packages", workspace);
      const duel = suite === "duel_unit";
      const vitest = await createVitest("test", {
        root: cwd,
        watch: false,
        cache: false,
        ...(duel ? { config: resolve(cwd, "vitest.unit.config.ts") } : {}),
        ...(suite === "web" ? { exclude: [".next/**"] } : {}),
      });
      try {
        const tests = (await vitest.globTestSpecifications(duel ? ["tests"] : []))
          .map(test => repoPath(root, test.moduleId));
        const setup = vitest.projects.flatMap(project => [...project.config.setupFiles, ...project.config.globalSetup]);
        const viteResolve = async (specifier, file) => {
          const resolved = await vitest.vite.environments.ssr.pluginContainer.resolveId(specifier, file);
          return resolved && isAbsolute(resolved.id) ? resolved.id : undefined;
        };
        result = await selectSuiteFiles({ ...group, tests, setup, viteResolve });
      } finally {
        await vitest.close();
      }
    }

    if (!result.affected) continue;
    output[suite] = "true";
    // An unexplained empty result won't silently turn a selected suite green.
    if (result.files?.length) {
      output[suite + "_files"] = JSON.stringify(result.files);
      if (suite === "shared" || suite === "duel_unit") {
        const plan = planUnitShards(suite, result.files);
        output[suite + "_shards"] = JSON.stringify(plan.map((_, index) => `${index + 1}/${plan.length}`));
      }
      console.log(`${suite}: selected ${result.files.length} test files\n${result.files.join("\n")}`);
    } else {
      console.log(`${suite}: full suite (${result.reason ?? "no test files reached the changed paths"})`);
    }
  }
  const webShards = Math.min(WEB_FULL_SHARDS, output.web_files ? JSON.parse(output.web_files).length : WEB_FULL_SHARDS);
  output.web_shards = JSON.stringify(Array.from({ length: webShards }, (_, index) => index + 1));
  // Emit all outputs only after graph construction. An unexpected error in any
  // suite leaves the workflow on the original, full-suite defaults.
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(output).map(([key, value]) => `${key}=${value}\n`).join(""));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
