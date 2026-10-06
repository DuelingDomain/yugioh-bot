import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import createCore, { OcgDuelMode, OcgLocation, OcgLogType, OcgPosition, OcgType, type OcgCoreSync, type OcgDuelHandle } from "ocgcore-wasm";
import { isOptionalCardScript, loadCardDatabase, type CardDatabase } from "../src/cards.js";

export interface EngineDataProbeResult {
  errors: string[];
  scriptsChecked: number;
  apiSymbolsChecked: number;
  globalsChecked: number;
  cardsChecked: number;
}

/** Remove Lua comments and literals before looking for symbol references. */
function luaCode(source: string): string {
  // A single pass matters: comment delimiters inside strings (and vice versa) are inert.
  return source.replace(/--\[(=*)\[[\s\S]*?\]\1\]|--[^\r\n]*|\[(=*)\[[\s\S]*?\]\2\]|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g, " ");
}

function referencedSymbols(source: string): { apis: Set<string>; globals: Set<string> } {
  const code = luaCode(source);
  const apis = new Set(Array.from(code.matchAll(/\b(Duel|Card|Effect|Group)\s*[.:]\s*([A-Za-z_]\w*)/g), (match) => `${match[1]}.${match[2]}`));
  const tokens = code.match(/[A-Za-z_]\w*|[^\s]/g) ?? [];
  const locals = new Set<string>();
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index] === "local") {
      let next = index + 1;
      if (tokens[next] === "function") next++;
      while (/^[A-Za-z_]\w*$/.test(tokens[next] ?? "")) {
        locals.add(tokens[next++]);
        if (tokens[next++] !== ",") break;
      }
    }
    if (tokens[index] === "function") {
      let next = index + 1;
      while (next < tokens.length && tokens[next] !== "(") next++;
      while (++next < tokens.length && tokens[next] !== ")") locals.add(tokens[next]);
    }
  }
  const globals = new Set(tokens.filter((token, index) => /^[A-Z][A-Z0-9_]*$/.test(token)
    && !locals.has(token) && tokens[index - 1] !== "." && tokens[index - 1] !== ":"
    && !(tokens[index + 1] === "=" && tokens[index + 2] !== "=")));
  return { apis, globals };
}

/**
 * Advisory runtime check against the npm core used by production Standard 1v1.
 * No optional Domain wasm or core checkout is needed. It checks symbol availability,
 * script loading, and card initialization; it does not play out effect callbacks.
 */
