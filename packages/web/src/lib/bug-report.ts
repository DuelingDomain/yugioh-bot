/**
 * In-app bug reports: the request shape, its strict validation, the text sanitizing and the GitHub issue text.
 * Pure (no Node or React imports) so the browser and the route share it.
 *
 * Privacy: the GitHub repo is public. An issue only ever holds fields this file lists, the public log lines and the
 * report id. It never holds a hand, a Discord id or name, an email or the guild id. `buildIssueBody` takes the values
 * it must scrub as a last line of defence (`redact`).
 */

export const BUG_TEXT_MAX = 4000;
export const BUG_LOG_LINES = 15;
const LOG_LINE_MAX = 200;
const ZERO_WIDTH = "\u200b";

export const BUG_FORMATS = ["1v1", "ffa3", "ffa4", "tag"] as const;
export const BUG_DUEL_MODES = ["normal", "domain"] as const;

export type BugFormat = (typeof BUG_FORMATS)[number];

/** What the browser sends alongside the text. Everything here is public duel information or browser data. */
export interface BugReportContext {
  format?: BugFormat;
  duelMode?: (typeof BUG_DUEL_MODES)[number];
  /** The reporter's seat (0-based), or null for a spectator. */
  seat?: number | null;
  turn?: number;
  phase?: string;
  turnSeat?: number | null;
  livingPlayers?: number;
  animationSpeed?: number;
  /** The last public log lines, oldest first. */
  log?: string[];
  userAgent?: string;
  viewport?: { width: number; height: number };
  timestamp?: string;
}

export interface BugReportRequest {
  description: string;
  expected: string;
  /** Page path only, no query or hash. */
  path: string;
  duelSlug?: string;
  context: BugReportContext;
  /** The open from-app issue number the player says is the same bug. The report joins it instead of opening an issue. */
  duplicateOf?: number;
}

export type BugTextField = "description" | "expected";
export type BugFieldErrors = Partial<Record<BugTextField, string>>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string; fieldErrors?: BugFieldErrors };

export const BUG_DESCRIPTION_MIN_CHARS = 20;
export const BUG_DESCRIPTION_MIN_WORDS = 4;
export const BUG_EXPECTED_MIN_CHARS = 10;

function wordCount(text: string): number {
  return (text.match(/\S+/g) ?? []).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/**
 * The quality rules for the two text fields, shared by the dialog (inline messages) and the routes (400 with the same
 * messages). Both fields are required. Returns an empty object when the text is good enough to send.
 */
export function validateBugText(input: { description?: unknown; expected?: unknown }): BugFieldErrors {
  const errors: BugFieldErrors = {};
  const description = typeof input.description === "string" ? limitText(input.description) : "";
  if (!description) errors.description = "Tell us what went wrong.";
  else if (description.length < BUG_DESCRIPTION_MIN_CHARS || wordCount(description) < BUG_DESCRIPTION_MIN_WORDS) {
    errors.description = `Write a bit more: at least ${BUG_DESCRIPTION_MIN_CHARS} characters and ${BUG_DESCRIPTION_MIN_WORDS} words, so the team can find the problem.`;
  }
  const expected = typeof input.expected === "string" ? limitText(input.expected) : "";
  if (!expected) errors.expected = "Tell us what you expected to happen.";
  else if (expected.length < BUG_EXPECTED_MIN_CHARS) errors.expected = `Write a bit more: at least ${BUG_EXPECTED_MIN_CHARS} characters.`;
  return errors;
}

const CONTEXT_KEYS = new Set([
  "format", "duelMode", "seat", "turn", "phase", "turnSeat", "livingPlayers", "animationSpeed", "log", "userAgent", "viewport", "timestamp",
]);
const REQUEST_KEYS = new Set(["description", "expected", "path", "duelSlug", "context", "duplicateOf"]);

/** Strips control characters and unpaired formatting noise; keeps newlines and tabs. */
function clean(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\u200b/g, "");
}

/** Cleaned, trimmed and capped. This is what the database keeps. */
export function limitText(text: string, max = BUG_TEXT_MAX): string {
  return clean(text).trim().slice(0, max);
}

/**
 * Text that is safe to put in a public issue: @mentions and "#123" references no longer notify or link anything
 * (a zero-width space breaks them), and it is capped. Markdown is neutralized by `fence`, not here.
 */
