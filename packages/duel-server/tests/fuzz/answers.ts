import type { DuelAnswer, DuelCardInfo, DuelPrompt, DuelPromptOption } from "@yugidraft/shared/duels";
import { choosePracticeBotAnswer } from "../../src/practice-bot.js";
import type { Rng } from "./rng.js";

export interface AnswerContext {
  rng: Rng;
  /** Accepted answers already given in the current turn. Raises the end phase weight when large. */
  turnActions: number;
  /** Toggle answers already given to the current run of toggle prompts. */
  toggleSteps: number;
  searchCards(query: string): DuelCardInfo[];
  /** Seats still in the duel (multi-seat tables). A seat pick or a place on another seat never names a seat that is not here. */
  living?: readonly number[];
}

/** The options that name no dead seat. When none is left the list stays whole, so that the plan is never empty by this rule. */
function livingOptionsOf(options: DuelPromptOption[], living: readonly number[] | undefined): DuelPromptOption[] {
  if (!living) return options;
  const kept = options.filter((option) => option.controller == null || living.includes(option.controller));
  return kept.length > 0 ? kept : options;
}

/**
 * The answers to try for one prompt, best first.
 * `exact` is true when the plan only holds answers the prompt fully defines (choice ids, index sets,
 * permutations...). The engine must accept the first one. For the other kinds (sum, tribute, toggle)
 * the prompt does not show every rule, so a rejection of one candidate is only a soft event.
 */
export interface AnswerPlan {
  candidates: DuelAnswer[];
  exact: boolean;
  /** Short description of the strategy, for failure reports. */
  note: string;
}

const EXACT_KINDS = new Set<DuelPrompt["kind"]>(["choice", "cards", "places", "order", "counters", "number", "announce-card"]);

const IDLE_WEIGHTS: Array<[string, number]> = [
  ["summon:", 6],
  ["spsummon:", 6],
  ["activate:", 5],
  ["mset:", 3],
  ["sset:", 3],
  ["pos:", 2],
  ["to_bp", 1.5],
  ["to_ep", 1],
  ["shuffle", 0.1],
];
const BATTLE_WEIGHTS: Array<[string, number]> = [
  ["attack:", 8],
  ["activate:", 4],
  ["to_m2", 1],
  ["to_ep", 1],
];

function weightOf(option: DuelPromptOption, table: Array<[string, number]>, late: boolean): number {
  for (const [prefix, weight] of table) {
    if (option.id.startsWith(prefix)) {
      const isExit = prefix === "to_bp" || prefix === "to_ep" || prefix === "to_m2";
      return isExit && late ? weight * 10 : weight;
    }
  }
  return 1;
}

function subset(rng: Rng, options: DuelPromptOption[], min: number, max: number): string[] | null {
  const hi = Math.min(max, options.length);
  if (min > hi) return null;
  const n = rng.chance(0.55) ? min : rng.range(min, hi);
  return rng.sample(options, n).map((option) => option.id);
}

function tributeChoice(prompt: DuelPrompt, rng: Rng): DuelAnswer | null {
  const options = prompt.options;
  const minWeight = prompt.min ?? 1;
  const maxCards = prompt.max ?? options.length;
  const weight = (option: DuelPromptOption) => option.values?.[0] ?? 1;
  const order = rng.shuffle(options);
  const picked: DuelPromptOption[] = [];
  let total = 0;
  for (const option of order) {
    if (total >= minWeight) break;
    picked.push(option);
    total += weight(option);
  }
  if (total >= minWeight && picked.length <= maxCards) return { selected: picked.map((option) => option.id) };
  if (options.length > 14) return null;
  const valid: string[][] = [];
  for (let mask = 1; mask < 1 << options.length; mask++) {
    const ids: string[] = [];
    let sum = 0;
    for (let i = 0; i < options.length; i++) {
      if (mask & (1 << i)) {
        const option = options[i] as DuelPromptOption;
        ids.push(option.id);
        sum += weight(option);
      }
    }
    if (ids.length <= maxCards && sum >= minWeight) valid.push(ids);
  }
  return valid.length > 0 ? { selected: rng.pick(valid) } : null;
}

