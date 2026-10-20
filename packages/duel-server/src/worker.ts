import { runReplayInWorker } from "./replay-worker.js";
import { ReplayBuildError } from "./replay-builder.js";
import { createHash } from "node:crypto";
import type { DuelScriptError, DuelScriptFatalError } from "./script-errors.js";
import { parentPort } from "node:worker_threads";
import { createEngineGame, type EngineGame } from "./engine.js";
import { createLegacyEngineGame } from "./legacy/index.js";
import type { DuelWorkerRequest, DuelWorkerResponse } from "./worker-protocol.js";
import { seatCountFor } from "@yugidraft/shared/duels";
import { tracePrompt } from "./prompt-trace.js";
import { EngineAnswerError } from "./prompts.js";
import { EngineLoopError } from "./engine-loop-error.js";
import { EngineResourceUnavailableError, verifyWorkerEngineIdentity } from "./engine-resource-resolver.js";
import { loadCardDatabase } from "./cards.js";

let game: EngineGame | null = null;
let queue = Promise.resolve();
let traceSeats = 0;
const scriptErrors: DuelScriptError[] = [];
const fatalScriptErrors: DuelScriptFatalError[] = [];
let creationIdentity = "start";
let journalPosition = 0;
let manualLossAnswersAfter: number | null = null;

function canonicalCommand(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalCommand);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonicalCommand(entry)]));
}

function commandIdentity(request: DuelWorkerRequest): string {
  // A saved seed identifies creation across recovery; failed new starts use a fresh seed.
  // Count accepted journal commands instead of hashing their transport representation.
  const { id: _id, ...command } = request;
  const value = request.op === "create" ? { op: "create", seed: request.options.seed }
    : request.op === "eliminate" ? { ...command, atTurnEnd: request.atTurnEnd ?? false } : command;
  const prefix = request.op === "create" ? "start" : `${creationIdentity}:${journalPosition}`;
  return createHash("sha256").update(prefix).update("\n").update(JSON.stringify(canonicalCommand(value))).digest("hex");
}

/** Every answer carries the core identity and counters, so the host can show them even when a later call hangs. */
export async function handleWorkerRequest(request: DuelWorkerRequest): Promise<DuelWorkerResponse> {
  const mutation = ["create", "answer", "eliminate", "chain-mode"].includes(request.op);
  const position = request.op === "create" ? 0 : journalPosition;
  const commandHash = mutation ? commandIdentity(request) : creationIdentity;
  const response = await runWorkerRequest(request);
  if (mutation && response.ok) {
    if (request.op === "create") { creationIdentity = commandHash; journalPosition = 0; }
    else journalPosition++;
    if (manualLossAnswersAfter !== null && journalPosition >= manualLossAnswersAfter) game?.setManualLossAnswers?.(true);
  }
  if (request.op === "close") { creationIdentity = "start"; journalPosition = 0; traceSeats = 0; manualLossAnswersAfter = null; }
  if (response.ok && game) {
    try {
      response.info = game.coreInfo();
      // Capture the next issued prompt before the host can answer it. No rule state is changed.
      if (traceSeats > 0 && ["create", "answer", "eliminate", "chain-mode"].includes(request.op)) {
        for (let seat = 0; seat < traceSeats; seat += 1) {
          const entry = tracePrompt(game.view(seat));
          if (entry) { response.promptTrace = entry; break; }
        }
      }
    } catch {
      // The game closed while answering.
    }
  }
  // Include queries performed by prompt tracing in the same response, without process ordinals.
  let ordinal = 0;
  if (scriptErrors.length) response.scriptErrors = scriptErrors.splice(0).map(error => error.source === "query"
    ? { ...error, index: error.code, commandHash: "query" }
    : { ...error, journalPosition: position, index: ++ordinal, commandHash });
  if (fatalScriptErrors.length) response.fatalScriptErrors = fatalScriptErrors.splice(0);
  return response;
}

