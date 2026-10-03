// One time-ordered list of everything that happened in a test: every player's browser events, the stack log
// lines, the duel journal answers and the watcher notes. This file has no Playwright import, so `node --test`
// can check it (see tests-unit/).

export type TimelineLevel = "error" | "warn" | "info";
export type TimelineKind = "console" | "page-error" | "request" | "ws" | "stack" | "answer" | "room" | "stall" | "leak" | "test";

export interface TimelineEntry {
  /** Epoch milliseconds. */
  t: number;
  /** ISO text of `t`. */
  at: string;
  /** "p1".."p4", "stack:web", "stack:ws", "stack:duel", "journal", "watcher". */
  source: string;
  kind: TimelineKind;
  level: TimelineLevel;
  /** One line. */
  text: string;
  /** Kept in timeline.json only. */
  data?: Record<string, unknown>;
}

const LINE_MAX = 220;

export function oneLine(text: string, max = LINE_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}...[+${flat.length - max}]` : flat;
}

/** Epoch ms of an ISO text or an SQLite `current_timestamp` value ("2026-09-30 20:19:06", which is UTC). */
export function parseTime(value: string): number {
  const sqlite = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)$/.exec(value);
  return Date.parse(sqlite ? `${sqlite[1]}T${sqlite[2]}Z` : value);
}

/** One line for a Socket.IO or plain WebSocket frame: "42 draft:update {...}". */
export function summariseFrame(payload: string): string {
  const packet = /^(\d+)(.*)$/s.exec(payload);
  if (packet && (packet[1] === "42" || packet[1] === "43") && packet[2]!.startsWith("[")) {
    try {
      const [event, ...rest] = JSON.parse(packet[2]!) as unknown[];
      return oneLine(`${packet[1]} ${String(event)} ${rest.map((item) => JSON.stringify(item)).join(" ")}`);
    } catch {
      // Clipped frame: fall through to the raw text.
    }
  }
  return oneLine(payload);
}

const STACK_ERROR = /\b(error|exception|unhandled|fatal|ECONN\w*|EADDR\w*|panic|crash(ed)?|SIGSEGV|out of memory)\b/i;

export interface StackLine {
  raw: string;
}

/** A stack log line is `<iso> <service> <text>`. */
export function stackEntry(line: string): TimelineEntry | null {
  const match = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) (\S+) (.*)$/.exec(line);
  if (!match) return null;
  const t = Date.parse(match[1]!);
  if (Number.isNaN(t)) return null;
  const isError = STACK_ERROR.test(match[3]!);
  return { t, at: match[1]!, source: `stack:${match[2]}`, kind: "stack", level: isError ? "error" : "info", text: oneLine(match[3]!) };
}

export interface BrowserInput {
  player: string;
  console: Array<{ at: string; type: string; text: string; page: number }>;
  pageErrors: Array<{ at: string; message: string; page: number }>;
  requests: Array<{ at: string; kind: string; method: string; url: string; detail: string; page: number }>;
  frames: Array<{ at: string; event: string; payload?: string; url?: string; socket: number }>;
}

export interface JournalInput {
  slug: string;
  commands: Array<{ seq: number; seat: number; at: string; command: unknown }>;
}

function short(value: unknown): string {
  return oneLine(typeof value === "string" ? value : JSON.stringify(value), 140);
}

export function browserEntries(input: BrowserInput): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const src = input.player;
  for (const item of input.console) {
    const level: TimelineLevel = item.type === "error" ? "error" : item.type === "warning" ? "warn" : "info";
    out.push({ t: Date.parse(item.at), at: item.at, source: src, kind: "console", level, text: `console.${item.type} ${oneLine(item.text)}` });
  }
  for (const item of input.pageErrors) {
    out.push({ t: Date.parse(item.at), at: item.at, source: src, kind: "page-error", level: "error", text: `page error ${oneLine(item.message)}` });
  }
  for (const item of input.requests) {
    // A navigation that the page itself cancels (a prefetch, a reload) is not a fault.
    const aborted = item.detail.includes("ERR_ABORTED");
    out.push({ t: Date.parse(item.at), at: item.at, source: src, kind: "request", level: aborted ? "warn" : "error", text: `${item.kind} ${item.method} ${oneLine(item.url, 100)} ${oneLine(item.detail, 140)}` });
  }
  for (const item of input.frames) {
    const isError = item.event === "error";
    const text = item.payload !== undefined ? `ws#${item.socket} ${item.event} ${summariseFrame(item.payload)}` : `ws#${item.socket} ${item.event}${item.url ? ` ${item.url}` : ""}`;
    out.push({ t: Date.parse(item.at), at: item.at, source: src, kind: "ws", level: isError ? "error" : "info", text });
  }
  return out;
}

