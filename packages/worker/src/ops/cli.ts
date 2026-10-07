import Database from "better-sqlite3";
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "@yugidraft/shared/db";
import { createClerkBackend, type ClerkBackend } from "@yugidraft/shared/clerk";
import { runSeason } from "./season.js";
import { mergeUsers } from "./merge-users.js";
import { precreateUsers } from "./clerk-precreate-users.js";
import { reconcileWaitlist } from "./clerk-reconcile-waitlist.js";
import { defaultReportPath, openReport, OpsError, type OpsContext } from "./report.js";

const help = `Owner operations (dry-run by default; --apply enables writes)
  season status | start [--name <text>] [--actor <usersId>] | end
  merge-users --source <usersId> --target <usersId>
  clerk-precreate-users [--skip-legal-checks] [--check-remote]
  clerk-reconcile-waitlist [--notify | --no-notify] [--check-remote]

All commands: --apply, --report <path>, --help
DATABASE_PATH must be absolute and name an existing database.
season uses DISCORD_GUILD_ID; remote checks/apply require CLERK_SECRET_KEY.
Plain dry-run is offline. --check-remote allows reads, never remote writes.
Reports are created with mode 0600; existing reports are never overwritten.
Default: /app/data/ops-reports/<command>-<utc>.json when that directory exists;
locally: <dirname(DATABASE_PATH)>/ops-reports/<command>-<utc>.json.
Stop writers and revoke the source's Clerk sessions before merge-users --apply.
`;

type Command = "season" | "merge-users" | "clerk-precreate-users" | "clerk-reconcile-waitlist";
function positiveId(value: string | undefined): number {
  if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new OpsError("IDs must be positive safe integers");
  return Number(value);
}

function parse(argv: string[]) {
  const command = argv[0] as Command;
  if (!["season", "merge-users", "clerk-precreate-users", "clerk-reconcile-waitlist"].includes(command)) throw new OpsError("Unknown command; use --help");
  let index = 1;
  const action = command === "season" ? argv[index++] : undefined;
  if (command === "season" && !["status", "start", "end"].includes(action!)) throw new OpsError("Season action must be status, start or end");
  const flags = new Map<string, string | true>();
  const values = new Set(["--report", ...(command === "season" && action === "start" ? ["--name", "--actor"] : []), ...(command === "merge-users" ? ["--source", "--target"] : [])]);
  const switches = new Set(["--apply", ...(command.startsWith("clerk-") ? ["--check-remote"] : []), ...(command === "clerk-precreate-users" ? ["--skip-legal-checks"] : []), ...(command === "clerk-reconcile-waitlist" ? ["--notify", "--no-notify"] : [])]);
  for (; index < argv.length; index++) {
    const flag = argv[index];
    if (flags.has(flag)) throw new OpsError("Duplicate flag");
    if (values.has(flag)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new OpsError("Flag requires a value");
      flags.set(flag, value);
    } else if (switches.has(flag)) flags.set(flag, true);
    else throw new OpsError("Unknown flag or unexpected argument; use --help");
  }
  if (flags.has("--notify") && flags.has("--no-notify")) throw new OpsError("Choose only one notification flag");
  const value = (name: string) => flags.get(name) as string | undefined;
  const source = command === "merge-users" ? positiveId(value("--source")) : undefined;
  const target = command === "merge-users" ? positiveId(value("--target")) : undefined;
  const actor = flags.has("--actor") ? positiveId(value("--actor")) : undefined;
  return { command, action: action as "status" | "start" | "end", source, target, actor,
    name: value("--name"), reportPath: value("--report"), apply: flags.has("--apply"),
    checkRemote: flags.has("--check-remote"), skipLegalChecks: flags.has("--skip-legal-checks"), notify: !flags.has("--no-notify") };
}

export async function runCli(argv: string[], opts: {
  env?: NodeJS.ProcessEnv; backend?: ClerkBackend;
  out?: (message: string) => void; err?: (message: string) => void;
} = {}): Promise<number> {
  const out = opts.out ?? console.log, err = opts.err ?? console.error;
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) { out(help); return 0; }
  if (argv.length >= 2 && ["season", "merge-users", "clerk-precreate-users", "clerk-reconcile-waitlist"].includes(argv[0]) && argv.at(-1) === "--help") { out(help); return 0; }
  let db: Database.Database | undefined;
  let file: ReturnType<typeof openReport> | undefined;
  let command: Command | undefined;
  try {
    const parsed = parse(argv); command = parsed.command;
    const env = opts.env ?? process.env;
    const databasePath = env.DATABASE_PATH;
    if (!databasePath || !isAbsolute(databasePath) || !existsSync(databasePath)) throw new OpsError("DATABASE_PATH must be absolute and name an existing database");
    const reportPath = parsed.reportPath ?? defaultReportPath(command, databasePath);
    file = openReport(reportPath);
    file.write({ command, status: "started", apply: parsed.apply });
    db = parsed.apply ? openDatabase(databasePath) : new Database(databasePath, { readonly: true, fileMustExist: true });
    db.pragma("foreign_keys = on");
    let backend = opts.backend;
    if (command.startsWith("clerk-") && (parsed.apply || parsed.checkRemote) && !backend) {
      if (!env.CLERK_SECRET_KEY) throw new OpsError("CLERK_SECRET_KEY is required for remote checks or apply");
      backend = createClerkBackend({ secretKey: env.CLERK_SECRET_KEY });
    }
    const ctx: OpsContext = { db, ...parsed, guildId: env.DISCORD_GUILD_ID, backend };
    let report: object & { status: string };
    if (command === "season") report = runSeason(ctx, parsed.action, { actor: parsed.actor, name: parsed.name });
    else if (command === "merge-users") {
      out("Stop writers and revoke the source's Clerk sessions before applying this merge");
      report = mergeUsers(ctx, parsed.source!, parsed.target!);
    } else if (command === "clerk-precreate-users") report = await precreateUsers(ctx);
    else report = await reconcileWaitlist(ctx);
    file.write({ command, ...report });
    out(JSON.stringify(report, null, 2));
    out(`Report written: ${reportPath}`);
    return report.status === "failed" ? 1 : 0;
  } catch (error) {
    const report = error instanceof OpsError ? error.report : { status: "failed", message: "Operation failed; inspect the database or report path and retry" };
    out(JSON.stringify(report, null, 2));
    if (file) {
      try { file.write({ command, ...report }); }
      catch { err("Could not finalize the operations report"); }
    }
    err(error instanceof OpsError ? error.message : "Operation failed; inspect the database or report path and retry");
    return 1;
  } finally { db?.close(); file?.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  config({ path: process.env.DOTENV_CONFIG_PATH ?? fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });
  process.exitCode = await runCli(process.argv.slice(2));
}
