import { readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";

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