async function runWorkerRequest(request: DuelWorkerRequest): Promise<DuelWorkerResponse> {
  try {
    switch (request.op) {
      case "replay": {
        return { id: request.id, ok: true, value: await runReplayInWorker(request.options, handleWorkerRequest) };
      }
      case "create": {
        if (game) return { id: request.id, ok: false, error: "A game is already running in this worker" };
        const boundary = request.options.manualLossAnswersAfter;
        if (boundary !== undefined && (!Number.isSafeInteger(boundary) || boundary < 0)) {
          return { id: request.id, ok: false, error: "Invalid fork control boundary" };
        }
        manualLossAnswersAfter = boundary ?? null;
        if (request.options.engineIdentity) {
          verifyWorkerEngineIdentity(request.options.dataDirectory, request.options, request.options.engineIdentity);
        }
        // The legacy engine plays two-seat tables only; every other table uses the merged engine and its multi core.
        const legacy = request.options.engine === "legacy" && (request.options.format ?? "1v1") === "1v1";
        const cardsAt = performance.now();
        // Both engine factories reuse this thread's catalog cache. Time its cold load separately.
        loadCardDatabase(request.options.dataDirectory);
        const cardDbLoadMs = performance.now() - cardsAt;
        const engineAt = performance.now();
        game = await (legacy ? createLegacyEngineGame : createEngineGame)({ ...request.options,
          onScriptError: (error) => scriptErrors.push(error), onFatalScriptError: (error) => fatalScriptErrors.push(error) });
        const engineCreateMs = performance.now() - engineAt;
        traceSeats = process.env.DUEL_SCENARIOS === "1" && (request.options.format ?? "1v1") !== "1v1"
          ? seatCountFor(request.options.format!) : 0;
        return { id: request.id, ok: true, createTimings: { cardDbLoadMs, engineCreateMs } };
      }
      case "warm": {
        // Both engine factories reuse this thread's catalog cache: a spare thread pays the load before the game exists.
        loadCardDatabase(request.dataDirectory);
        return { id: request.id, ok: true };
      }
      case "view": {
        if (!game) return { id: request.id, ok: false, error: "No game" };
        return { id: request.id, ok: true, value: game.view(request.seat, request.history) };
      }
      case "answer": {
        if (!game) return { id: request.id, ok: false, error: "No game" };
        game.answer(request.seat, request.promptId, request.answer);
        return { id: request.id, ok: true };
      }
      case "search": {
        if (!game) return { id: request.id, ok: false, error: "No game" };
        return { id: request.id, ok: true, value: game.searchCards(request.query, request.seat) };
      }
      case "eliminate": {
        if (!game) return { id: request.id, ok: false, error: "No game" };
        game.eliminate(request.seat, request.reason, request.atTurnEnd);
        return { id: request.id, ok: true };
      }
      case "chain-mode": {
        if (!game) return { id: request.id, ok: false, error: "No game" };
        return { id: request.id, ok: true, value: game.setChainMode(request.seat, request.mode) };
      }
      case "sandbox-snapshot": {
        if (!game) return { id: request.id, ok: false, error: "No game" };
        if (!game.sandboxSnapshot) throw new Error("This engine cannot capture a sandbox snapshot");
        return { id: request.id, ok: true, value: game.sandboxSnapshot() };
      }
      case "diagnostics": {
        if (!game) return { id: request.id, ok: false, error: "No game" };
        return { id: request.id, ok: true, value: game.diagnostics() };
      }
      case "close": {
        game?.close();
        game = null;
        return { id: request.id, ok: true };
      }
      default:
        return { id: (request as DuelWorkerRequest).id, ok: false, error: "Unknown op" };
    }
  } catch (error) {
    return { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error),
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error ? { name: error.name, stack: error.stack } : {}),
      ...(error instanceof ReplayBuildError ? { replayError: { code: error.code, familyFailed: error.familyFailed } } : {}),
      ...(error instanceof EngineResourceUnavailableError ? { code: error.code } : {}),
      ...(error instanceof EngineLoopError ? { engineLoop: true as const } : {}),
      ...(error instanceof EngineAnswerError ? { answerError: true as const, ...(error.code ? { code: error.code } : {}) } : {}) };
  }
}

if (parentPort) {
  parentPort.on("message", (request: DuelWorkerRequest) => {
    queue = queue.then(async () => {
      parentPort!.postMessage(await handleWorkerRequest(request));
    });
  });
}
