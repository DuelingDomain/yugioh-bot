import { CORE_PROCESS_CALL_LIMIT } from "./script-errors.js";

export const ENGINE_LOOP_REASON = "Engine loop: the core exceeded its process call limit without a player prompt.";

/** A core invariant failure: replaying the last prompt cannot repair this loop. */
export class EngineLoopError extends Error {
  constructor() {
    super(`Engine exceeded ${CORE_PROCESS_CALL_LIMIT} process calls without a player prompt`);
    this.name = "EngineLoopError";
  }
}