function countersChoice(prompt: DuelPrompt, rng: Rng): DuelAnswer | null {
  let remaining = prompt.target ?? prompt.min ?? 0;
  const counts: Record<string, number> = {};
  for (const option of rng.shuffle(prompt.options)) {
    const cap = option.max ?? option.values?.[0] ?? 0;
    const take = Math.min(cap, remaining, rng.chance(0.5) ? cap : rng.range(0, cap));
    counts[option.id] = take;
    remaining -= take;
  }
  // Second pass so the total is exact.
  for (const option of prompt.options) {
    if (remaining <= 0) break;
    const cap = option.max ?? option.values?.[0] ?? 0;
    const add = Math.min(cap - (counts[option.id] ?? 0), remaining);
    counts[option.id] = (counts[option.id] ?? 0) + add;
    remaining -= add;
  }
  return remaining === 0 ? { counts } : null;
}

function toggleChoice(prompt: DuelPrompt, ctx: AnswerContext): DuelAnswer | null {
  const selected = prompt.options.filter((option) => option.selected);
  const unselected = prompt.options.filter((option) => !option.selected);
  const min = prompt.min ?? 0;
  const pressure = ctx.toggleSteps > 12;
  if (selected.length >= min && prompt.finishable && (pressure || ctx.rng.chance(0.4))) return { finish: true };
  if (pressure && prompt.cancelable) return { cancel: true };
  if (unselected.length > 0 && (selected.length < min || ctx.rng.chance(0.75) || selected.length === 0)) {
    return { choice: ctx.rng.pick(unselected).id };
  }
  if (selected.length > 0 && ctx.rng.chance(0.3)) return { choice: ctx.rng.pick(selected).id };
  if (prompt.finishable) return { finish: true };
  if (prompt.cancelable) return { cancel: true };
  const any = prompt.options;
  return any.length > 0 ? { choice: ctx.rng.pick(any).id } : null;
}

function announceCandidates(ctx: AnswerContext): DuelAnswer[] {
  const { rng } = ctx;
  const letters = "aeioustnrldchmgpbfkwvy";
  const seen = new Set<number>();
  const out: DuelAnswer[] = [];
  for (let attempt = 0; attempt < 12 && out.length < 4; attempt++) {
    const query = attempt < 6
      ? (letters[rng.int(letters.length)] as string) + (letters[rng.int(letters.length)] as string)
      : (letters[rng.int(letters.length)] as string);
    for (const card of ctx.searchCards(query)) {
      if (!seen.has(card.code) && seen.size < 40) {
        seen.add(card.code);
        out.push({ cardCode: card.code });
      }
    }
    if (out.length > 0 && attempt >= 1) break;
  }
  return out.length > 4 ? rng.sample(out, 4) : out;
}

function fallback(prompt: DuelPrompt, ctx: AnswerContext): DuelAnswer[] {
  try {
    return [choosePracticeBotAnswer(prompt, { permittedCards: [] })];
  } catch {
    void ctx;
    return [];
  }
}

