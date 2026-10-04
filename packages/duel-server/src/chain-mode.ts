import { defaultChainMode, type DuelChainMode } from "@yugidraft/shared/duels";

/**
 * The core's `spe_count` of a SELECT_CHAIN window when every listed effect is the duelist's own optional trigger
 * (the "you can" effects of a card that just moved or was summoned). Quick-effect and response windows carry the
 * count of effects that fit their timing, which is 0 or a small number.
 */
export const OPTIONAL_TRIGGER_SPE_COUNT = 0x7f;

/**
 * The description the core puts on the SELECT_EFFECTYN that asks for ONE optional trigger of the duelist
 * (strings.conf `!system 221`, "Activate the Trigger Effect of ..."). Measured on the legacy core and on the stock
 * core of the merged engine (tests/chain-mode-trigger-windows.test.ts): a lone optional trigger is never a
 * SELECT_CHAIN, it is this prompt, whatever description the card gives its own effect. A script's own
 * Duel.SelectEffectYesNo mid-resolution passes its own description (95 by default, 96 for a destruction
 * replacement, a card string otherwise); no script in the bundle passes 221.
 */
export const TRIGGER_EFFECT_YN_DESCRIPTION = 221n;

/**
 * THE rule for "Off" and optional triggers. True: Off passes the seat's own optional triggers like every other
 * optional response, in both shapes the core asks them: a SELECT_CHAIN holding several (spe_count 0x7f) and the
 * SELECT_EFFECTYN of a lone one (description 221). This is what the ignore-chain button of YGOPro does. False: Off
 * still asks at both, so a "you can" effect is never skipped silently. One line to flip; both engines read it here.
 * A mandatory trigger (forced) asks either way, and so do costs and choices inside a resolving effect.
 */
export const OFF_SKIPS_OPTIONAL_TRIGGERS = true;

/**
 * Whether the SELECT_EFFECTYN `window` is answered "no" without asking. Only an optional-trigger prompt, only under
 * Off, and only while OFF_SKIPS_OPTIONAL_TRIGGERS is on. Every other yes/no prompt (an effect asking mid-resolution,
 * a SELECT_YESNO) asks in every mode.
 */
export function effectYesNoPasses(window: { description: bigint }, mode: DuelChainMode): boolean {
  return mode === "off" && OFF_SKIPS_OPTIONAL_TRIGGERS && window.description === TRIGGER_EFFECT_YN_DESCRIPTION;
}

/** What decides a response window: the engine's chain mode of that seat, or the duel-level default of old callers. */
export function effectiveChainMode(options: { chainMode?: DuelChainMode; stopAtEveryWindow?: boolean }): DuelChainMode {
  return options.chainMode ?? defaultChainMode(options);
}

/**
 * Whether a non-empty SELECT_CHAIN window is passed without asking. Windows with no listed card, and a forced
 * single choice, are decided before this (autoResponse). A forced window never passes here.
 * - auto: pass when no listed effect fits the window, except in the Draw and Standby Phase.
 * - always: never pass.
 * - off: pass every optional window, optional triggers included while OFF_SKIPS_OPTIONAL_TRIGGERS is on.
 */
export function chainWindowPasses(
  window: { forced: boolean; spe_count: number },
  mode: DuelChainMode,
  phase: string | undefined,
): boolean {
  if (window.forced) return false;
  switch (mode) {
    case "off":
      return OFF_SKIPS_OPTIONAL_TRIGGERS || window.spe_count !== OPTIONAL_TRIGGER_SPE_COUNT;
    case "auto":
      return window.spe_count === 0 && phase !== "draw" && phase !== "standby";
    case "always":
      return false;
  }
}
