import type { DuelAnswer, DuelCardInfo, DuelEngineView, DuelPrompt, DuelPromptOption } from "@yugidraft/shared/duels";
import { botTableOf, choosePracticeBotAnswer, chooseSeatOption, isSeatPick, type BotTable } from "./practice-bot.js";
import { candidates, pickOne, type PromptSel } from "./prompt-match.js";
import { resolveCard, type CardRef } from "./presets/catalog.js";

/**
 * Scripted bots for hand scenarios (presets). A seat has an ordered list of rules. The first rule whose `when` is true
 * answers the prompt. A prompt that no rule matches gets a pass, or the first legal option when a pass is not legal.
 * Never a random answer, so the same board and the same rules always play the same.
 *
 * Rules must be stateless: `when` and `do` read only the prompt and the view. After a server restart the host replays
 * the saved answers without the bot, and then plays on with the same rules.
 */

/** An answer that the host handles: the seat gives up. It is not sent to the core and not stored as an answer. */
export type ScriptedAnswer = DuelAnswer & { surrender?: boolean };

/** One rule tried for a prompt (debug-trace). `rejected` and `reason` are added by the host when the core refuses the answer. */
export interface RuleTraceEntry {
  rule: string;
  matched: boolean;
  answer?: DuelAnswer;
  rejected?: boolean;
  reason?: string;
}

export interface BotContext {
  seat: number;
  /** Debug hook: called once per rule tried, in order. It never changes the choice. */
  trace?: (entry: RuleTraceEntry) => void;
  /** Passcodes the seat may announce, when the prompt is an announcement. */
  permittedCards?: DuelCardInfo[];
  /** Living seats and LP. Absent: the bot reads them from the view it is given. */
  table?: BotTable;
}

export interface Rule {
  /** The reason. It is written in the journal next to the answer. */
  note: string;
  when(prompt: DuelPrompt, view: DuelEngineView, ctx: BotContext): boolean;
  do(prompt: DuelPrompt, view: DuelEngineView, ctx: BotContext): ScriptedAnswer;
}

export interface ScriptedChoice {
  answer: ScriptedAnswer;
  /** The rule note, or "default: ..." when no rule matched. */
  note: string;
  /** Index of the rule that fired, or -1 for the default answer. */
  rule: number;
}

export class ScriptedBotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptedBotError";
  }
}

const PASS_IDS = ["to_ep", "to_m2", "to_bp"];

/** The answer for a prompt that no rule matched: pass when possible, else the first legal option. */
export function defaultAnswer(prompt: DuelPrompt, ctx?: { permittedCards?: DuelCardInfo[]; table?: BotTable }): { answer: DuelAnswer; note: string } {
  if (prompt.kind === "choice") {
    const yes = prompt.options.find((option) => option.id === "yes");
    const no = prompt.options.find((option) => option.id === "no");
    if (yes && no) return { answer: { choice: "no" }, note: "default: decline" };
    if (prompt.cancelable && (prompt.min ?? 1) === 0) return { answer: { cancel: true }, note: "default: pass" };
    if (isSeatPick(prompt)) {
      const seat = chooseSeatOption(prompt, ctx?.table);
      if (seat) return { answer: { choice: seat.id }, note: "default: living opponent with the lowest LP" };
    }
    for (const id of PASS_IDS) {
      if (prompt.options.some((option) => option.id === id)) return { answer: { choice: id }, note: "default: pass" };
    }
    const first = prompt.options[0];
    if (first) return { answer: { choice: first.id }, note: "default: first legal option" };
    throw new ScriptedBotError("Scripted bot has no legal choice");
  }
  // Other kinds: the practice bot picks the first legal option in list order (it never uses chance).
  return { answer: choosePracticeBotAnswer(prompt, ctx), note: "default: first legal option" };
}

