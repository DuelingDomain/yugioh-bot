import { existsSync } from "node:fs";
import { join } from "node:path";
import { multiDomainBlockReason, type DuelFormat, type DuelMode } from "@yugidraft/shared/duels";

/** The Domain core for 3 or more seats is in the engine data directory. */
export function multiDomainCoreAvailable(dataDirectory: string): boolean {
  return existsSync(join(dataDirectory, "ocgcore.multi-domain.wasm"));
}

/**
 * A clear message when a Domain table with 3 or more seats cannot start because its core is missing, or null.
 * The host calls this before it opens the worker, so the lobby gets an answer and does not hang.
 */
export function multiDomainStartProblem(mode: DuelMode, format: DuelFormat, dataDirectory: string): string | null {
  if (mode !== "domain" || format === "1v1") return null;
  return multiDomainBlockReason(mode, format, multiDomainCoreAvailable(dataDirectory));
}
