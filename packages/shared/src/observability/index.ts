import { consoleAdapter } from "./console-adapter.js";
import { isExpectedError } from "./expected-error.js";
export { ExpectedError, isExpectedError } from "./expected-error.js";
export { redactText, redactEvent } from "./redact.js";

export type ReportContext = { userId?: number; tags?: Record<string, string>; extra?: Record<string, unknown> };
export type LogFields = Record<string, string | number | boolean | null | undefined>;
export interface ObservabilityAdapter {
  report(error: unknown, context: ReportContext): void;
  log(level: "info" | "warn" | "error", message: string, fields: LogFields): void;
  flush(timeoutMs: number): Promise<void>;
}

let adapter: ObservabilityAdapter = consoleAdapter;
export function setObservabilityAdapter(next: ObservabilityAdapter): void { adapter = next; }
export function report(error: unknown, context: ReportContext = {}): void {
  if (isExpectedError(error)) return;
  try { adapter.report(error, context); } catch {}
}
export function log(level: "info" | "warn" | "error", message: string, fields: LogFields = {}): void {
  try { adapter.log(level, message, fields); } catch {}
}
export async function flushObservability(timeoutMs = 2000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([adapter.flush(timeoutMs), new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); })]);
  } catch {} finally { clearTimeout(timer); }
}
export function errorResponseBody(error: unknown): { status: number; body: { error: string } } {
  if (isExpectedError(error)) return { status: error.status, body: { error: error.message } };
  report(error);
  return { status: 500, body: { error: "Something went wrong" } };
}
