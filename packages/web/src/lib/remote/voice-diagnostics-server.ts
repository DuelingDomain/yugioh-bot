import { mkdir, open, readdir, lstat, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { RemoteDuelError } from "@yugidraft/shared/remote";
import { resolveDbPath } from "../db";
import type { VoiceRecord } from "./voice-diagnostics";

export const voiceDiagnosticsDir = () => process.env.REMOTE_VOICE_DIAGNOSTICS_DIR?.trim() || join(dirname(resolveDbPath()), "remote-voice-diagnostics");
const maxBytes = () => {
  const value = process.env.REMOTE_VOICE_DIAGNOSTICS_MAX_BYTES?.trim() ?? "", n = Number(value);
  return /^\d+$/.test(value) && Number.isSafeInteger(n) && n > 0 ? n : 200 * 1024 * 1024;
};
const slugPattern = /^[A-Za-z0-9_-]{1,80}$/;
const filePattern = /^\d+-[0-3]\.jsonl$/;
// One writer owns cap accounting as well as appends, including concurrent tabs and users.
let writes: Promise<unknown> = Promise.resolve();
const budgets = new Map<string, { at: number; count: number }>();
export function allowVoiceDiagnostics(userId: number, now = Date.now()) {
  for (const [key, value] of budgets) if (now - value.at >= 60_000) budgets.delete(key);
  const key = String(userId), budget = budgets.get(key) ?? { at: now, count: 0 };
  if (budget.count >= 24 || (!budgets.has(key) && budgets.size >= 4096)) return false;
  budget.count++; budgets.set(key, budget); return true;
}

/** Touch only files this module owns; refuse symlinks, including table folders. */
async function filesUnder(root: string) {
  const files: { path: string; bytes: number; time: number }[] = [];
  for (const table of await readdir(root, { withFileTypes: true })) {
    if (!table.isDirectory() || !slugPattern.test(table.name)) continue;
    for (const file of await readdir(join(root, table.name), { withFileTypes: true })) {
      if (!file.isFile() || !filePattern.test(file.name)) continue;
      const path = join(root, table.name, file.name), info = await lstat(path);
      if (info.isFile()) files.push({ path, bytes: info.size, time: info.mtimeMs });
    }
  }
  return files.sort((a, b) => a.time - b.time || a.path.localeCompare(b.path));
}
export function appendVoiceDiagnostics(input: { slug: string; userId: number; seat: number; records: VoiceRecord[] }) {
  const write = writes.catch(() => undefined).then(async () => {
    const { slug, userId, seat } = input;
    if (!slugPattern.test(slug) || !Number.isSafeInteger(userId) || userId < 1 || !Number.isInteger(seat) || seat < 0 || seat > 3) throw new Error("Invalid diagnostics identity");
    const root = resolve(voiceDiagnosticsDir());
    if (root === resolve(dirname(resolveDbPath()))) throw new Error("Invalid diagnostics folder");
    await mkdir(root, { recursive: true, mode: 0o700 });
    if (!(await lstat(root)).isDirectory()) throw new Error("Invalid diagnostics folder");
    const dir = join(root, slug);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if (!(await lstat(dir)).isDirectory()) throw new Error("Invalid diagnostics table folder");
    const path = join(dir, `${userId}-${seat}.jsonl`);
    const existing = await lstat(path).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (existing && !existing.isFile()) throw new Error("Invalid diagnostics file");
    const serverTime = Date.now(), buildId = process.env.SENTRY_RELEASE?.trim() || process.env.GIT_SHA?.trim() || "unknown";
    const lines = input.records.map(record => JSON.stringify({ ...record, serverTime, userId, seat, tableSlug: slug, buildId })).join("\n") + "\n";
    const bytes = Buffer.byteLength(lines), cap = maxBytes();
    if (bytes > cap) throw new RemoteDuelError("Diagnostics batch exceeds storage cap", 413, "VOICE_STORAGE_CAP");
    const files = await filesUnder(root); let total = files.reduce((n, file) => n + file.bytes, 0);
    for (const file of files) { if (total + bytes <= cap) break; await rm(file.path); total -= file.bytes; }
    const file = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try { await file.appendFile(lines); } finally { await file.close(); }
  });
  writes = write;
  return write;
}
