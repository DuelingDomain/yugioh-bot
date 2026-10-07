import { parentPort } from "node:worker_threads";
import { createEngineGame, type EngineGame } from "./engine.js";
import { createLegacyEngineGame } from "./legacy/index.js";
import type { DuelWorkerRequest, DuelWorkerResponse } from "./worker-protocol.js";
import { seatCountFor } from "@yugidraft/shared/duels";
import { tracePrompt } from "./prompt-trace.js";
import { EngineAnswerError } from "./prompts.js";

let game: EngineGame | null = null;
let queue = Promise.resolve();
let traceSeats = 0;

/** Every answer carries the core identity and counters, so the host can show them even when a later call hangs. */
export async function handleWorkerRequest(request: DuelWorkerRequest): Promise<DuelWorkerResponse> {
  const response = await runWorkerRequest(request);
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
  return response;
}

async function runWorkerRequest(request: DuelWorkerRequest): Promise<DuelWorkerResponse> {
  try {
    switch (request.op) {
      case "create": {
        if (game) return { id: request.id, ok: false, error: "A game is already running in this worker" };
        // The legacy engine plays two-seat tables only; every other table uses the merged engine and its multi core.
        const legacy = request.options.engine === "legacy" && (request.options.format ?? "1v1") === "1v1";
        game = await (legacy ? createLegacyEngineGame : createEngineGame)(request.options);
        traceSeats = process.env.DUEL_SCENARIOS === "1" && (request.options.format ?? "1v1") !== "1v1"
          ? seatCountFor(request.options.format!) : 0;
        return { id: request.id, ok: true };
      }
      case "view": {
        if (!game) return { id: request.id, ok: false, error: "No game" };
        return { id: request.id, ok: true, value: game.view(request.seat) };
      }
      case "answer": {
        if (!game) return { id: request.id, ok: false, error: "No game" };
        game.answer(request.seat, request.promptId, request.answer);
        return { id: request.id, ok: true };
      }
      case "search": {
        if (!game) return { id: request.id, ok: false, error: "No game" };
        return { id: request.id, ok: true, value: game.searchCards(request.query) };
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
      ...(error instanceof EngineAnswerError && error.code ? { code: error.code } : {}) };
  }
}

if (parentPort) {
  parentPort.on("message", (request: DuelWorkerRequest) => {
    queue = queue.then(async () => {
      parentPort!.postMessage(await handleWorkerRequest(request));
    });
  });
}
