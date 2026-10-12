import type { DuelAnswer, DuelPrompt } from "@yugidraft/shared/duels";
import { RequestError } from "./request-error.js";

/**
 * Check the wire shape only. The engine owns option membership, bounds, seat
 * mapping and cancel/finish rules, including suspended multiplayer prompts.
 * Keep unknown fields and prompt kinds compatible with the engine's checks.
 */
export function validateAnswer(_prompt: DuelPrompt, input: unknown): asserts input is DuelAnswer {
  const invalid = (): never => { throw new RequestError("Invalid answer", 400); };
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid();
  const answer = input as Record<string, unknown>;
  for (const key of ["cancel", "finish"]) {
    if (key in answer && typeof answer[key] !== "boolean") invalid();
  }
  for (const key of ["value", "cardCode"]) {
    if (key in answer && (typeof answer[key] !== "number" || !Number.isFinite(answer[key]))) invalid();
  }
  if ("choice" in answer && typeof answer.choice !== "string") invalid();
  if ("selected" in answer && (!Array.isArray(answer.selected) || answer.selected.some((id) => typeof id !== "string"))) invalid();
  if ("counts" in answer) {
    if (!answer.counts || typeof answer.counts !== "object" || Array.isArray(answer.counts)) invalid();
    if (Object.values(answer.counts as Record<string, unknown>).some((count) => typeof count !== "number" || !Number.isFinite(count))) invalid();
  }
}