/** Pick the answer for a prompt. Throws ScriptedBotError when a rule fails or no legal answer exists. */
export function chooseScripted(rules: readonly Rule[], prompt: DuelPrompt, view: DuelEngineView, ctx: BotContext): ScriptedChoice {
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index]!;
    let applies = false;
    try {
      applies = rule.when(prompt, view, ctx);
    } catch (error) {
      const reason = `failed in when(): ${error instanceof Error ? error.message : String(error)}`;
      ctx.trace?.({ rule: rule.note, matched: false, reason });
      throw new ScriptedBotError(`Rule "${rule.note}" ${reason}`);
    }
    if (!applies) {
      ctx.trace?.({ rule: rule.note, matched: false });
      continue;
    }
    try {
      const answer = rule.do(prompt, view, ctx);
      ctx.trace?.({ rule: rule.note, matched: true, answer });
      return { answer, note: rule.note, rule: index };
    } catch (error) {
      const reason = `failed in do(): ${error instanceof Error ? error.message : String(error)}`;
      ctx.trace?.({ rule: rule.note, matched: true, reason });
      throw new ScriptedBotError(`Rule "${rule.note}" ${reason}`);
    }
  }
  const fallback = defaultAnswer(prompt, { ...ctx, table: ctx.table ?? botTableOf(view) });
  ctx.trace?.({ rule: fallback.note, matched: true, answer: fallback.answer });
  return { answer: fallback.answer, note: fallback.note, rule: -1 };
}

// Builders -------------------------------------------------------------------------------------

export interface RuleOptions {
  /** Why the rule exists. Default: a text made from the rule kind and the card. */
  note?: string;
  /** An extra condition on the prompt and the view (for example "only on turn 2"). */
  if?: (prompt: DuelPrompt, view: DuelEngineView, ctx: BotContext) => boolean;
}

/** A card selector: a card name (or passcode), or a full selector with owner, location, zone or effect text. */
export type BotCardSel = CardRef | (Omit<PromptSel, "code"> & { card: CardRef });

function toSel(sel: BotCardSel, dir?: string): PromptSel {
  if (typeof sel === "object") {
    const { card, ...rest } = sel;
    return { ...rest, code: resolveCard(card, dir) };
  }
  return { code: resolveCard(sel, dir) };
}

function label(sel: BotCardSel): string {
  return typeof sel === "object" ? String(sel.card) : String(sel);
}

function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

function named(rule: Rule, options?: RuleOptions): Rule {
  if (!options?.if) return rule;
  const extra = options.if;
  return { ...rule, when: (prompt, view, ctx) => extra(prompt, view, ctx) && rule.when(prompt, view, ctx) };
}

function pickFrom(options: DuelPromptOption[], sel: PromptSel, what: string): DuelPromptOption {
  const picked = pickOne(options, sel, what);
  if ("error" in picked) throw new ScriptedBotError(picked.error);
  return picked.option;
}

/** Card options of a choice prompt, for activation: chain windows use `card:`, idle and battle prompts use `activate:`. */
function activationOptions(prompt: DuelPrompt, sel: PromptSel): DuelPromptOption[] {
  if (prompt.kind !== "choice") return [];
  const prefixes = prompt.context?.type === "chain" ? ["card:"] : ["activate:"];
  return candidates(prompt, prefixes, sel);
}

/** Activate a card effect when it is offered (idle, battle or chain window). */
export function activate(card: BotCardSel, options?: RuleOptions): Rule {
  const sel = lazy(() => toSel(card));
  return named(
    {
      note: options?.note ?? `activate ${label(card)}`,
      when: (prompt) => activationOptions(prompt, sel()).length > 0,
      do: (prompt) => ({ choice: pickFrom(activationOptions(prompt, sel()), sel(), "activation").id }),
    },
    options,
  );
}

