import { ExpectedError } from "../observability/index.js";
import { IDEA_AREAS, type IdeaDecisionInput, type IdeaPostInput } from "./idea-types.js";

const record = (input: unknown): input is Record<string, unknown> => input !== null && typeof input === "object" && !Array.isArray(input);
const line = (value: unknown, max: number): value is string => typeof value === "string" && Array.from(value).length <= max && !/[\r\n\u2028\u2029\0]/.test(value);
function invalid(): never { throw new ExpectedError("invalid_body", 400); }

export function parseIdeaPost(input: unknown): IdeaPostInput {
  if (!record(input) || !line(input.title, 80) || !input.title.trim()
    || (input.pitch !== undefined && input.pitch !== null && !line(input.pitch, 140))
    || !(IDEA_AREAS as readonly unknown[]).includes(input.area) || typeof input.showAuthor !== "boolean") return invalid();
  return { title: input.title.trim(), pitch: typeof input.pitch === "string" ? input.pitch.trim() || null : null,
    area: input.area as IdeaPostInput["area"], showAuthor: input.showAuthor };
}

export function parseIdeaDecision(input: unknown): IdeaDecisionInput {
  if (!record(input)) return invalid();
  if (input.action === "approve" || input.action === "start") return { action: input.action };
  if (input.action === "done") {
    if (input.note !== undefined && !line(input.note, 140)) return invalid();
    return { action: "done", ...(typeof input.note === "string" ? { note: input.note.trim() } : {}) };
  }
  if (input.action === "decline") {
    if (!line(input.reason, 140) || !input.reason.trim() || (input.line !== undefined && !line(input.line, 140))) return invalid();
    return { action: "decline", reason: input.reason.trim(), ...(typeof input.line === "string" ? { line: input.line.trim() } : {}) };
  }
  return invalid();
}