export function sanitizeText(text: string, max = BUG_TEXT_MAX): string {
  const body = limitText(text, max);
  return body.replace(/@/g, `@${ZERO_WIDTH}`).replace(/#(?=\d)/g, `#${ZERO_WIDTH}`);
}

/** One line, mentions neutralized, markdown left alone: for text that goes inside a code fence or a code span. */
export function sanitizeLine(text: string, max: number): string {
  const line = sanitizeText(text.replace(/\s+/g, " "), max);
  return line;
}

/** A single line with no markdown control characters, for a title. */
export function sanitizeInline(text: string, max: number): string {
  const line = sanitizeText(clean(text).replace(/\s+/g, " "), max * 2)
    .replace(/[`*_~|<>[\]\\]/g, "")
    .trim();
  return line.length > max ? `${line.slice(0, Math.max(0, max - 1)).trimEnd()}…` : line;
}

/** A fenced code block longer than any backtick run inside, so the text cannot break out of it. */
export function fence(text: string, language = "text"): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return `${ticks}${language}\n${text}\n${ticks}`;
}

/**
 * Keeps only the log lines every player at the table sees. The engine log a player receives also holds lines meant for
 * that player alone: "You added X to your hand", "X returned to your hand", "Confirmed X", and the card name of a
 * face-down summon (it follows the public "... a face-down monster" line). The client cannot tell them apart by a flag,
 * so this drops those shapes. The route runs it again on whatever the browser sent.
 */
export function publicLogLines(lines: readonly string[]): string[] {
  const out: string[] = [];
  let hiddenPrefix: string | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const faceDown = /^(.*? (?:Normal|Special|Flip) Summons) a face-down monster$/.exec(line);
    if (faceDown) {
      out.push(line);
      hiddenPrefix = faceDown[1]!;
      continue;
    }
    const prefix = hiddenPrefix;
    hiddenPrefix = null;
    if (prefix && line.startsWith(`${prefix} `)) continue;
    if (/^You /.test(line) || /\bto your hand$/.test(line) || /^Confirmed\b/.test(line)) continue;
    out.push(line);
  }
  return out;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function intIn(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function parseContext(raw: unknown): ParseResult<BugReportContext> {
  if (raw === undefined) return { ok: true, value: {} };
  if (!isObject(raw)) return { ok: false, error: "context must be an object" };
  for (const key of Object.keys(raw)) if (!CONTEXT_KEYS.has(key)) return { ok: false, error: `Unknown context field: ${key.slice(0, 40)}` };
  const out: BugReportContext = {};
  if (raw.format !== undefined) {
    if (!(BUG_FORMATS as readonly unknown[]).includes(raw.format)) return { ok: false, error: "context.format is not valid" };
    out.format = raw.format as BugFormat;
  }
  if (raw.duelMode !== undefined) {
    if (!(BUG_DUEL_MODES as readonly unknown[]).includes(raw.duelMode)) return { ok: false, error: "context.duelMode is not valid" };
    out.duelMode = raw.duelMode as (typeof BUG_DUEL_MODES)[number];
  }
  for (const key of ["seat", "turnSeat"] as const) {
    if (raw[key] === undefined) continue;
    if (raw[key] === null) out[key] = null;
    else {
      const n = intIn(raw[key], 0, 7);
      if (n === null) return { ok: false, error: `context.${key} is not valid` };
      out[key] = n;
    }
  }
  if (raw.turn !== undefined) {
    const n = intIn(raw.turn, 0, 100000);
    if (n === null) return { ok: false, error: "context.turn is not valid" };
    out.turn = n;
  }
  if (raw.livingPlayers !== undefined) {
    const n = intIn(raw.livingPlayers, 0, 8);
    if (n === null) return { ok: false, error: "context.livingPlayers is not valid" };
    out.livingPlayers = n;
  }
  if (raw.phase !== undefined) {
    if (typeof raw.phase !== "string" || raw.phase.length > 60) return { ok: false, error: "context.phase is not valid" };
    out.phase = sanitizeLine(raw.phase, 60);
  }
  if (raw.animationSpeed !== undefined) {
    if (typeof raw.animationSpeed !== "number" || !Number.isFinite(raw.animationSpeed) || raw.animationSpeed < 0 || raw.animationSpeed > 10) {
      return { ok: false, error: "context.animationSpeed is not valid" };
    }
    out.animationSpeed = raw.animationSpeed;
  }
  if (raw.userAgent !== undefined) {
    if (typeof raw.userAgent !== "string") return { ok: false, error: "context.userAgent is not valid" };
    out.userAgent = sanitizeLine(raw.userAgent, 300);
  }
  if (raw.timestamp !== undefined) {
    if (typeof raw.timestamp !== "string" || Number.isNaN(Date.parse(raw.timestamp))) return { ok: false, error: "context.timestamp is not valid" };
    out.timestamp = new Date(raw.timestamp).toISOString();
  }
  if (raw.viewport !== undefined) {
    const v = raw.viewport;
    const width = isObject(v) ? intIn(v.width, 0, 20000) : null;
    const height = isObject(v) ? intIn(v.height, 0, 20000) : null;
    if (!isObject(v) || width === null || height === null || Object.keys(v).length !== 2) return { ok: false, error: "context.viewport is not valid" };
    out.viewport = { width, height };
  }
  if (raw.log !== undefined) {
    if (!Array.isArray(raw.log) || raw.log.length > 200 || raw.log.some((line) => typeof line !== "string")) {
      return { ok: false, error: "context.log must be a list of text lines" };
    }
    out.log = publicLogLines((raw.log as string[]).map((line) => clean(line).slice(0, LOG_LINE_MAX * 2)))
      .slice(-BUG_LOG_LINES)
      .map((line) => sanitizeLine(line, LOG_LINE_MAX));
  }
  return { ok: true, value: out };
}

/** The page path a report may name: one local path, no query, no hash. */
function parsePath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 200) return null;
  const path = raw.split(/[?#]/)[0]!;
  return /^\/[A-Za-z0-9/_\-.[\]]*$/.test(path) && !path.includes("//") ? path : null;
}

/** Strict validation of the POST body. Unknown fields are refused, not ignored. */
export function parseBugReportRequest(raw: unknown): ParseResult<BugReportRequest> {
  if (!isObject(raw)) return { ok: false, error: "Body must be a JSON object" };
  for (const key of Object.keys(raw)) if (!REQUEST_KEYS.has(key)) return { ok: false, error: `Unknown field: ${key.slice(0, 40)}` };
  if (typeof raw.description !== "string") return { ok: false, error: "Tell us what went wrong", fieldErrors: { description: "Tell us what went wrong." } };
  if (raw.description.length > BUG_TEXT_MAX * 2) return { ok: false, error: "The description is too long" };
  if (raw.expected !== undefined && raw.expected !== null && (typeof raw.expected !== "string" || raw.expected.length > BUG_TEXT_MAX * 2)) {
    return { ok: false, error: "The expected text is not valid" };
  }
  const fieldErrors = validateBugText({ description: raw.description, expected: raw.expected });
  if (fieldErrors.description || fieldErrors.expected) {
    return { ok: false, error: fieldErrors.description ?? fieldErrors.expected ?? "The report is not valid", fieldErrors };
  }
  const description = limitText(raw.description);
  const expected = limitText(raw.expected as string);
  let duplicateOf: number | undefined;
  if (raw.duplicateOf !== undefined && raw.duplicateOf !== null) {
    const n = intIn(raw.duplicateOf, 1, 1_000_000_000);
    if (n === null) return { ok: false, error: "duplicateOf is not valid" };
    duplicateOf = n;
  }
  const path = parsePath(raw.path);
  if (!path) return { ok: false, error: "path is not valid" };
  let duelSlug: string | undefined;
  if (raw.duelSlug !== undefined && raw.duelSlug !== null) {
    if (typeof raw.duelSlug !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(raw.duelSlug)) return { ok: false, error: "duelSlug is not valid" };
    duelSlug = raw.duelSlug;
  }
  const context = parseContext(raw.context);
  if (!context.ok) return context;
  return { ok: true, value: { description, expected, path, ...(duelSlug ? { duelSlug } : {}), context: context.value, ...(duplicateOf ? { duplicateOf } : {}) } };
}

const FORMAT_TAG: Record<BugFormat, string> = { "1v1": "1v1", ffa3: "FFA3", ffa4: "FFA4", tag: "Tag" };
const FORMAT_TEXT: Record<BugFormat, string> = { "1v1": "1v1", ffa3: "3-player FFA", ffa4: "4-player FFA", tag: "Tag 2v2" };

/** Removes every occurrence of the given private values (Discord id, display name, guild id). Values under 3 characters are skipped. */
export function redactText(text: string, redact: readonly string[]): string {
  let out = text;
  for (const secret of redact) {
    const value = secret.trim();
    if (value.length >= 3) out = out.split(value).join("[removed]");
  }
  return out;
}

export function issueTitle(description: string, context: BugReportContext): string {
  const tag = context.format ? ` [${FORMAT_TAG[context.format]}]` : "";
  return `[Bug]${tag} ${sanitizeInline(description, 70) || "Bug report"}`;
}

export interface IssueBodyInput {
  reportId: number;
  description: string;
  expected?: string | null;
  path: string;
  duelSlug?: string | null;
  context: BugReportContext;
  /** Public web base URL, no trailing slash. Without it the issue has no replay link. */
  baseUrl?: string;
}

const cell = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === "" ? "-" : `\`${sanitizeLine(String(value), 300).replace(/`/g, "").replace(/\|/g, "\\|")}\``;

/**
 * The public issue text. `redact` holds values that must never appear (Discord id, display name, guild id): any
 * occurrence in the finished text is removed, whatever field it came from.
 */
export function buildIssueBody(input: IssueBodyInput, redact: readonly string[] = []): string {
  const sections = reportSections(input);
  sections.push("---", `\`Report #${input.reportId}\` · sent from the in-app Report bug button`);
  return redactText(sections.join("\n\n"), redact);
}

/**
 * The text of a +1 comment on an issue another report opened: the same privacy-safe sections as an issue body, under a
 * first line that names the report. No new issue is made.
 */
export function buildCommentBody(input: IssueBodyInput, redact: readonly string[] = []): string {
  const sections = [`**+1** from \`Report #${input.reportId}\`: another player hit the same bug.`, ...reportSections(input)];
  sections.push("---", `\`Report #${input.reportId}\` · sent from the in-app Report bug button`);
  return redactText(sections.join("\n\n"), redact);
}

function reportSections(input: IssueBodyInput): string[] {
  const { context } = input;
  const seat = context.seat === undefined ? undefined : context.seat === null ? "spectator" : `seat ${context.seat + 1}`;
  const rows: Array<[string, string]> = [
    ["Page", cell(input.path)],
    ["Duel", cell(input.duelSlug)],
    ["Format", cell(context.format ? FORMAT_TEXT[context.format] : undefined)],
    ["Rules", cell(context.duelMode)],
    ["Reporter seat", cell(seat)],
    ["Turn", cell(context.turn)],
    ["Phase", cell(context.phase)],
    ["Turn of", cell(context.turnSeat === undefined ? undefined : context.turnSeat === null ? "none" : `seat ${context.turnSeat + 1}`)],
    ["Players alive", cell(context.livingPlayers)],
    ["Animation speed", cell(context.animationSpeed === undefined ? undefined : `${context.animationSpeed}x`)],
    ["Viewport", cell(context.viewport ? `${context.viewport.width}x${context.viewport.height}` : undefined)],
    ["Browser", cell(context.userAgent)],
    ["Sent at", cell(context.timestamp)],
  ];
  const table = ["| Field | Value |", "| --- | --- |", ...rows.filter(([, value]) => value !== "-").map(([key, value]) => `| ${key} | ${value} |`)].join("\n");
  const log = publicLogLines(context.log ?? []).slice(-BUG_LOG_LINES).map((line) => sanitizeLine(line, LOG_LINE_MAX));
  const sections = [
    "## Description",
    fence(sanitizeText(input.description)),
    "## Expected",
    input.expected ? fence(sanitizeText(input.expected)) : "_Not given._",
    "## Context",
    table,
    "## Recent log",
    log.length ? fence(log.join("\n")) : "_No duel log._",
  ];
  if (input.duelSlug && input.baseUrl) {
    sections.push("## Replay", `${input.baseUrl}/duels/${encodeURIComponent(input.duelSlug)}/replay (sign-in needed)`);
  }
  return sections;
}
