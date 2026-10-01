import type { DuelFormat } from "./settings.js";

/**
 * The Domain core for 3 or more seats (`ocgcore.multi-domain.wasm`) is not shipped yet. While this is false,
 * Domain is offered at 1v1 tables only. Flip it when the core is part of the deploy bundle.
 * The duel server does not read this constant: it checks that the wasm file exists.
 */
export const MULTI_DOMAIN_CORE_READY = false;

export const MULTI_DOMAIN_UNAVAILABLE_MESSAGE =
  "Domain is not available at 3-player, 4-player or Tag tables yet. Pick Standard, or play Domain at a 1v1 table.";

/** A reason why this mode and table type cannot run, or null when they can. */
export function multiDomainBlockReason(
  mode: "normal" | "domain",
  format: DuelFormat | undefined,
  coreReady: boolean = MULTI_DOMAIN_CORE_READY,
): string | null {
  if (mode !== "domain" || format === undefined || format === "1v1") return null;
  return coreReady ? null : MULTI_DOMAIN_UNAVAILABLE_MESSAGE;
}
