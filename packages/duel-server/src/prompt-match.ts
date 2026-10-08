import type { DuelPrompt, DuelPromptOption } from "@yugidraft/shared/duels";

/** Location bits of the core, by the names scripted players and scenarios use. */
export const LOCATION_BITS = { hand: 0x02, mzone: 0x04, szone: 0x08, grave: 0x10, banished: 0x20, deck: 0x01, extra: 0x40, overlay: 0x80, dmz: 0x4000 } as const;
export type LocationName = keyof typeof LOCATION_BITS;

/** Picks one card option of a prompt. The card is a passcode and the owner a seat number. */
export interface PromptSel {
  code: number;
  /** Seat that controls the card. Default: any. */
  owner?: number;
  from?: LocationName;
  /** Sequence (zone index) of the card. */
  seq?: number;
  /** Pick the nth match (0-based) when several options match. */
  nth?: number;
  /** Substring of the option text, to choose between effects of one card. */
  effect?: string;
}

/** Does this option show the card that the selector names? */
export function matchesSel(option: DuelPromptOption, sel: PromptSel): boolean {
  const card = option.card;
  if (!card) return false;
  if (card.code !== sel.code) return false;
  if (sel.owner != null && option.controller !== sel.owner) return false;
  if (sel.from && option.location != null && (option.location & LOCATION_BITS[sel.from]) === 0) return false;
  if (sel.seq != null && option.sequence !== sel.seq) return false;
  if (sel.effect && !`${option.label} ${option.effectText ?? ""}`.toLowerCase().includes(sel.effect.toLowerCase())) return false;
  return true;
}

/** Options of a prompt that match a selector and one of the id prefixes. */
export function candidates(
  prompt: DuelPrompt,
  prefixes: string[],
  sel: PromptSel,
  extra?: (option: DuelPromptOption) => boolean,
): DuelPromptOption[] {
  return prompt.options.filter(
    (option) => prefixes.some((prefix) => option.id.startsWith(prefix)) && matchesSel(option, sel) && (!extra || extra(option)),
  );
}

export type PickResult = { option: DuelPromptOption } | { error: string };

/**
 * One option out of the candidates. Fails (as a value) when none match, when `nth` is out of range, or when
 * several different cards match and the selector does not tell them apart.
 * `describe` is the text of the selector in messages (default: JSON of the selector).
 */
export function pickOne(options: DuelPromptOption[], sel: PromptSel, what: string, describe: string = JSON.stringify(sel)): PickResult {
  if (options.length === 0) return { error: `No legal option matches ${what} ${describe}.` };
  if (sel.nth != null) {
    const option = options[sel.nth];
    if (!option) return { error: `nth ${sel.nth} is out of range: ${options.length} option(s) match ${describe}.` };
    return { option };
  }
  if (options.length > 1 && new Set(options.map((option) => option.label)).size > 1) {
    return {
      error: `${options.length} options match ${what} ${describe}. Add nth, owner, from, seq or effect.\nMatching: ${options.map((option) => `${option.id} "${option.label}"`).join("; ")}`,
    };
  }
  return { option: options[0] };
}
