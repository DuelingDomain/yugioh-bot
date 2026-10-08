import { OcgLogType } from "ocgcore-wasm";
import { scriptHelperNames } from "./card-script-hash.js";
import type { DuelEngineChoice, DuelFormat, DuelMode, DuelScriptErrorMode } from "@yugidraft/shared/duels";

export interface CardScriptError {
  code: number;
  scriptFile: string;
  line: number;
  message: string;
  helperScripts?: readonly string[];
}

/** Private telemetry only. Never include these fields in a player view. */
export interface DuelScriptError extends CardScriptError {
  index: number;
  source?: "query";
  /** Number of accepted journal commands before this worker request. */
  journalPosition?: number;
  /** Worker-only digest of saved seed, journal position and attempted command. */
  commandHash?: string;
  mode: DuelMode;
  format: DuelFormat;
  engine: DuelEngineChoice;
  scriptErrorMode: DuelScriptErrorMode;
}

/** Host-only diagnostics. Fatal errors must never enter player views or telemetry counters. */
export interface DuelScriptFatalError {
  message: string;
  traceback: string;
  mode: DuelMode;
  format: DuelFormat;
  engine: DuelEngineChoice;
  scriptErrorMode: DuelScriptErrorMode;
}

export const CARD_SCRIPT_STRICT_ERROR_TEXT = "Card script error (strict mode): an effect may not have resolved correctly.";
export const ENGINE_SCRIPT_ERROR_TEXT = "Engine script error: the duel could not continue.";
export const SCRIPT_ERROR_TELEMETRY_LIMIT = 20;
export const CORE_PROCESS_CALL_LIMIT = 100_000;

export const CARD_SCRIPT_ERROR_TEXT = "Card script error: an effect may not have resolved correctly. The duel will continue.";

export function scriptErrorModeFromEnv(): DuelScriptErrorMode {
  const value = process.env.DUEL_SCRIPT_ERRORS;
  if (value === undefined || value === "" || value === "tolerant") return "tolerant";
  if (value === "strict") return "strict";
  throw new Error("DUEL_SCRIPT_ERRORS must be tolerant or strict");
}

// Lua diagnostics begin with a chunk/file and a line. A mention in arbitrary core text is insufficient.
const diagnostic = /^(?:\[string "([^"\r\n]+)"\]|([^\r\n]+?\.lua)):(\d+):\s*(.+)$/;
const cardFile = /(?:^|[/\\])c([1-9]\d*)\.lua$/;
const fatalDiagnostic = /syntax error|unexpected symbol|unfinished|malformed number|expected.*near|invalid escape sequence|invalid long string delimiter|too many (?:local|upvalue|syntax|C levels)|stack overflow|not enough memory|out of memory|panic|assertion|incorrect parameter count|memory corruption/i;

export function classifyCardScriptError(type: number, text: string, processing: boolean, traceback = ""): CardScriptError | null {
  if (!processing || type !== OcgLogType.ERROR) return null;
  const firstLine = text.split(/\r?\n/, 1)[0]!;
  const match = diagnostic.exec(firstLine);
  if (!match || fatalDiagnostic.test(match[4]!)) return null;
  const scriptFile = match[1] ?? match[2]!;
  let card = cardFile.exec(scriptFile);
  // Helper failures can be attributed only through the immediately preceding core traceback.
  if (!card) {
    if (!/\.lua$/.test(scriptFile) || /^(?:duel-|startup-|scenario-|domain\.lua|mp-utility\.lua)/.test(scriptFile)) return null;
    for (const frame of traceback.matchAll(/(?:\[string "([^"\r\n]+)"\]|([^\s\r\n]+\.lua)):\d+:/g)) {
      card = cardFile.exec(frame[1] ?? frame[2]!);
      if (card) break;
    }
  }
  const code = card ? Number(card[1]) : 0;
  const line = Number(match[3]);
  if (!Number.isSafeInteger(code) || code <= 0 || code > 0xffffffff || !Number.isSafeInteger(line) || line <= 0) return null;
  const helperScripts = scriptHelperNames([scriptFile, ...[...`${text}\n${traceback}`.matchAll(/(?:\[string "([^"\r\n]+)"\]|([^\s\r\n]+\.lua)):\d+:/g)]
    .map(frame => frame[1] ?? frame[2]!)]);
  return { code, scriptFile, line, message: text, ...(helperScripts.length ? { helperScripts } : {}) };
}

/** Keeps fatal diagnostics separate from recoverable runtime card errors on every engine path. */
export function createScriptErrorPolicy(options: {
  mode: DuelMode;
  format?: DuelFormat;
  engine?: DuelEngineChoice;
  scriptErrorMode?: DuelScriptErrorMode;
  onScriptError?: (error: DuelScriptError) => void;
  onFatalScriptError?: (error: DuelScriptFatalError) => void;
}) {
  const scriptErrorMode = options.scriptErrorMode ?? scriptErrorModeFromEnv();
  const errors: string[] = [];
  const pending: DuelScriptError[] = [];
  let index = 0;
  let traceback = "";
  let processing = false;
  let loadDepth = 0;
  let queryLoadDepth: number | null = null;
  const queryCards = new Set<number>();
  const reported = new Map<number, number>();
  return {
    errors,
    /** Queries run a variable number of times in live/recovery/replay. Never add them to events. */
    query<T>(read: () => T, runtimeScript = false): T {
      const previous = queryLoadDepth;
      queryLoadDepth = loadDepth + (runtimeScript ? 1 : 0);
      try { return read(); }
      finally { queryLoadDepth = previous; traceback = ""; }
    },
    enterLoad() { loadDepth++; },
    leaveLoad() { loadDepth--; },
    enterProcess() { processing = true; },
    leaveProcess() { processing = false; traceback = ""; },
    note(type: number, text: string) {
      if (type === OcgLogType.FOR_DEBUG) { traceback = text.startsWith("stack traceback:") ? text : ""; return; }
      if (type !== OcgLogType.ERROR && type !== OcgLogType.UNDEFINED) return;
      const querying = queryLoadDepth !== null;
      const script = classifyCardScriptError(type, text, querying ? loadDepth <= queryLoadDepth! : processing && loadDepth === 0, traceback);
      const fatalTraceback = traceback;
      traceback = "";
      if (!script) {
        errors.push(ENGINE_SCRIPT_ERROR_TEXT);
        options.onFatalScriptError?.({ message: text, traceback: fatalTraceback, mode: options.mode, format: options.format ?? "1v1", engine: options.engine ?? "pinned", scriptErrorMode });
        return;
      }
      if (querying) {
        if (!queryCards.has(script.code)) {
          queryCards.add(script.code);
          options.onScriptError?.({ ...script, source: "query", index: script.code, mode: options.mode, format: options.format ?? "1v1", engine: options.engine ?? "pinned", scriptErrorMode });
        }
        return;
      }
      const error = { ...script, index: ++index, mode: options.mode, format: options.format ?? "1v1", engine: options.engine ?? "pinned", scriptErrorMode };
      if (pending.length === 0) pending.push(error);
      const count = reported.get(script.code) ?? 0;
      if (count < SCRIPT_ERROR_TELEMETRY_LIMIT) {
        reported.set(script.code, count + 1);
        options.onScriptError?.(error);
      }
      if (scriptErrorMode === "strict") errors.push(CARD_SCRIPT_STRICT_ERROR_TEXT);
    },
    drain(): DuelScriptError[] {
      return pending.splice(0);
    },
  };
}
