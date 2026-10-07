import { closeSync, existsSync, fchmodSync, ftruncateSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import type Database from "better-sqlite3";
import { ClerkBackendError, type ClerkBackend } from "@yugidraft/shared/clerk";

export interface OpsContext {
  db: Database.Database;
  apply: boolean;
  guildId?: string;
  backend?: ClerkBackend;
  checkRemote?: boolean;
  skipLegalChecks?: boolean;
  notify?: boolean;
  sleep?: (ms: number) => Promise<void>;
}

export class OpsError extends Error {
  constructor(message: string, readonly report: object = { status: "failed", message }) { super(message); }
}

export function defaultReportPath(command: string, databasePath: string, now = new Date(), containerDirectoryExists = existsSync("/app/data/ops-reports")): string {
  const directory = containerDirectoryExists ? "/app/data/ops-reports" : join(dirname(databasePath), "ops-reports");
  return join(directory, `${command}-${now.toISOString().replace(/[:.]/g, "-")}.json`);
}

// Reserve an exclusive, private report before any mutations. Keep the descriptor
// so finalization cannot follow a substituted symlink or overwrite another run.
export function openReport(path: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, "wx", 0o600);
  fchmodSync(fd, 0o600);
  return {
    write(report: object) {
      const data = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
      ftruncateSync(fd, 0);
      let written = 0;
      while (written < data.length) written += writeSync(fd, data, written, data.length - written, written);
    },
    close() { closeSync(fd); },
  };
}

export function writeReport(path: string, report: object): void {
  const file = openReport(path);
  try { file.write(report); } finally { file.close(); }
}

export async function withRateLimit<T>(ctx: OpsContext, call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await call(); }
    catch (error) {
      if (!(error instanceof ClerkBackendError) || error.status !== 429 || attempt === 3) throw error;
      await (ctx.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(error.retryAfterMs ?? 2000);
    }
  }
}

export interface Outcome { userId?: number; signupId?: number; outcome: string; }
export function outcomeReport(apply: boolean) {
  const report = { status: apply ? "applied" : "dry-run", counts: {} as Record<string, number>, outcomes: [] as Outcome[] };
  return {
    report,
    add(outcome: Outcome) {
      report.outcomes.push(outcome);
      report.counts[outcome.outcome] = (report.counts[outcome.outcome] ?? 0) + 1;
      if (outcome.outcome === "error" || outcome.outcome === "conflict") report.status = "failed";
    },
  };
}
