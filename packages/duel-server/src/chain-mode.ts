import { defaultChainMode, type DuelChainMode } from "@yugidraft/shared/duels";

/**
 * The description the core puts on the SELECT_EFFECTYN that asks for ONE optional trigger of the duelist
 * (strings.conf `!system 221`, "Activate the Trigger Effect of ..."). Measured on the legacy core, on the stock
 * core of the merged engine and on the multi core (tests/chain-mode-trigger-windows.test.ts): a lone optional trigger
 * is never a SELECT_CHAIN, it is this prompt, whatever description the card gives its own effect. A script's own
 * Duel.SelectEffectYesNo mid-resolution passes its own description (95 by default, 96 for a destruction
 * replacement, a card string otherwise); no script in the bundle passes 221.
 *
 * Several optional triggers at once arrive as an ordinary non-forced SELECT_CHAIN. The `spe_count === 0x7f` that was
 * expected to mark them never appears there (it is the number of listed trigger effects), so Off passes that window
 * like every other optional window, and the rule below does not apply to it.
 */
export const TRIGGER_EFFECT_YN_DESCRIPTION = 221n;

/**
 * THE rule for "Off" and a lone optional trigger. True: Off answers "no" to the yes/no of the seat's own optional
 * trigger, like every other optional response; this is what the ignore-chain button of YGOPro does. False: Off still
 * asks that question, so a "you can" effect is never skipped silently. One line to flip; both engines read it here.
 * Mandatory triggers (forced windows, or no prompt at all), costs and choices inside a resolving effect ask or
 * resolve either way.
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
 * - off: pass every optional window.
 */
export function chainWindowPasses(
  window: { forced: boolean; spe_count: number },
  mode: DuelChainMode,
  phase: string | undefined,
): boolean {
  if (window.forced) return false;
  switch (mode) {
    case "off":
      return true;
    case "auto":
      return window.spe_count === 0 && phase !== "draw" && phase !== "standby";
    case "always":
      return false;
  }
}
