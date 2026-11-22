import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { changedLayers, selectionOutputs, writeOutputs } from "./changed-layers.mjs";
import { selectEngineFiles } from "./select-engine-tests.mjs";
import { duelTestFiles } from "./duel-test-files.mjs";
import { fullSuiteReason, runtimeDependencies } from "./pr-test-inputs.mjs";
import { areaFor, areaSmokes, hubTest, isDeclaration, isDoc, isHub, sourceFile, testFile, webEngineTest, workspaces } from "./test-areas.mjs";

const packageName = specifier => specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
const repoPath = (root, file) => relative(root, file).split(sep).join("/");
const modulePath = path => path.split("?")[0];
const pos = (node, source) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

const hasOnlyTypeSpecifiers = list => ts.isNamedImports(list) || ts.isNamedExports(list)
  ? list.elements.length > 0 && list.elements.every(element => element.isTypeOnly) : false;
const modifiers = (node, kind) => node.modifiers?.some(modifier => modifier.kind === kind);
const isTypeStatement = node =>
  ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || modifiers(node, ts.SyntaxKind.DeclareKeyword) ||
  ts.isImportDeclaration(node) && (node.importClause?.isTypeOnly ||
    (node.importClause?.namedBindings && !node.importClause.name && hasOnlyTypeSpecifiers(node.importClause.namedBindings))) ||
  ts.isExportDeclaration(node) && (node.isTypeOnly || (node.exportClause && hasOnlyTypeSpecifiers(node.exportClause)));

export function isTypeOnlyEdit(file, before, after) {
  if (isDeclaration(file)) return true;
  if (!/\.[cm]?tsx?$/.test(file) || before === after || before === undefined || after === undefined) return false;
  const parse = text => {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
    if (source.parseDiagnostics.length) return;
    const types = [], runtime = [];
    for (const statement of source.statements) {
      if (isTypeStatement(statement)) {
        types.push(statement.getFullText(source));
        continue;
      }
      const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings
        : ts.isExportDeclaration(statement) ? statement.exportClause : undefined;
      if (bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) {
        types.push(...bindings.elements.filter(item => item.isTypeOnly).map(item => item.getText(source)));
        const values = bindings.elements.filter(item => !item.isTypeOnly).map(item => item.getText(source));
        runtime.push((text.slice(statement.getFullStart(), bindings.getStart(source)) +
          JSON.stringify(values) + text.slice(bindings.end, statement.end)).trim());
      } else {
        runtime.push(statement.getFullText(source).trim());
      }
    }
    return { types: JSON.stringify(types), runtime: JSON.stringify(runtime) };
  };
  const old = parse(before), next = parse(after);
  return !!old && !!next && old.types !== next.types && old.runtime === next.runtime;
}

function moduleReferences(source) {
  const modules = [];
  const paths = [];
  let opaque = false;
  function collect(argument, declaration) {
    if (argument && ts.isStringLiteralLike(argument)) modules.push([argument.text, pos(argument, source), declaration]);
    else opaque = true;
  }

  function visit(node) {
    if (isTypeStatement(node)) return;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) collect(node.moduleSpecifier, node);
    } else if (ts.isExternalModuleReference(node)) {
      collect(node.expression);
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
        if (candidate && ts.isStringLiteralLike(candidate) && sourceFile.test(modulePath(candidate.text))) paths.push(modulePath(candidate.text));
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

// A barrel can re-export dozens of services. Resolve named imports through the
// relevant exports, while keeping the barrel itself as an input for every caller.
const sharedBarrel = /^packages\/shared\/src\/(?:[^/]+\/)*index\.ts$/;
function importedNames(node, names) {
  if (!node) return;
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause || (clause.namedBindings && !ts.isNamedImports(clause.namedBindings))) return;
    return [
      ...(clause.name ? ["default"] : []),
      ...(clause.namedBindings?.elements ?? []).filter(item => !item.isTypeOnly).map(item => (item.propertyName ?? item.name).text),
    ];
  }
  if (!node.exportClause) return names;
  if (ts.isNamedExports(node.exportClause)) {
    return node.exportClause.elements.filter(item => !item.isTypeOnly && (!names || names.includes(item.name.text)))
      .map(item => (item.propertyName ?? item.name).text);
  }
}