async function probeInProcess(dataDirectory: string, changedPaths: string[]): Promise<EngineDataProbeResult> {
  const report: EngineDataProbeResult = { errors: [], scriptsChecked: 0, apiSymbolsChecked: 0, globalsChecked: 0, cardsChecked: 0 };
  let cards: CardDatabase | undefined;
  let lib: OcgCoreSync | undefined;
  let handle: OcgDuelHandle | undefined;
  let context = "probe setup";
  const record = (message: string) => report.errors.push(`${context}: ${message}`);
  const attempt = (name: string, action: () => void) => {
    context = name;
    try { action(); } catch (error) { record(error instanceof Error ? error.message : String(error)); }
  };
  try {
    cards = loadCardDatabase(dataDirectory);
    const database = cards;
    const scriptRoot = resolve(dataDirectory, "card-scripts");
    const changed = [...new Set(changedPaths.map((path) => path.replaceAll("\\", "/")))].filter((path) => path.endsWith(".lua"));
    const changedOfficialSources = new Map<string, string>();
    // The general database indexes duplicate basenames too (e.g. pre-errata).
    // Make changed official scripts authoritative during native initialization,
    // including when another card loads one as a dependency first.
    for (const path of changed.filter((path) => /^official\/c\d+\.lua$/.test(path))) {
      attempt(path, () => {
        const source = readFileSync(resolve(scriptRoot, path), "utf8");
        changedOfficialSources.set(path, source);
        changedOfficialSources.set(basename(path), source);
      });
    }
    context = "probe setup";
    // Deliberately omit wasmBinary: this is the oldest production Standard core,
    // not whichever optional multiplayer/Domain core happens to be on disk.
    lib = await createCore({ sync: true });
    const core = lib;
    const team = { startingLP: 8000, startingDrawCount: 0, drawCountPerTurn: 0 };
    handle = core.createDuel({
      flags: OcgDuelMode.MODE_MR5,
      seed: [1n, 2n, 3n, 4n],
      team1: team,
      team2: team,
      cardReader: (code) => database.cardData(code),
      scriptReader: (name) => {
        try {
          const source = changedOfficialSources.get(name) ?? database.readScript(name);
          if (source === null && !isOptionalCardScript(name, database.cardData)) record(`Missing script ${name}`);
          return source;
        } catch (error) { record(String(error)); return null; }
      },
      errorHandler: (type, message) => {
        if (type === OcgLogType.ERROR || type === OcgLogType.UNDEFINED) record(message);
      },
    }) ?? undefined;
    if (!handle) throw new Error("Failed to create the Standard 1v1 probe duel");
    const duel = handle;
    let sequence = 0;
    const load = (name: string, source: string) => {
      const before = report.errors.length;
      if (!core.loadScript(duel, name, source) && report.errors.length === before) record(`Failed to load ${name}`);
    };
    for (const name of ["constant.lua", "utility.lua"]) {
      attempt(name, () => {
        const source = database.readScript(name);
        if (source === null) throw new Error(`Required script missing: ${name}`);
        report.scriptsChecked++;
        load(name, source);
      });
    }
    const apis = new Map<string, Set<string>>();
    const globals = new Map<string, Set<string>>();
    // Helpers first, then cards. utility.lua can load its own prerequisites via scriptReader.
    changed.sort((a, b) => Number(/^official\/c\d+\.lua$/.test(a)) - Number(/^official\/c\d+\.lua$/.test(b)) || a.localeCompare(b));
    for (const path of changed) {
      attempt(path, () => {
        const full = resolve(scriptRoot, path);
        const inside = relative(scriptRoot, full);
        if (inside.startsWith("..") || resolve(full) === scriptRoot) throw new Error(`Script path outside candidate directory: ${path}`);
        const source = readFileSync(full, "utf8");
        const symbols = referencedSymbols(source);
        for (const [names, collected] of [[symbols.apis, apis], [symbols.globals, globals]] as const) {
          for (const name of names) {
            const paths = collected.get(name) ?? new Set<string>();
            paths.add(path);
            collected.set(name, paths);
          }
        }
        const official = /^official\/c(\d+)\.lua$/.exec(path);
        if (official) {
          const code = Number(official[1]);
          attempt(`${path} (initial_effect)`, () => {
            const data = database.cardData(code);
            if (!data) throw new Error(`Card ${code} is missing from candidate cards.cdb`);
            report.cardsChecked++;
            // Native loading establishes the card metatable and GetID context,
            // then immediately invokes initial_effect without a process loop.
            const extra = (data.type & (OcgType.FUSION | OcgType.SYNCHRO | OcgType.XYZ | OcgType.LINK)) !== 0;
            core.duelNewCard(duel, { code, team: 0, duelist: 0, controller: 0, location: extra ? OcgLocation.EXTRA : OcgLocation.DECK, sequence: 0, position: OcgPosition.FACEDOWN_DEFENSE });
          });
          context = path;
        }
        if (path === "constant.lua" || path === "utility.lua") return;
        const card = /^c(\d+)\.lua$/.exec(basename(path));
        if (card) load(`compatibility-card-table-${sequence++}.lua`, `c${card[1]}=c${card[1]} or {}; self_table=c${card[1]}; self_code=${card[1]}`);
        report.scriptsChecked++;
        load(card ? basename(path) : path, source);
      });
    }
    // Separate chunks ensure every missing name reaches errorHandler instead of
    // the first missing name aborting a combined assertion chunk.
    for (const [symbol, paths] of apis) {
      attempt(`${[...paths].join(", ")} (API probe)`, () => {
        report.apiSymbolsChecked++;
        load(`compatibility-api-${sequence++}.lua`, `if type(${symbol})~="function" then error("Missing API ${symbol}") end`);
      });
    }
    for (const [symbol, paths] of globals) {
      attempt(`${[...paths].join(", ")} (global probe)`, () => {
        report.globalsChecked++;
        load(`compatibility-global-${sequence++}.lua`, `if _G["${symbol}"]==nil then error("Missing global ${symbol}") end`);
      });
    }
  } catch (error) {
    record(error instanceof Error ? error.message : String(error));
  } finally {
    if (lib && handle) attempt("probe cleanup", () => lib!.destroyDuel(handle!));
    if (cards) attempt("database cleanup", () => cards!.close());
  }
  report.errors = [...new Set(report.errors)];
  return report;
}

/** Isolate synchronous wasm/Lua work so even an infinite script is advisory. */
export async function probeEngineData(
  dataDirectory: string,
  changedPaths: string[],
  options: { timeoutMs?: number } = {},
): Promise<EngineDataProbeResult> {
  const failed = (message: string): EngineDataProbeResult => ({ errors: [message], scriptsChecked: 0, apiSymbolsChecked: 0, globalsChecked: 0, cardsChecked: 0 });
  return new Promise((resolveReport) => {
    let child: ReturnType<typeof fork>;
    try {
      child = fork(fileURLToPath(import.meta.url), ["--engine-data-probe-worker"], {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
    } catch (error) { resolveReport(failed(`Probe process failed: ${String(error)}`)); return; }
    let finished = false;
    let diagnostics = "";
    const finish = (result: EngineDataProbeResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      resolveReport(result);
    };
    const timeoutMs = options.timeoutMs ?? 60_000;
    const timer = setTimeout(() => finish(failed(`Standard 1v1 compatibility probe timed out after ${timeoutMs}ms; candidate scripts may hang during loading or initial_effect.`)), timeoutMs);
    child.stdout?.resume();
    child.stderr?.on("data", (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-4_000); });
    child.once("error", (error) => finish(failed(`Probe process failed: ${error.message}`)));
    child.once("exit", (code, signal) => finish(failed(`Probe process exited before returning findings (${signal ?? code})${diagnostics ? `: ${diagnostics.trim()}` : ""}`)));
    child.once("message", (message: EngineDataProbeResult) => finish(message));
    child.send({ dataDirectory: resolve(dataDirectory), changedPaths }, (error) => {
      if (error) finish(failed(`Probe process communication failed: ${error.message}`));
    });
  });
}

if (process.argv[2] === "--engine-data-probe-worker" && process.send) {
  process.once("message", async ({ dataDirectory, changedPaths }: { dataDirectory: string; changedPaths: string[] }) => {
    const result = await probeInProcess(dataDirectory, changedPaths);
    process.send?.(result, () => process.disconnect?.());
  });
}
