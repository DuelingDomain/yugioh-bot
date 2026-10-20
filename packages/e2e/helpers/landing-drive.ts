import { expect, type Page } from "@playwright/test";
import type { DuelAnswer } from "@yugidraft/shared/duels";
import type { Seat } from "./fixtures";
import { readTable } from "./table";
import { pickLegalZone } from "./board";

// Drives the duel prompts that have no short UI path (card lists, targets, positions) over the room API, the way the
// existing multi-seat specs do. The first click of a move (summon, set, activate) always goes through the real card menu,
// so the animation under test starts from the same place as for a player.

export type Prompt = {
  id: string;
  seat: number;
  kind: string;
  title: string;
  options: Array<{ id: string; label: string; card?: { code: number; name: string }; selected?: boolean; controller?: number }>;
  min?: number;
  max?: number;
  cancelable?: boolean;
  finishable?: boolean;
  context?: { type: string };
};
type Engine = { revision: number; prompt?: Prompt | null; turn?: number };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function promptOf(seat: Seat, slug: string): Promise<{ prompt: Prompt | null; revision: number }> {
  const room = await readTable(seat.page, slug);
  const engine = room.engine as unknown as Engine | null;
  return { prompt: engine?.prompt ?? null, revision: engine?.revision ?? 0 };
}

const describePrompt = (prompt: Prompt | null): string =>
  prompt ? `${prompt.kind} "${prompt.title}" [${prompt.context?.type ?? "-"}] ${JSON.stringify(prompt.options.map((o) => `${o.id}|${o.label}|${o.card?.name ?? ""}`))}` : "no prompt";

/** Waits until the seat owns a prompt that `test` accepts. The error names the last prompt, so a wrong guess shows what the engine asked. */
export async function waitPrompt(seat: Seat, slug: string, test: (prompt: Prompt) => boolean, label: string, timeoutMs = 25_000): Promise<{ prompt: Prompt; revision: number }> {
  const end = Date.now() + timeoutMs;
  let last: Prompt | null = null;
  while (Date.now() < end) {
    const { prompt, revision } = await promptOf(seat, slug);
    last = prompt ?? last;
    if (prompt && test(prompt)) return { prompt, revision };
    await sleep(120);
  }
  throw new Error(`${label}: no matching prompt for ${seat.key} within ${timeoutMs} ms. Last prompt: ${describePrompt(last)}`);
}

export async function post(seat: Seat, slug: string, revision: number, prompt: Prompt, answer: DuelAnswer): Promise<void> {
  const response = await seat.page.request.post(`/api/duels/${slug}/actions`, { data: { revision, promptId: prompt.id, answer } });
  expect(response.ok(), `${prompt.title}: ${await response.text()}`).toBe(true);
}

export const isAction = (prompt: Prompt): boolean => prompt.context?.type === "action";

/** Answers one prompt with the default of a plain duelist: the first legal option, or the first `min` ones of a card pick. */
export function defaultAnswer(prompt: Prompt): DuelAnswer {
  if (prompt.kind === "choice") {
    const yes = prompt.options.find((o) => o.id === "yes");
    if (yes) return { choice: yes.id };
    return prompt.options[0] ? { choice: prompt.options[0].id } : { cancel: true };
  }
  if (prompt.kind === "toggle") {
    const unselected = prompt.options.find((o) => !o.selected);
    return prompt.finishable ? { finish: true } : unselected ? { choice: unselected.id } : { cancel: true };
  }
  if (prompt.kind === "number") return { value: prompt.min ?? 0 };
  const count = Math.max(prompt.min ?? 1, 1);
  return { selected: prompt.options.slice(0, count).map((o) => o.id) };
}

/** Answers a prompt that may or may not come (a trigger of a card). Waits up to `waitMs` for one that `test` accepts. */
export async function answerIfAsked(seat: Seat, slug: string, test: (prompt: Prompt) => boolean, answer: DuelAnswer, waitMs: number): Promise<boolean> {
  const end = Date.now() + waitMs;
  while (Date.now() < end) {
    const { prompt, revision } = await promptOf(seat, slug);
    if (prompt && test(prompt)) {
      await post(seat, slug, revision, prompt, answer);
      return true;
    }
    await sleep(150);
  }
  return false;
}

