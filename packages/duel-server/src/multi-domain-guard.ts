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

/** The plain multi core (Standard at Tag and 3 and 4 seats) is in the engine data directory. */
export function multiCoreFileAvailable(dataDirectory: string): boolean {
  return existsSync(join(dataDirectory, "ocgcore.multi.wasm"));
}

export const MULTI_CORE_MISSING_MESSAGE =
  "Tag and 3-player or 4-player tables are not available on this server right now: the multi-duelist engine core is not installed. Play a 1v1 table, or ask the server owner.";

/**
 * A clear message when a table with 3 or more seats (or Tag) cannot start because a core file is missing, or null.
 * A 1v1 table never needs the multi core, so it never gets a message here. The host calls this before it opens the
 * worker: without it the worker would fail with a raw file path in the message.
 */
export function multiStartProblem(mode: DuelMode, format: DuelFormat, dataDirectory: string): string | null {
  if (format === "1v1") return null;
  if (!multiCoreFileAvailable(dataDirectory)) return MULTI_CORE_MISSING_MESSAGE;
  return multiDomainStartProblem(mode, format, dataDirectory);
}