export async function selectSuiteFiles({ root, suite, tests, setup = [], changes, existing, route, viteResolve, resolver }) {
  const cwd = resolve(root, "packages", workspaces[suite]);
  const { owned, consumers, hubs } = route ?? { owned: existing ? changes : [], consumers: existing ? [] : changes, hubs: [] };
  const narrowed = [...owned, ...consumers, ...hubs];
  const changesSet = new Set(narrowed);
  const full = (reason, hasHit = false) => ({ files: null, affected: !!(owned.length || hasHit), reason });
  const reason = fullSuiteReason(root, owned);
  const relativeTests = files => [...new Set(files.map(file => repoPath(cwd, file)))].sort();
  const absoluteTests = tests.map(file => resolve(root, file));
  if (reason) {
    if (suite === "shared" && owned.every(file => areaFor(file) === "shared_db")) {
      const dbFiles = absoluteTests.filter(file => areaFor(repoPath(root, file)) === "shared_db");
      return { files: relativeTests(dbFiles), affected: dbFiles.length > 0, reason };
    }
    return full(reason);
  }
  if (!narrowed.length) return { files: [], affected: false };
  if (!tests.length) return owned.length ? full("discovery found no tests in the owning suite") : { files: [], affected: false };
  resolver ??= createResolver(root);

  const importers = new Map();
  const visited = new Set();
  const syntax = new Map();
  const opaque = new Set();
  const problems = new Set();
  const setupPaths = new Set(setup.map(file => resolve(file)));
  const pending = [...absoluteTests, ...setupPaths].map(file => ({ file, key: file }));
  const seeds = new Set();
  const parse = file => {
    if (!syntax.has(file)) {
      const text = readFileSync(file, "utf8");
      syntax.set(file, ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
    }
    return syntax.get(file);
  };
  const exportCache = new Map();
  function ownsExport(file, name, seen = new Set()) {
    if (!file || !isAbsolute(file) || !sourceFile.test(file)) return true;
    if (seen.has(file)) return false;
    const cacheKey = file + "\0" + name;
    if (exportCache.has(cacheKey)) return exportCache.get(cacheKey);
    seen.add(file);
    const match = parse(file).statements.some(node => {
      if (isTypeStatement(node)) return false;
      if (ts.isExportAssignment(node) || modifiers(node, ts.SyntaxKind.DefaultKeyword)) return name === "default";
      if (ts.isExportDeclaration(node)) {
        if (node.exportClause) return ts.isNamedExports(node.exportClause)
          ? node.exportClause.elements.some(item => !item.isTypeOnly && item.name.text === name)
          : node.exportClause.name.text === name;
        return node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier) &&
          ownsExport(resolver.resolveModule(node.moduleSpecifier.text, file), name, new Set(seen));
      }
      if (!modifiers(node, ts.SyntaxKind.ExportKeyword)) return false;
      if (ts.isVariableStatement(node)) {
        return node.declarationList.declarations.some(declaration =>
          !ts.isIdentifier(declaration.name) || declaration.name.text === name);
      }
      return node.name?.text === name;
    });
    if (seen.size === 1) exportCache.set(cacheKey, match);
    return match;
  }

  for (const { file, key, names } of pending) {
    if (visited.has(key)) continue;
    visited.add(key);
    const name = repoPath(root, file);
    if (changesSet.has(name)) seeds.add(key);
    const link = (dependency, picked) => {
      if (!isAbsolute(dependency)) return;
      const path = realpathSync(modulePath(dependency));
      const local = repoPath(root, path);
      if (local.startsWith("../") || local.split("/").includes("node_modules") || isDeclaration(local)) return;
      if (isHub(local)) {
        if (hubs.includes(local) && testFile.test(name) && name.split("/")[1] === local.split("/")[1]) seeds.add(key);
        return;
      }
      const names = picked?.length && sharedBarrel.test(local) ? [...new Set(picked)].sort() : undefined;
      const target = names ? path + "\0" + names.join(",") : path;
      if (changesSet.has(local)) seeds.add(target);
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target).add(key);
      if (sourceFile.test(path)) pending.push({ file: path, key: target, names });
    };
    for (const target of runtimeDependencies[name] ?? []) {
      const path = resolve(root, target);
      if (existsSync(path)) link(path);
      else problems.add(`${name} cannot resolve subprocess input ${target}`);
    }
    const source = parse(file);
    const references = moduleReferences(source);
    if (references.opaque) opaque.add(key);
    if (source.parseDiagnostics.length) problems.add(`could not parse ${name}`);
    for (const [specifier, line, declaration] of references.modules) {
      const picked = importedNames(declaration, names);
      if (picked?.length === 0) continue;
      const path = resolver.resolveModule(specifier, file) ?? await viteResolve?.(specifier, file);
      if (path) {
        // A star re-export with known names can be skipped if it owns none.
        if (names && declaration && ts.isExportDeclaration(declaration) && !declaration.exportClause &&
          !names.some(name => ownsExport(path, name))) continue;
        link(path, picked);
      } else problems.add(`${name}:${line} cannot resolve ${specifier}`);
    }
    for (const specifier of references.paths) {
      const path = resolver.resolvePath(specifier, file);
      if (path) link(path);
      else problems.add(`${name} cannot resolve path ${specifier}`);
    }
  }

  const reachable = new Set([...seeds, ...(owned.length ? opaque : [])]);
  for (const file of reachable) {
    for (const importer of importers.get(file) ?? []) reachable.add(importer);
  }
  // Resolution problems and global setup fall back only in the owning suite.
  // Consumers still receive every positively reached test or setup dependency.
  if (owned.length && problems.size) return full([...problems].join("\n"));
  if ([...setupPaths].some(file => reachable.has(file))) return full("global test setup dependency", true);
  const selected = absoluteTests.filter(file => reachable.has(file) || hubs.some(hub => hubTest(repoPath(root, file), hub)));
  const files = relativeTests(selected);
  if (!files.length && owned.length && route) {
    const smokes = areaSmokes([...new Set(owned.map(file => areaFor(file)).filter(Boolean))]);
    files.push(...(smokes[suite] ?? []));
  }
  return { files, affected: files.length > 0 };
}

