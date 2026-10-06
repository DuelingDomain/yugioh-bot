/** Signed web-to-host sandbox operation names. */
export const SANDBOX_OPS = {
  validate: "validate-board",
  start: "start-sandbox",
  control: "sandbox-control",
  restart: "sandbox-restart",
  info: "sandbox-info",
  phase: "sandbox-phase",
  nextTurn: "sandbox-next-turn",
} as const;
export type SandboxHostOp = typeof SANDBOX_OPS[keyof typeof SANDBOX_OPS];
