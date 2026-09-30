import Database from "better-sqlite3";
import { join } from "node:path";
import type { DuelAnswer, DuelCardInfo, DuelDeck, DuelMode, DuelPrompt, DuelPromptOption } from "@yugidraft/shared/duels";

export const AXE_RAIDER = 48305365;

export class PracticeBotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PracticeBotError";
  }
}

export function buildPracticeBotDeck(mode: DuelMode, dataDirectory: string): DuelDeck {
  if (mode !== "normal" && mode !== "domain") {
    throw new PracticeBotError(`Unsupported practice bot mode ${String(mode)}`);
  }
  const count = mode === "domain" ? 60 : 40;
  const db = new Database(join(dataDirectory, "cards.cdb"), { readonly: true, fileMustExist: true });
  try {
    const cards = db.prepare<[number, number], { id: number }>(`
      select id from datas
      where alias = 0 and type = 17 and attribute = 1 and level <= 4
        and ot in (1, 2, 3) and id != ?
      order by atk desc, def desc, level desc, id asc
      limit ?
    `).all(mode === "domain" ? AXE_RAIDER : 0, count);
    if (cards.length !== count) {
      throw new PracticeBotError(`Pinned engine data does not have ${count} low-level EARTH Normal Monsters`);
    }
    const deck: DuelDeck = { main: cards.map((card) => card.id), extra: [], side: [] };
    if (mode === "domain") deck.deckMaster = AXE_RAIDER;
    return deck;
  } finally {
    db.close();
  }
}

function pickPrefix(prompt: DuelPrompt, prefix: string): DuelPromptOption | undefined {
  return prompt.options.find((option) => option.id.startsWith(prefix));
}

function pickId(prompt: DuelPrompt, id: string): DuelPromptOption | undefined {
  return prompt.options.find((option) => option.id === id);
}

function chooseChoice(prompt: DuelPrompt): DuelAnswer {
  if (pickId(prompt, "yes") && pickId(prompt, "no")) return { choice: "no" };
  if (prompt.cancelable && (prompt.min ?? 1) === 0) return { cancel: true };

  const idleOrBattle = prompt.options.some(
    (option) =>
      option.id === "to_bp" ||
      option.id === "to_ep" ||
      option.id === "to_m2" ||
      option.id === "shuffle" ||
      option.id.startsWith("summon:") ||
      option.id.startsWith("spsummon:") ||
      option.id.startsWith("attack:") ||
      option.id.startsWith("mset:") ||
      option.id.startsWith("sset:"),
  );
  if (idleOrBattle) {
    const summon = pickPrefix(prompt, "summon:");
    if (summon) return { choice: summon.id };
    const spsummon = pickPrefix(prompt, "spsummon:");
    if (spsummon) return { choice: spsummon.id };
    const attack = pickPrefix(prompt, "attack:");
    if (attack) return { choice: attack.id };
    if (pickId(prompt, "to_bp")) return { choice: "to_bp" };
    if (pickId(prompt, "to_m2")) return { choice: "to_m2" };
    if (pickId(prompt, "to_ep")) return { choice: "to_ep" };
    throw new PracticeBotError("Practice bot has no progressing idle or battle action");
  }

  if (prompt.options.length > 0 && prompt.options.every((option) => option.id.startsWith("pos:"))) {
    const attack =
      pickId(prompt, "pos:1") ?? prompt.options.find((option) => /attack/i.test(option.label)) ?? prompt.options[0];
    if (attack) return { choice: attack.id };
  }

  const generic = prompt.options.find((option) => option.id !== "shuffle" && !option.id.startsWith("pos:"));
  if (generic) return { choice: generic.id };
  throw new PracticeBotError("Practice bot has no legal choice");
}

function chooseCards(prompt: DuelPrompt): DuelAnswer {
  const min = prompt.min ?? 0;
  const max = prompt.max ?? min;
  if (min === 0 && prompt.cancelable) return { cancel: true };
  if (prompt.options.length < min || min > max) {
    throw new PracticeBotError("Practice bot has no legal card selection");
  }
  return { selected: prompt.options.slice(0, min).map((option) => option.id) };
}

