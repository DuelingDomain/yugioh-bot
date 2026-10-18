import Database from "better-sqlite3";
import { openDatabase } from "@yugidraft/shared/db";
import { isAbsolute, join, resolve } from "path";

// Instrumentation and routes can use separate Next module graphs in one process.
const databaseKey = Symbol.for("yugidraft.web.databases");
const runtime = globalThis as typeof globalThis & { [databaseKey]?: Map<string, Database.Database> };
const databases = runtime[databaseKey] ??= new Map();

export function getDb(): Database.Database {
  const dbPath = resolve(resolveDbPath());
  const current = databases.get(dbPath);
  if (current?.open) return current;
  const db = openDatabase(dbPath);
  databases.set(dbPath, db);
  return db;
}

function resolveDbPath(): string {
  const configuredPath = process.env.DATABASE_PATH;

  if (!configuredPath) {
    return join(process.cwd(), "..", "..", "data", "bot.sqlite");
  }

  if (isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return resolve(process.cwd(), "..", "..", configuredPath);
}
