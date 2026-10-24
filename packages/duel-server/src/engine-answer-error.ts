import type { DuelErrorCode } from "@yugidraft/shared/duels";

export class EngineAnswerError extends Error {
  constructor(message: string, readonly code?: DuelErrorCode) {
    super(message);
    this.name = "EngineAnswerError";
  }
}
