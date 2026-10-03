import { parentPort } from "node:worker_threads";
import { createEngineGame, type EngineGame } from "./engine.js";
import type { DuelWorkerRequest, DuelWorkerResponse } from "./worker-protocol.js";

let game: EngineGame | null = null;
let queue = Promise.resolve();

/** Every answer carries the core identity and counters, so the host can show them even when a later call hangs. */
export async function handleWorkerRequest(request: DuelWorkerRequest): Promise<DuelWorkerResponse> {
  const response = await runWorkerRequest(request);
  if (response.ok && game) {
    try {
      response.info = game.coreInfo();
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
        game = await createEngineGame(request.options);
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
    return { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

if (parentPort) {
  parentPort.on("message", (request: DuelWorkerRequest) => {
    queue = queue.then(async () => {
      parentPort!.postMessage(await handleWorkerRequest(request));
    });
  });
}