/** Respond in a chain window with a card effect. Does nothing on other prompts. */
export function chainWith(card: BotCardSel, options?: RuleOptions): Rule {
  const inner = activate(card, { ...options, note: options?.note ?? `chain with ${label(card)}` });
  return { ...inner, when: (prompt, view, ctx) => prompt.context?.type === "chain" && inner.when(prompt, view, ctx) };
}

/** Pass the prompt (default pass answer), when the extra condition holds. */
export function pass(options?: RuleOptions): Rule {
  return named(
    {
      note: options?.note ?? "pass",
      when: () => true,
      do: (prompt, _view, ctx) => defaultAnswer(prompt, ctx).answer,
    },
    options,
  );
}

/** Choose the card in a card-selection prompt (a target, a material, a card to discard). */
export function target(card: BotCardSel, options?: RuleOptions): Rule {
  const sel = lazy(() => toSel(card));
  const offered = (prompt: DuelPrompt) =>
    prompt.kind === "cards" || prompt.kind === "tribute" ? candidates(prompt, ["card:"], sel()) : [];
  return named(
    {
      note: options?.note ?? `target ${label(card)}`,
      when: (prompt) => offered(prompt).length > 0,
      do: (prompt) => ({ selected: [pickFrom(offered(prompt), sel(), "target").id] }),
    },
    options,
  );
}

/** Pick one opponent seat in a "select a duelist" prompt (direct attack pick, or an effect that names one opponent). */
export function pickOpponent(seat: number, options?: RuleOptions): Rule {
  // A seat that left the duel is never answered: the rule does not match, and the default picks a living seat.
  const offered = (prompt: DuelPrompt, view: DuelEngineView, ctx: BotContext) => {
    const living = (ctx.table ?? botTableOf(view)).living;
    if (living && !living.includes(seat)) return [];
    return prompt.kind === "choice" ? prompt.options.filter((option) => option.id.startsWith("opt:") && option.controller === seat) : [];
  };
  return named(
    {
      note: options?.note ?? `pick opponent seat ${seat}`,
      when: (prompt, view, ctx) => offered(prompt, view, ctx).length > 0,
      do: (prompt, view, ctx) => ({ choice: offered(prompt, view, ctx)[0]!.id }),
    },
    options,
  );
}

/** The seat gives up. The host handles it like the surrender button. */
export function surrender(options?: RuleOptions): Rule {
  return named({ note: options?.note ?? "surrender", when: () => true, do: () => ({ surrender: true }) }, options);
}

/** Choose an option of a choice prompt by id prefix: "to_bp", "to_ep", "summon:", "attack:". */
export function choose(idPrefix: string, options?: RuleOptions): Rule {
  const offered = (prompt: DuelPrompt) => (prompt.kind === "choice" ? prompt.options.filter((option) => option.id.startsWith(idPrefix)) : []);
  return named(
    {
      note: options?.note ?? `choose ${idPrefix}`,
      when: (prompt) => offered(prompt).length > 0,
      do: (prompt) => ({ choice: offered(prompt)[0]!.id }),
    },
    options,
  );
}

function cardAction(prefix: string, verb: string) {
  return (card: BotCardSel, options?: RuleOptions): Rule => {
    const sel = lazy(() => toSel(card));
    const offered = (prompt: DuelPrompt) => (prompt.kind === "choice" ? candidates(prompt, [prefix], sel()) : []);
    return named(
      {
        note: options?.note ?? `${verb} ${label(card)}`,
        when: (prompt) => offered(prompt).length > 0,
        do: (prompt) => ({ choice: pickFrom(offered(prompt), sel(), verb).id }),
      },
      options,
    );
  };
}

/** Normal Summon a card from the hand. */
export const normalSummon = cardAction("summon:", "normal summon");
/** Set a monster. */
export const setMonster = cardAction("mset:", "set monster");
/** Set a Spell or Trap. */
export const setSpell = cardAction("sset:", "set spell/trap");
/** Attack with a monster (the attack option of a battle prompt). */
export const attackWith = cardAction("attack:", "attack with");
