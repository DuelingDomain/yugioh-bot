import { ExpectedError } from "@yugidraft/shared/observability";
import type { DuelErrorCode, ReplayUnverifiedReason } from "@yugidraft/shared/duels";
import type { ReplayBuildErrorCode } from "./replay-builder.js";

export class RequestError extends ExpectedError {
  constructor(message: string, status: number, readonly code?: DuelErrorCode | ReplayBuildErrorCode, readonly finalBoard?: "available" | "none",
    readonly unverified?: { canOpenUnchecked: boolean; reason: ReplayUnverifiedReason }) { super(message, status); }
}
