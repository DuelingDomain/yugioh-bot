import type { DuelFormat } from "./settings.js";

/**
 * Safe default until the host confirms that ocgcore.multi-domain.wasm is present.
 * A client must use the host's core status. A build constant cannot describe the installed bundle.
 */
export const MULTI_DOMAIN_CORE_READY = false;

/** Shared web and host error for a missing multi core; both return HTTP 409. */
export const MULTI_CORE_UNAVAILABLE_MESSAGE =
  "The core for Tag, 3-player and 4-player tables is missing on this server. Play a 1v1 table.";

export const MULTI_DOMAIN_UNAVAILABLE_MESSAGE =
  "The Domain core for 3 or more seats is missing on this server. Pick Standard, or play Domain at a 1v1 table.";

export interface DuelTableCapabilities {
  multiplayerTables: boolean;
  multiCoreReady: boolean;
  multiDomainCoreReady: boolean;
}

/** A reason why this mode and table type cannot run, or null when they can. */
export function multiDomainBlockReason(
  mode: "normal" | "domain",
  format: DuelFormat | undefined,
  coreReady: boolean = MULTI_DOMAIN_CORE_READY,
): string | null {
  if (mode !== "domain" || format === undefined || format === "1v1") return null;
  return coreReady ? null : MULTI_DOMAIN_UNAVAILABLE_MESSAGE;
}
