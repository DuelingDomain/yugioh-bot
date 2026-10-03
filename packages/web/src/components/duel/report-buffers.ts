/**
 * Client-side ring buffers for the dev report (DUEL_SCENARIOS=1). No dependency.
 * Installed once per page load by `installReportCapture()`. Safe to call many times.
 */

export const MAX_FRAMES = 200;
export const MAX_CLICKS = 20;
export const MAX_CONSOLE = 50;
export const MAX_MARKS = 100;
const MAX_TEXT = 500;

export class Ring<T> {
  private items: T[] = [];
  constructor(readonly capacity: number) {}
  push(item: T) {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
  }
  snapshot(): T[] { return this.items.slice(); }
  clear() { this.items = []; }
  get size() { return this.items.length; }
}

export interface FrameEntry { t: string; dir: "in" | "out"; data: string }
export interface ClickEntry { t: string; tag: string; label: string; testId?: string }
export interface ConsoleEntry { t: string; level: "error" | "warn"; text: string }
export interface MarkEntry { t: string; text: string }
export interface ChecklistResult { t: string; presetId: string; item: string; result: "pass" | "fail" }

export const frames = new Ring<FrameEntry>(MAX_FRAMES);
export const clicks = new Ring<ClickEntry>(MAX_CLICKS);
export const consoleErrors = new Ring<ConsoleEntry>(MAX_CONSOLE);
export const marks = new Ring<MarkEntry>(MAX_MARKS);
export const checklistResults = new Ring<ChecklistResult>(MAX_MARKS);

const now = () => new Date().toISOString();
const clip = (s: string, n = MAX_TEXT) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function recordFrame(dir: "in" | "out", data: unknown) {
  frames.push({ t: now(), dir, data: clip(typeof data === "string" ? data : `[${Object.prototype.toString.call(data)}]`, 2000) });
}

export function recordClick(target: EventTarget | null) {
  const el = target instanceof Element ? (target.closest("button,a,[role=button],input,select,summary") ?? target) : null;
  if (!el) return;
  const label = el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().replace(/\s+/g, " ");
  const testId = el.getAttribute("data-testid") ?? undefined;
  clicks.push({ t: now(), tag: el.tagName.toLowerCase(), label: clip(label, 80), ...(testId ? { testId } : {}) });
}

export function addMark(text = "mark"): MarkEntry {
  const mark = { t: now(), text: clip(text, 200) };
  marks.push(mark);
  return mark;
}

export function addChecklistResult(presetId: string, item: string, result: "pass" | "fail"): ChecklistResult {
  const entry = { t: now(), presetId, item: clip(item, 300), result };
  checklistResults.push(entry);
  return entry;
}

/** True when a key press is typing into a field. The "M" mark key must ignore it. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Stable short signature of an error, to report each one once per page load. */
export function errorSignature(message: string, source?: string | null, line?: number | null): string {
  return `${message.slice(0, 200)}|${source ?? ""}|${line ?? ""}`;
}

let installed = false;

/** Wraps console.error/warn, window.WebSocket and listens for clicks. Idempotent. Returns nothing to undo: page lifetime. */
export function installReportCapture() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  document.addEventListener("click", (e) => recordClick(e.target), true);
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        consoleErrors.push({ t: now(), level, text: clip(args.map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === "string" ? a : safeJson(a))).join(" "), 1000) });
      } catch { /* never break the page */ }
      original(...args);
    };
  }
  const Native = window.WebSocket;
  if (typeof Native === "function") {
    const Wrapped = function (this: unknown, url: string | URL, protocols?: string | string[]) {
      const ws = protocols === undefined ? new Native(url) : new Native(url, protocols);
      try {
        ws.addEventListener("message", (ev) => recordFrame("in", (ev as MessageEvent).data));
        const send = ws.send.bind(ws);
        ws.send = (data: Parameters<WebSocket["send"]>[0]) => { recordFrame("out", data); send(data); };
      } catch { /* ignore */ }
      return ws;
    } as unknown as typeof WebSocket;
    Wrapped.prototype = Native.prototype;
    Object.assign(Wrapped, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    window.WebSocket = Wrapped;
  }
}

function safeJson(v: unknown): string {
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
}

export function snapshotBuffers() {
  return {
    frames: frames.snapshot(),
    clicks: clicks.snapshot(),
    consoleErrors: consoleErrors.snapshot(),
    marks: marks.snapshot(),
    checklistResults: checklistResults.snapshot(),
  };
}