function chooseTribute(prompt: DuelPrompt): DuelAnswer {
  const cards = prompt.options.map((option) => ({ id: option.id, weight: option.values?.[0] ?? 1 }));
  const minWeight = prompt.min ?? 1;
  const maxCards = prompt.max ?? cards.length;
  if (cards.length === 0 || cards.length > 16) {
    throw new PracticeBotError("Practice bot has no legal tribute selection");
  }
  let best: { ids: string[]; weight: number } | null = null;
  const limit = 1 << cards.length;
  for (let mask = 1; mask < limit; mask++) {
    const ids: string[] = [];
    let weight = 0;
    for (let index = 0; index < cards.length; index++) {
      if ((mask & (1 << index)) === 0) continue;
      const card = cards[index];
      if (!card) continue;
      ids.push(card.id);
      weight += card.weight;
      if (ids.length > maxCards) break;
    }
    if (ids.length > maxCards || weight < minWeight) continue;
    if (
      !best ||
      ids.length < best.ids.length ||
      (ids.length === best.ids.length && (weight < best.weight || (weight === best.weight && ids.join() < best.ids.join())))
    ) {
      best = { ids, weight };
    }
  }
  if (!best) throw new PracticeBotError("Practice bot has no legal tribute selection");
  return { selected: best.ids };
}

function chooseSum(prompt: DuelPrompt): DuelAnswer {
  const mandatory = prompt.options.filter((option) => (prompt.mandatory ?? []).includes(option.id));
  const optional = prompt.options.filter((option) => option.id.startsWith("card:"));
  const target = prompt.target ?? 0;
  const optionalMin = Math.max(0, (prompt.min ?? 0) - mandatory.length);
  const optionalMax = Math.max(optionalMin, (prompt.max ?? optional.length + mandatory.length) - mandatory.length);
  const optionValues = (option: DuelPromptOption) => (option.values && option.values.length > 0 ? option.values : [0]);

  const remaining = new Set<number>();
  const walkMust = (index: number, total: number) => {
    if (index >= mandatory.length) {
      remaining.add(target - total);
      return;
    }
    const option = mandatory[index];
    if (!option) return;
    for (const amount of optionValues(option)) walkMust(index + 1, total + amount);
  };
  walkMust(0, 0);

  let found: string[] | null = null;
  const walk = (index: number, taken: string[], total: number) => {
    if (found) return;
    if (taken.length > optionalMax) return;
    if (taken.length >= optionalMin && remaining.has(total)) {
      found = taken.slice();
      return;
    }
    if (index >= optional.length) return;
    walk(index + 1, taken, total);
    if (found) return;
    const option = optional[index];
    if (!option) return;
    for (const amount of optionValues(option)) {
      walk(index + 1, [...taken, option.id], total + amount);
      if (found) return;
    }
  };
  walk(0, [], 0);
  if (!found) throw new PracticeBotError("Practice bot has no legal sum selection");
  return { selected: found };
}

function chooseToggle(prompt: DuelPrompt): DuelAnswer {
  const selectedCount = prompt.options.filter((option) => option.selected).length;
  const min = prompt.min ?? 0;
  if (prompt.finishable && selectedCount >= min) return { finish: true };
  if (selectedCount < min) {
    const next = prompt.options.find((option) => !option.selected);
    if (next) return { choice: next.id };
  }
  if (prompt.finishable) return { finish: true };
  if (prompt.cancelable) return { cancel: true };
  const next = prompt.options.find((option) => !option.selected);
  if (next) return { choice: next.id };
  throw new PracticeBotError("Practice bot has no legal toggle selection");
}

function chooseCounters(prompt: DuelPrompt): DuelAnswer {
  let remaining = prompt.target ?? prompt.min ?? 0;
  const counts: Record<string, number> = {};
  for (const option of prompt.options) {
    const cap = option.max ?? option.values?.[0] ?? 0;
    const take = Math.min(cap, remaining);
    counts[option.id] = take;
    remaining -= take;
  }
  if (remaining !== 0) throw new PracticeBotError("Practice bot has no legal counter selection");
  return { counts };
}

export function choosePracticeBotAnswer(
  prompt: DuelPrompt,
  options?: { permittedCards?: DuelCardInfo[] },
): DuelAnswer {
  switch (prompt.kind) {
    case "choice":
      return chooseChoice(prompt);
    case "cards":
    case "places":
      return chooseCards(prompt);
    case "tribute":
      return chooseTribute(prompt);
    case "sum":
      return chooseSum(prompt);
    case "toggle":
      return chooseToggle(prompt);
    case "order":
      if (prompt.options.length === 0) throw new PracticeBotError("Practice bot has no cards to order");
      return { selected: prompt.options.map((option) => option.id) };
    case "counters":
      return chooseCounters(prompt);
    case "number": {
      const first = prompt.options[0];
      if (first) return { choice: first.id };
      if (prompt.target != null) return { value: prompt.target };
      throw new PracticeBotError("Practice bot has no number to announce");
    }
    case "announce-card": {
      const code = options?.permittedCards?.[0]?.code;
      if (!code) throw new PracticeBotError("Practice bot has no permitted card to announce");
      return { cardCode: code };
    }
    default:
      throw new PracticeBotError(`Practice bot cannot answer prompt kind ${String(prompt.kind)}`);
  }
}
