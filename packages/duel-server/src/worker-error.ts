import { EngineLoopError } from "./engine-loop-error.js";
import { EngineResourceUnavailableError } from "./engine-resource-resolver.js";
import { EngineAnswerError } from "./prompts.js";
import { ReplayBuildError } from "./replay-builder.js";
import type { DuelWorkerResponse } from "./worker-protocol.js";

/** Shared by the message transport and the in-thread replay adapter. */
export function workerResponseError(message: Extract<DuelWorkerResponse, { ok: false }>): Error {
  const error = message.replayError
    ? new ReplayBuildError(message.message ?? message.error, message.replayError.code, message.replayError.familyFailed)
    : message.code === "ENGINE_UNAVAILABLE_FOR_SOURCE"
    ? new EngineResourceUnavailableError("the worker cannot use the recorded engine resources")
    : message.engineLoop ? new EngineLoopError() : message.answerError || message.code
    ? new EngineAnswerError(message.message ?? message.error, message.code)
    : new Error(message.message ?? message.error ?? "Engine rejected the request");
  if (message.name) error.name = message.name;
  if (message.stack) error.stack = message.stack;
  return error;
}
