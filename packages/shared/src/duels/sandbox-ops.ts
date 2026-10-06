import type { SandboxBoard, SandboxRun } from "./sandbox-board.js";

/** Signed web-to-host sandbox operation names. */
export const SANDBOX_OPS = {
  validate: "validate-board",
  start: "start-sandbox",
  control: "sandbox-control",
  restart: "sandbox-restart",
  info: "sandbox-info",
  phase: "sandbox-phase",
  nextTurn: "sandbox-next-turn",
  eliminate: "sandbox-eliminate",
  snapshot: "sandbox-snapshot",
  close: "sandbox-close",
} as const;
export type SandboxHostOp = typeof SANDBOX_OPS[keyof typeof SANDBOX_OPS];

/** Captured live state. lost describes engine state that the scenario cannot restore. */
export interface SandboxSnapshotResult {
  board: SandboxBoard;
  run: SandboxRun;
  lost: string[];
}