export function journalEntries(input: JournalInput): TimelineEntry[] {
  return input.commands.map((entry) => {
    const command = (entry.command ?? {}) as { promptId?: string; revision?: number; answer?: unknown };
    const t = parseTime(entry.at);
    return {
      t,
      at: new Date(t).toISOString(),
      source: "journal",
      kind: "answer" as const,
      level: "info" as const,
      text: `${input.slug} answer #${entry.seq}: seat ${entry.seat} prompt ${command.promptId ?? "?"} revision ${command.revision ?? "?"} answer ${short(command.answer)}`,
      data: { slug: input.slug, seq: entry.seq, seat: entry.seat, promptId: command.promptId, revision: command.revision, answer: command.answer },
    };
  });
}

/**
 * Merges lists into one, oldest first. Ties keep the input order, so a frame and its answer stay in the
 * order they were given. Entries with an unreadable time are dropped.
 */
export function mergeTimeline(...lists: TimelineEntry[][]): TimelineEntry[] {
  const all: Array<{ entry: TimelineEntry; index: number }> = [];
  let index = 0;
  for (const list of lists) for (const entry of list) if (Number.isFinite(entry.t)) all.push({ entry, index: index++ });
  all.sort((a, b) => a.entry.t - b.entry.t || a.index - b.index);
  return all.map((item) => item.entry);
}

export function firstError(entries: TimelineEntry[]): TimelineEntry | null {
  return entries.find((entry) => entry.level === "error") ?? null;
}

/** The last sign that the duel moved: the newest accepted answer, else the newest revision change the watcher saw. */
export function lastProgress(entries: TimelineEntry[]): TimelineEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.kind === "answer" || (entry.kind === "room" && entry.data?.progress === true)) return entry;
  }
  return null;
}

const MD_MAX_LINES = 2500;

function line(entry: TimelineEntry, origin: number): string {
  const ms = String(Math.max(0, entry.t - origin)).padStart(6, " ");
  const mark = entry.level === "error" ? "ERR " : entry.level === "warn" ? "warn" : "    ";
  return `${entry.at.slice(11, 23)} +${ms}ms ${mark} [${entry.source}] ${entry.text}`;
}

/** timeline.md: the first error and the last progress point come first. Frames are dropped first when the list is long. */
export function renderTimelineMarkdown(entries: TimelineEntry[], title: string, options: { testError?: string; maxLines?: number } = {}): string {
  const maxLines = options.maxLines ?? MD_MAX_LINES;
  const origin = entries[0]?.t ?? 0;
  const error = firstError(entries);
  const progress = lastProgress(entries);
  const head = [
    `# Timeline: ${title}`,
    "",
    `First error: ${error ? line(error, origin).trim() : "none"}`,
    ...(options.testError ? [`Test error: ${oneLine(options.testError.split("\n")[0] ?? "", 300)}`] : []),
    `Last progress: ${progress ? line(progress, origin).trim() : "none (no accepted answer and no revision change seen)"}`,
    `Entries: ${entries.length}. Times are UTC. "+N ms" counts from the first entry.`,
    "",
    "```",
  ];
  let shown = entries;
  let dropped = 0;
  if (entries.length > maxLines) {
    let over = entries.length - maxLines;
    const keep = new Set<TimelineEntry>();
    for (const entry of entries) {
      if (entry.kind === "ws" && entry.level !== "error" && over > 0) {
        over -= 1;
        dropped += 1;
      } else keep.add(entry);
    }
    shown = entries.filter((entry) => keep.has(entry));
    if (shown.length > maxLines) shown = shown.slice(-maxLines);
  }
  const body = shown.map((entry) => line(entry, origin));
  if (dropped > 0) body.unshift(`(${dropped} oldest WebSocket lines left out here; timeline.json has them all)`);
  return [...head, ...body, "```", ""].join("\n");
}