function baseSources(root, base = "HEAD^1") {
  // For PRs, compare the synthetic merge commit with its first parent.
  // For main, compare with the same deployed ancestor used for changed paths.
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    const old = new Set(git(["ls-tree", "-r", "--name-only", "-z", base]).split("\0"));
    return file => old.has(file) ? git(["show", `${base}:${file}`]) : "";
  } catch {
    return () => undefined;
  }
}

export async function selectPullRequest(root, files, { readBase = baseSources(root), discover } = {}) {
  const typeOnly = new Set(), webEngineTests = new Set();
  for (const file of files) {
    if (isDoc(file) || !sourceFile.test(file)) continue;
    if (isDeclaration(file)) {
      typeOnly.add(file);
      continue;
    }
    const path = resolve(root, file);
    const before = readBase(file), after = existsSync(path) ? readFileSync(path, "utf8") : "";
    if (isTypeOnlyEdit(file, before, after)) typeOnly.add(file);
    if (webEngineTest(file, before) || webEngineTest(file, after)) webEngineTests.add(file);
  }
  const hasDuelTests = files.some(file => file.startsWith("packages/duel-server/tests/"));
  const inventory = hasDuelTests ? duelTestFiles().engine : undefined;
  const duelEngineTests = inventory && new Set(inventory.map(file => "packages/duel-server/" + file));
  const layers = changedLayers(files, "pull_request", { root, typeOnly, duelEngineTests, webEngineTests });
  if (layers.full) return selectionOutputs(layers);
  const resolver = createResolver(root);
  const results = {};
  for (const [suite, route] of Object.entries(layers.routes)) {
    if (!route.owned.length && !route.consumers.length && !route.hubs.length) continue;
    if (fullSuiteReason(root, route.owned) && (suite !== "shared" || route.owned.some(file => areaFor(file) !== "shared_db"))) {
      results[suite] = { files: null, affected: true };
      continue;
    }
    results[suite] = await (discover ?? withSuiteTests)(root, suite, inputs => selectSuiteFiles({
      root, suite, route, resolver, ...inputs,
    }));
    console.log(`${suite}: ${results[suite].files?.length ?? "all"} files`);
  }
  const output = selectionOutputs(layers, results);
  if (layers.engine_diff.length) {
    const engine = selectEngineFiles(root, layers.engine_diff, inventory ?? duelTestFiles().engine);
    if (engine.files.length || engine.webFiles.length) {
      output.engine_files = JSON.stringify(engine.files);
      output.engine_web_files = JSON.stringify(engine.webFiles);
    }
  }
  return output;
}

async function withSuiteTests(root, suite, select) {
  const cwd = resolve(root, "packages", workspaces[suite]);
  if (suite === "vision") {
    const tests = readdirSync(resolve(cwd, "src")).filter(file => testFile.test(file)).map(file => `packages/vision/src/${file}`);
    return select({ tests });
  }
  const { createVitest } = await import("vitest/node");
  const duel = suite === "duel_unit";
  const vitest = await createVitest("test", {
    root: cwd, watch: false, cache: false,
    ...(duel ? { config: resolve(cwd, "vitest.unit.config.ts") } : {}),
    ...(suite === "web" ? { exclude: [".next/**"] } : {}),
  });
  try {
    const tests = (await vitest.globTestSpecifications(duel ? ["tests"] : []))
      .map(test => repoPath(root, test.moduleId));
    const setup = vitest.projects.flatMap(project => [...project.config.setupFiles, ...project.config.globalSetup]);
    const viteResolve = async (specifier, file) => {
      const resolved = await vitest.vite.environments.ssr.pluginContainer.resolveId(specifier, file);
      return resolved && isAbsolute(resolved.id) && existsSync(modulePath(resolved.id)) ? resolved.id : undefined;
    };
    return await select({ tests, setup, viteResolve });
  } finally {
    await vitest.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const changes = JSON.parse(readFileSync(resolve(process.env.RUNNER_TEMP ?? process.cwd(), "pr-test-diff.json"), "utf8"));
  writeOutputs(await selectPullRequest(root, changes, { readBase: baseSources(root, process.env.BASELINE || undefined) }));
}
