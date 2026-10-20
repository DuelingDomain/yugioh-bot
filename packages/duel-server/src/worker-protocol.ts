import type { SandboxEngineSnapshot } from "./sandbox-snapshot.js";
import type { ReplayWorkerOptions, ReplayWorkerResult } from "./replay-worker.js";
import type { ReplayBuildErrorCode } from "./replay-builder.js";
import type { DuelScriptError, DuelScriptFatalError } from "./script-errors.js";
import type { EngineViewHistory, EngineCoreInfo, EngineDiagnostic, EngineStartupScript } from "./engine.js";
import type { PromptTraceEntry } from "./prompt-trace.js";
import type { DuelAnswer, DuelCardInfo, DuelChainMode, DuelDeck, DuelEngineChoice, DuelEngineView, DuelErrorCode, DuelFormat, DuelMasterRule, DuelMode, DuelSettings, DuelScriptErrorMode, EngineIdentity } from "@yugidraft/shared/duels";

/** Bump when worker transport, command decoding or prompt semantics change. */
export const ENGINE_PROTOCOL_VERSION = "duel-worker-2";

export interface DuelWorkerCreateOptions {
  /** Server-owned fork prefix count; never taken from an ordinary create request. */
  manualLossAnswersAfter?: number;
  engineIdentity?: EngineIdentity;
  scriptErrorMode?: DuelScriptErrorMode;
  mode: DuelMode;
  decks: DuelDeck[];
  seed: string[];
  dataDirectory: string;
  masterRule?: DuelMasterRule;
  /** Saved creation rules, including settings.genesys for field geometry; omission keeps the historical layout. */
  settings?: DuelSettings;
  /** Seat and team layout; `decks` holds one deck per seat. Default `1v1`. */
  format?: DuelFormat;
  /** Original saved draw rule for recovery and replay. */
  firstTurnDraw?: boolean;
  /** Server-selected exact overlay; never a path supplied by a browser. */
  multiScriptsDirectory?: string;
  /** Lua chunks that run before the duel starts (hand scenarios). */
  startupScripts?: EngineStartupScript[];
  /**
   * The engine for a 1v1 table: `legacy` (main's engine, the default of the host) or `pinned` (the merged engine).
   * Absent means `pinned`, so existing callers (tests, scripts) keep the merged engine. Tables with more than
   * two seats ignore it and always use the multi-duelist core.
   */
  engine?: DuelEngineChoice;
}

export interface WorkerCreateTimings {
  cardDbLoadMs: number;
  engineCreateMs: number;
}

export type DuelWorkerRequest =
  | { id: number; op: "replay"; options: ReplayWorkerOptions }
  | { id: number; op: "create"; options: DuelWorkerCreateOptions }
  | { id: number; op: "view"; seat: number | null; history?: EngineViewHistory }
  | { id: number; op: "answer"; seat: number; promptId: string; answer: DuelAnswer }
  | { id: number; op: "search"; query: string; seat?: number }
  | { id: number; op: "eliminate"; seat: number; reason: number; atTurnEnd?: boolean }
  | { id: number; op: "chain-mode"; seat: number; mode: DuelChainMode }
  | { id: number; op: "sandbox-snapshot" }
  | { id: number; op: "diagnostics" }
  /** Load the card data into this thread ahead of a create. Changes no game state. */
  | { id: number; op: "warm"; dataDirectory: string }
  | { id: number; op: "close" };

export type DuelWorkerResponse =
  | { id: number; ok: true; value?: SandboxEngineSnapshot | ReplayWorkerResult | DuelEngineView | DuelCardInfo[] | EngineDiagnostic[] | boolean; createTimings?: WorkerCreateTimings; info?: EngineCoreInfo; promptTrace?: PromptTraceEntry; scriptErrors?: DuelScriptError[]; fatalScriptErrors?: DuelScriptFatalError[] }
  | { id: number; ok: false; replayError?: { code: ReplayBuildErrorCode; familyFailed: boolean; diagnostic?: { message: string; name: string; stack?: string } }; error: string; message?: string; name?: string; stack?: string; answerError?: true; engineLoop?: true; code?: DuelErrorCode | "ENGINE_UNAVAILABLE_FOR_SOURCE"; scriptErrors?: DuelScriptError[]; fatalScriptErrors?: DuelScriptFatalError[] };
