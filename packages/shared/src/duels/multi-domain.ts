import type { DuelFormat } from "./settings.js";

/**
 * Safe default until the host confirms that ocgcore.multi-domain.wasm is present.
 * A client must use the host's core status. A build constant cannot describe the installed bundle.
 */
export const MULTI_DOMAIN_CORE_READY = false;

export const MULTI_DOMAIN_UNAVAILABLE_MESSAGE =
  "The Domain core for 3 or more seats is missing on this server. Pick Standard, or play Domain at a 1v1 table.";

export interface DuelTableCapabilities {
  multiplayerTables: boolean;
  multiDomainCoreReady: boolean;
}

export function multiplayerTableBlockReason(format: DuelFormat, enabled: boolean): string | null {
  return format !== "1v1" && !enabled ? "Tables with 3 or more seats are disabled on this server." : null;
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