export type Handler = { when: (prompt: Prompt) => boolean; answer: (prompt: Prompt) => DuelAnswer | null; label: string };

/** A handler for a card-pick prompt: picks the options whose card has this name. */
export const pickNamed = (title: RegExp, ...names: string[]): Handler => ({
  label: `pick ${names.join(", ")}`,
  when: (prompt) => title.test(prompt.title) || prompt.options.some((o) => o.card?.name != null && names.includes(o.card.name)),
  answer: (prompt) => {
    const wanted = prompt.options.filter((o) => o.card?.name != null && names.includes(o.card.name));
    if (wanted.length === 0) return null;
    if (prompt.kind === "choice") return { choice: wanted[0]!.id };
    if (prompt.kind === "toggle") {
      const next = wanted.find((o) => !o.selected);
      return next ? { choice: next.id } : prompt.finishable ? { finish: true } : null;
    }
    return { selected: wanted.slice(0, Math.max(prompt.min ?? 1, 1)).map((o) => o.id) };
  },
});

/**
 * Answers the prompts of a resolving effect for `seat` until the action prompt of the main phase is back (or `until`
 * accepts a prompt, which is left unanswered). Handlers run in order; no handler means the default answer.
 */
export async function resolveWith(seat: Seat, slug: string, handlers: Handler[], opts: { until?: (prompt: Prompt) => boolean; timeoutMs?: number; log?: string[] } = {}): Promise<void> {
  const end = Date.now() + (opts.timeoutMs ?? 30_000);
  let idle = 0;
  while (Date.now() < end) {
    const { prompt, revision } = await promptOf(seat, slug);
    if (!prompt) {
      // No prompt for this seat: the effect is still resolving, or it is over. A short quiet spell ends the wait.
      idle += 1;
      if (idle >= 6 && opts.until == null) return;
      await sleep(150);
      continue;
    }
    idle = 0;
    if (opts.until?.(prompt)) return;
    if (isAction(prompt) && opts.until == null) return;
    let answer: DuelAnswer | null = null;
    let label = "default";
    for (const handler of handlers) {
      if (!handler.when(prompt)) continue;
      answer = handler.answer(prompt);
      if (answer) { label = handler.label; break; }
    }
    answer ??= defaultAnswer(prompt);
    opts.log?.push(`${seat.key} ${prompt.kind} "${prompt.title}" -> ${label} ${JSON.stringify(answer)}`);
    await post(seat, slug, revision, prompt, answer);
    await sleep(200);
  }
  throw new Error(`resolveWith: still no end of the effect for ${seat.key}`);
}

/**
 * The UI move: opens the card menu, picks the action, and answers the zone prompt of the move when the engine asks one
 * (a summon, a Set and a spell with a free choice of zone all do).
 */
export async function zoneIfAsked(page: Page, kind: "mz" | "st"): Promise<void> {
  const zonePrompt = page.getByRole("group", { name: /^Select a zone/ });
  const shown = await zonePrompt.waitFor({ state: "visible", timeout: 2_500 }).then(() => true, () => false);
  if (shown) await pickLegalZone(page, kind);
}

/** The page shows no flying card for `quietMs`: every animation of the step is over. */
export async function waitQuiet(page: Page, quietMs = 1_400, maxMs = 25_000): Promise<void> {
  await page.evaluate(({ quietMs, maxMs }) => new Promise<void>((resolve) => {
    const started = performance.now();
    let quietSince = started;
    const tick = () => {
      const now = performance.now();
      if (document.querySelector('[data-style="place"],[data-style="toss"],[data-style="draw"],[data-style="add"],[data-style="fade"],[data-style="tribute"]')) quietSince = now;
      if (now - quietSince >= quietMs || now - started >= maxMs) return resolve();
      setTimeout(tick, 60);
    };
    tick();
  }), { quietMs, maxMs });
}
