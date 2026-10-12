import type { DuelAnswer, DuelPrompt } from "@yugidraft/shared/duels";
import { RequestError } from "./request-error.js";

export function validateAnswer(prompt: DuelPrompt, input: unknown): asserts input is DuelAnswer {
  const invalid = (): never => { throw new RequestError("Invalid answer", 400); };
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid();
  const answer = input as Record<string, unknown>;
  const fields: Record<DuelPrompt["kind"], string[]> = {
    choice: ["choice", "selected", "value"], toggle: ["choice"], cards: ["selected", "choice"],
    tribute: ["selected", "choice"], places: ["selected", "choice"], order: ["selected"],
    sum: ["selected", "choice"], counters: ["counts"], number: ["value"], "announce-card": ["cardCode"],
  };
  if (Object.keys(answer).some((key) => ![...fields[prompt.kind], "cancel", "finish"].includes(key))) invalid();
  for (const key of ["cancel", "finish"]) if (key in answer && typeof answer[key] !== "boolean") invalid();
  for (const key of ["value", "cardCode"]) if (key in answer && !Number.isSafeInteger(answer[key])) invalid();
  if (answer.choice !== undefined && typeof answer.choice !== "string") invalid();
  if (answer.selected !== undefined && (!Array.isArray(answer.selected) || answer.selected.some((id) => typeof id !== "string"))) invalid();
  if (answer.cancel === true) {
    if (!prompt.cancelable || answer.finish === true) invalid();
    return;
  }
  if (answer.finish === true) {
    if (!prompt.finishable || prompt.kind !== "toggle") invalid();
    return;
  }
  const options = new Map(prompt.options.map((option) => [option.id, option]));
  if (prompt.kind === "choice" || prompt.kind === "toggle") {
    if (answer.selected !== undefined) {
      const ids = answer.selected as string[];
      if (ids.length !== 1 || !options.has(ids[0]!)) invalid();
      return;
    }
    if (typeof answer.choice === "string" && options.has(answer.choice)) return;
    // Removed opponent options retain the engine's seat-left response.
    if (prompt.context?.type === "opponent" && typeof answer.choice === "string" && /^opt:(0|[1-9]\d*)$/.test(answer.choice)) return;
    if (prompt.kind === "choice" && Number.isSafeInteger(answer.value) && prompt.options.some((option) => option.id.startsWith("num:") && option.values?.[0] === answer.value)) return;
    if (prompt.context?.type === "chain" && !prompt.context.forced && answer.choice === undefined && answer.value === undefined) return;
    invalid();
  }
  if (prompt.kind === "number") {
    if (!Number.isSafeInteger(answer.value) || (answer.value as number) < (prompt.min ?? 0) || (answer.value as number) > (prompt.max ?? Number.MAX_SAFE_INTEGER)) invalid();
    return;
  }
  if (prompt.kind === "announce-card") {
    if (!Number.isSafeInteger(answer.cardCode) || (answer.cardCode as number) <= 0 || (answer.cardCode as number) > 0xffffffff) invalid();
    return;
  }
  if (prompt.kind === "counters") {
    if (!answer.counts || typeof answer.counts !== "object" || Array.isArray(answer.counts)) invalid();
    let total = 0;
    for (const [id, count] of Object.entries(answer.counts as Record<string, unknown>)) {
      if (!options.has(id) || !Number.isSafeInteger(count) || (count as number) < 0 || (count as number) > (options.get(id)!.max ?? prompt.max ?? 0)) invalid();
      total += count as number;
    }
    if (prompt.target !== undefined && total !== prompt.target) invalid();
    return;
  }
  const selected = (answer.selected ?? (answer.choice === undefined ? undefined : [answer.choice])) as string[] | undefined;
  if (!Array.isArray(selected) || new Set(selected).size !== selected.length || selected.some((id) => !options.has(id))) invalid();
  const ids = selected!;
  const count = prompt.kind === "sum" ? new Set([...ids, ...(prompt.mandatory ?? [])]).size : ids.length;
  if (count > (prompt.max ?? prompt.options.length)) invalid();
  if (prompt.kind !== "tribute" && !(prompt.kind === "sum" && prompt.sumMode === "at-least") && count < (prompt.min ?? 0)) invalid();
  if (prompt.kind === "order" && ids.length !== prompt.options.length) invalid();
}
