import { readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import type Database from "better-sqlite3";

export function writeDatabaseHeartbeat(db: Database.Database, ready: boolean) {
  if (!ready) { removeDatabaseHeartbeat(db); return; }
  db.prepare(`insert into bot_heartbeat(id,at,pid) values(1,?,?)
    on conflict(id) do update set at=excluded.at,pid=excluded.pid`).run(Date.now(), process.pid);
}
export function removeDatabaseHeartbeat(db: Database.Database) {
  db.prepare("delete from bot_heartbeat where id=1 and pid=?").run(process.pid);
}

export function writeHeartbeat(path: string, state: "ready" | "disabled" | "disconnected") {
  writeFileSync(`${path}.tmp`, JSON.stringify({ pid: process.pid, at: Date.now(), state }), { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}
export function removeHeartbeat(path: string) { rmSync(path, { force: true }); rmSync(`${path}.tmp`, { force: true }); }
export function isHealthy(path: string): boolean {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!Number.isInteger(value.pid) || value.pid <= 0 || !Number.isFinite(value.at)
      || value.at > Date.now() + 5000 || Date.now() - value.at > 120_000
      || !["ready", "disabled"].includes(value.state)) return false;
    process.kill(value.pid, 0);
    return true;
  } catch { return false; }
}
