import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { releasedDatabaseFiles, type ReleasedDatabaseTree } from "../src/released-database-files.js";
export { releasedDatabaseFiles } from "../src/released-database-files.js";

type Download = (url: string, init?: RequestInit) => Promise<Response>;

async function download(url: string, request: Download, init?: RequestInit): Promise<Response> {
  for (let retry = 0; ; retry++) {
    const response = await request(url, { signal: AbortSignal.timeout(120_000), ...init });
    if (response.ok) return response;
    if (retry === 3 || !(response.status === 403 || response.status === 429 || response.status >= 500)) {
      throw new Error(`Resource download failed (${response.status}): ${url}`);
    }
    const after = response.headers.get("Retry-After");
    const reset = response.headers.get("x-ratelimit-remaining") === "0" ? response.headers.get("x-ratelimit-reset") : null;
    const afterMs = after === null ? 0 : /^\d+(?:\.\d+)?$/.test(after) ? Number(after) * 1_000 : Date.parse(after) - Date.now();
    const resetMs = reset === null ? 0 : Number(reset) * 1_000 - Date.now();
    const delay = Math.min(60_000, Math.max(1_000 * 2 ** retry, Number.isFinite(afterMs) ? afterMs : 0, Number.isFinite(resetMs) ? resetMs : 0));
    await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

export async function discoverReleasedDatabases(commit: string, request: Download = fetch): Promise<string[]> {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const response = await download(`https://api.github.com/repos/ProjectIgnis/BabelCDB/git/trees/${commit}?recursive=1`, request, {
    headers: { "User-Agent": "yugidraft-released-card-data", Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  return releasedDatabaseFiles(await response.json() as ReleasedDatabaseTree);
}

/** Copy the pinned base byte-for-byte, then merge complete data/text pairs in sorted order.
 * INSERT ... SELECT keeps SQLite's signed 64-bit fields out of JavaScript numbers.
 * Ordered input hashes identify the data independently of SQLite's output/version header.
 */
export async function downloadReleasedCardData(commit: string, directory: string, request: Download = fetch) {
  const files = await discoverReleasedDatabases(commit, request);
  await mkdir(directory, { recursive: true });
  const path = join(directory, "cards.cdb");
  const base = await download(`https://raw.githubusercontent.com/ProjectIgnis/BabelCDB/${commit}/cards.cdb`, request);
  const baseBytes = Buffer.from(await base.arrayBuffer());
  const inputRecord = (file: string, bytes: Uint8Array) => `${file}:${createHash("sha256").update(bytes).digest("hex")}`;
  const inputHashes = [inputRecord("cards.cdb", baseBytes)];
  await writeFile(path, baseBytes);
  const releaseCodes = new Set<number>();
  const db = new Database(path);
  try {
    const columns = (table: string) => (db.prepare(`PRAGMA main.table_info(${table})`).all() as Array<{ name: string }>)
      .map(column => `"${column.name.replaceAll('"', '""')}"`).join(", ");
    const dataColumns = columns("datas"), textColumns = columns("texts");
    for (const file of files.slice(1)) {
      const response = await download(`https://raw.githubusercontent.com/ProjectIgnis/BabelCDB/${commit}/${encodeURIComponent(file)}`, request);
      const releasePath = join(directory, file);
      const bytes = Buffer.from(await response.arrayBuffer());
      inputHashes.push(inputRecord(file, bytes));
      await writeFile(releasePath, bytes);
      db.prepare("ATTACH DATABASE ? AS released").run(releasePath);
      try {
        db.transaction(() => {
          db.exec(`INSERT OR REPLACE INTO main.datas (${dataColumns}) SELECT ${dataColumns.split(", ").map(column => `d.${column}`).join(", ")}
            FROM released.datas d JOIN released.texts t USING (id) ORDER BY d.id;
            INSERT OR REPLACE INTO main.texts (${textColumns}) SELECT ${textColumns.split(", ").map(column => `t.${column}`).join(", ")}
            FROM released.texts t JOIN released.datas d USING (id) ORDER BY t.id;`);
        })();
        for (const row of db.prepare("SELECT id FROM released.datas JOIN released.texts USING (id) ORDER BY id").all() as Array<{ id: number }>) releaseCodes.add(row.id);
      } finally {
        db.exec("DETACH DATABASE released");
        await rm(releasePath);
      }
    }
  } finally { db.close(); }
  return { path, files, inputHashes, releaseCodes, bytes: await readFile(path) };
}

/** A released expansion can still have scripts in pre-release/. Keep just its codes;
 * an official copy takes precedence. Root/shared Lua helpers remain available.
 */
export function restrictPrereleaseScripts(scriptRoot: string, releaseCodes: ReadonlySet<number>): void {
  const directory = join(scriptRoot, "pre-release");
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const match = /^c(\d+)\.lua$/.exec(entry.name);
    if (entry.isFile() && match && (!releaseCodes.has(Number(match[1])) || existsSync(join(scriptRoot, "official", entry.name)))) {
      unlinkSync(join(directory, entry.name));
    }
  }
}
