import type { DuelErrorCode } from "@yugidraft/shared/duels";

export class RequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: DuelErrorCode) { super(message); }
}