export function planAnswer(prompt: DuelPrompt, ctx: AnswerContext): AnswerPlan {
  const { rng } = ctx;
  const exact = EXACT_KINDS.has(prompt.kind);
  const plan = (candidates: Array<DuelAnswer | null>, note: string, extra: DuelAnswer[] = []): AnswerPlan => ({
    candidates: [...candidates.filter((c): c is DuelAnswer => c !== null), ...extra],
    exact,
    note,
  });

  switch (prompt.kind) {
    case "choice": {
      const options = prompt.options;
      const ids = new Set(options.map((option) => option.id));
      if (ids.has("yes") && ids.has("no")) return plan([{ choice: rng.chance(0.55) ? "yes" : "no" }], "yes/no");
      const context = prompt.context?.type;
      if (context === "action") {
        const table = prompt.context && "phase" in prompt.context && prompt.context.phase === "battle" ? BATTLE_WEIGHTS : IDLE_WEIGHTS;
        const late = ctx.turnActions > 40;
        const option = rng.weighted(options, (o) => weightOf(o, table, late));
        return plan([{ choice: option.id }], "action");
      }
      if (context === "chain") {
        if (prompt.cancelable && (options.length === 0 || rng.chance(0.35))) return plan([{ cancel: true }], "chain-pass");
        if (options.length === 0) return plan([], "chain-empty");
        return plan([{ choice: rng.pick(options).id }], "chain");
      }
      if (options.length === 0) {
        return plan([prompt.cancelable ? { cancel: true } : null], "choice-empty");
      }
      if (context === "opponent") return plan([{ choice: rng.pick(livingOptionsOf(options, ctx.living)).id }], "opponent");
      return plan([{ choice: rng.pick(options).id }], "choice");
    }
    case "cards": {
      const min = prompt.min ?? 0;
      const max = prompt.max ?? min;
      if (prompt.cancelable && min === 0 && rng.chance(0.25)) return plan([{ cancel: true }], "cards-cancel");
      const ids = subset(rng, prompt.options, min, max);
      if (!ids) return plan([prompt.cancelable ? { cancel: true } : null], "cards-too-few");
      return plan([{ selected: ids }], "cards", prompt.cancelable ? [{ cancel: true }] : []);
    }
    case "places": {
      const count = prompt.min ?? prompt.max ?? 1;
      const zones = livingOptionsOf(prompt.options, ctx.living);
      if (zones.length < count) return plan([], "places-too-few");
      return plan([{ selected: rng.sample(zones, count).map((o) => o.id) }], "places");
    }
    case "order":
      return plan([{ selected: rng.shuffle(prompt.options).map((option) => option.id) }], "order");
    case "counters":
      return plan([countersChoice(prompt, rng)], "counters", fallback(prompt, ctx));
    case "number": {
      const first = prompt.options.length > 0 ? rng.pick(prompt.options) : undefined;
      if (first) return plan([{ choice: first.id }], "number");
      return plan([prompt.target != null ? { value: prompt.target } : null], "number-target");
    }
    case "announce-card":
      return plan(announceCandidates(ctx), "announce-card");
    case "tribute": {
      const candidates: Array<DuelAnswer | null> = [tributeChoice(prompt, rng)];
      if (prompt.cancelable && rng.chance(0.15)) candidates.unshift({ cancel: true });
      return plan(candidates, "tribute", fallback(prompt, ctx));
    }
    case "sum": {
      // The prompt does not say whether the core wants the sum to equal or to reach the target, so the
      // plan offers both kinds of selection. A rejection of one candidate is a soft event.
      const candidates: DuelAnswer[] = [];
      const shuffled: DuelPrompt = { ...prompt, options: rng.shuffle(prompt.options) };
      for (const p of [shuffled, prompt]) {
        try {
          candidates.push(choosePracticeBotAnswer(p, { permittedCards: [] }));
        } catch {
          // No exact solution found by the simple search.
        }
      }
      const mandatory = new Set(prompt.mandatory ?? []);
      const must = prompt.options.filter((o) => mandatory.has(o.id));
      const free = rng.shuffle(prompt.options.filter((o) => !mandatory.has(o.id) && o.id.startsWith("card:")));
      const top = (o: DuelPromptOption) => Math.max(0, ...(o.values && o.values.length > 0 ? o.values : [0]));
      let total = must.reduce((sum, o) => sum + top(o), 0);
      const reach: string[] = [];
      const limit = prompt.max !== undefined ? Math.max(0, prompt.max - must.length) : free.length;
      for (const option of free) {
        if (total >= (prompt.target ?? 0) && reach.length >= Math.max(0, (prompt.min ?? 0) - must.length)) break;
        if (reach.length >= limit) break;
        reach.push(option.id);
        total += top(option);
      }
      candidates.push({ selected: reach });
      candidates.push({ selected: free.slice(0, limit).map((o) => o.id) });
      // Small subsets too: the core may want a sum that reaches the target with as few cards as possible.
      const ids = free.map((o) => o.id);
      const subsets: string[][] = [];
      for (let size = 1; size <= Math.min(3, limit, ids.length); size++) {
        const pick = (from: number, taken: string[]) => {
          if (taken.length === size) return subsets.push([...taken]);
          for (let i = from; i < ids.length && subsets.length < 40; i++) pick(i + 1, [...taken, ids[i] as string]);
        };
        pick(0, []);
      }
      const valueOf = (id: string) => top(prompt.options.find((o) => o.id === id) as DuelPromptOption);
      const mustTotal = must.reduce((sum, o) => sum + top(o), 0);
      const sumOf = (subset: string[]) => mustTotal + subset.reduce((sum, id) => sum + valueOf(id), 0);
      const target = prompt.target ?? 0;
      const reaching = subsets.filter((subset) => sumOf(subset) >= target);
      const others = subsets.filter((subset) => sumOf(subset) < target);
      const ordered = [...rng.shuffle(reaching).sort((a, b) => a.length - b.length || sumOf(a) - sumOf(b)), ...rng.shuffle(others)];
      for (const subset of ordered.slice(0, 14)) candidates.push({ selected: [...must.map((o) => o.id), ...subset] });
      if (prompt.cancelable) candidates.push({ cancel: true });
      return plan(candidates, "sum");
    }
    case "toggle":
      return plan([toggleChoice(prompt, ctx)], "toggle", [...fallback(prompt, ctx), ...(prompt.finishable ? [{ finish: true }] : [])]);
    default:
      return plan(fallback(prompt, ctx), `unknown-kind-${String(prompt.kind)}`);
  }
}
