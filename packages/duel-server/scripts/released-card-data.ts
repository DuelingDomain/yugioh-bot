import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isPrereleaseDatabaseFile, releasedDatabaseFiles, type ReleasedDatabaseTree } from "../src/released-database-files.js";
import { prereleaseHistory, type CardIdentity } from "./prerelease-history.js";
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

export interface PrereleaseDrop extends CardIdentity {
  file: string;
  reason: "released" | "duplicate" | "rush";
  keptCode?: number;
}
interface Row extends CardIdentity { ot: number; alias: number; file: string }
const identity = (card: CardIdentity) => `${card.name.trim().toLowerCase()}\0${card.type}`;
const preferred = (a: Row, b: Row) =>
  Number(a.code >= 100_000_000) - Number(b.code >= 100_000_000) ||
  Number(!/-en\.cdb$/i.test(a.file)) - Number(!/-en\.cdb$/i.test(b.file)) ||
  Number(a.alias !== 0) - Number(b.alias !== 0) || a.code - b.code;

/** Rebuild from pinned inputs. Identity decisions use only small integer fields;
 * INSERT ... SELECT preserves SQLite's 64-bit setcodes/races without JS rounding.
 */
export async function downloadReleasedCardData(commit: string, directory: string, request: Download = fetch,
  options: { historyStart?: string; historicalCards?: CardIdentity[] } = {}) {
  const files = await discoverReleasedDatabases(commit, request);
  await mkdir(directory, { recursive: true });
  const inputs = join(directory, "cdb-inputs");
  await mkdir(inputs, { recursive: true });
  const inputHashes: string[] = [];
  const rows: Row[] = [];
  for (const file of files) {
    const response = await download(`https://raw.githubusercontent.com/ProjectIgnis/BabelCDB/${commit}/${encodeURIComponent(file)}`, request);
    const bytes = Buffer.from(await response.arrayBuffer());
    inputHashes.push(`${file}:${createHash("sha256").update(bytes).digest("hex")}`);
    const path = join(inputs, file);
    await writeFile(path, bytes);
    const db = new Database(path, { readonly: true });
    try {
      rows.push(...(db.prepare("SELECT d.id AS code, d.ot, d.alias, d.type, t.name FROM datas d JOIN texts t USING(id) ORDER BY d.id").all() as Omit<Row, "file">[]).map(row => ({ ...row, file })));
    } finally { db.close(); }
  }
  const released = new Map<number, Row>();
  for (const row of rows) if (!isPrereleaseDatabaseFile(row.file) && (row.ot & 0x600) === 0) released.set(row.code, row);
  const releasedNames = new Map<string, Row[]>();
  for (const row of released.values()) {
    if (!row.name.trim()) continue;
    const group = releasedNames.get(identity(row)) ?? [];
    group.push(row); releasedNames.set(identity(row), group);
  }
  for (const group of releasedNames.values()) group.sort(preferred);
  const previews = rows.filter(row => isPrereleaseDatabaseFile(row.file));
  const kept = new Map<string, Row>();
  const keptIds = new Map<number, Row>();
  const drops: PrereleaseDrop[] = [];
  const remaps: Record<string, number> = {};
  const addRemap = (old: number, target: number) => {
    if (old === target) return;
    if (remaps[old] !== undefined && remaps[old] !== target) throw new Error(`Ambiguous prerelease passcode ${old}`);
    remaps[old] = target;
  };
  for (const row of [...previews].sort(preferred)) {
    const drop = (reason: PrereleaseDrop["reason"], winner?: Row) => {
      drops.push({ code: row.code, name: row.name, type: row.type, file: row.file, reason, ...(winner ? { keptCode: winner.code } : {}) });
      if (winner && row.code !== winner.code && !released.has(row.code)) addRemap(row.code, winner.code);
    };
    if (row.ot & 0x600) { drop("rush"); continue; }
    const official = released.get(row.code) ?? releasedNames.get(identity(row))?.[0];
    if (official) { drop("released", official); continue; }
    const winner = keptIds.get(row.code) ?? kept.get(identity(row));
    if (winner) { drop("duplicate", winner); continue; }
    kept.set(identity(row), row);
    keptIds.set(row.code, row);
  }
  const path = join(directory, "cards.cdb");
  await writeFile(path, await readFile(join(inputs, "cards.cdb")));
  const db = new Database(path);
  const releaseCodes = new Set<number>(), prereleaseCodes = new Set<number>();
  const scriptCodes = new Set<number>();
  try {
    const columns = (table: string) => (db.prepare(`PRAGMA main.table_info(${table})`).all() as Array<{ name: string }>)
      .map(column => `"${column.name.replaceAll('"', '""')}"`).join(", ");
    const dataColumns = columns("datas"), textColumns = columns("texts");
    db.exec("CREATE TEMP TABLE accepted (id INTEGER PRIMARY KEY)");
    for (const file of files.slice(1)) {
      const preview = isPrereleaseDatabaseFile(file);
      const accepted = preview ? [...kept.values()].filter(row => row.file === file) : rows.filter(row => row.file === file && (row.ot & 0x600) === 0);
      const insert = db.prepare("INSERT INTO accepted VALUES (?)");
      db.exec("DELETE FROM accepted");
      for (const row of accepted) insert.run(row.code);
      db.prepare("ATTACH DATABASE ? AS incoming").run(join(inputs, file));
      try {
        db.transaction(() => {
          db.exec(`INSERT OR REPLACE INTO main.datas (${dataColumns}) SELECT ${dataColumns.split(", ").map(column => `d.${column}`).join(", ")}
            FROM incoming.datas d JOIN accepted a ON a.id=d.id ORDER BY d.id;
            INSERT OR REPLACE INTO main.texts (${textColumns}) SELECT ${textColumns.split(", ").map(column => `t.${column}`).join(", ")}
            FROM incoming.texts t JOIN accepted a ON a.id=t.id ORDER BY t.id;`);
          if (preview) db.exec("UPDATE main.datas SET ot=ot|256 WHERE id IN (SELECT id FROM accepted)");
        })();
        for (const row of accepted) (preview ? prereleaseCodes : releaseCodes).add(row.code);
      } finally { db.exec("DETACH DATABASE incoming"); }
    }
    db.exec("DELETE FROM texts WHERE id IN (SELECT id FROM datas WHERE (ot & 1536)!=0); DELETE FROM datas WHERE (ot & 1536)!=0");
    for (const row of db.prepare("SELECT id FROM datas ORDER BY id").all() as { id: number }[]) scriptCodes.add(row.id);
    // A source still present under another identity must never redirect a saved card.
    for (const old of Object.keys(remaps)) if (scriptCodes.has(Number(old))) throw new Error(`Ambiguous retained prerelease passcode ${old}`);
    // Resolve references to artwork variants removed by identity deduplication.
    for (const [old, code] of Object.entries(remaps)) db.prepare("UPDATE datas SET alias=? WHERE alias=?").run(code, Number(old));
  } finally { db.close(); }
  const historical = options.historicalCards ?? (options.historyStart && !commit.startsWith(options.historyStart)
    ? await prereleaseHistory(options.historyStart, commit, directory) : []);
  for (const row of historical) {
    const winner = releasedNames.get(identity(row))?.[0] ?? kept.get(identity(row));
    if (scriptCodes.has(row.code)) {
      const current = released.get(row.code) ?? keptIds.get(row.code);
      if (winner && winner.code !== row.code && current && identity(current) !== identity(row)) {
        throw new Error(`Ambiguous retained historical prerelease passcode ${row.code}`);
      }
      continue;
    }
    if (winner) {
      const existing = remaps[row.code];
      if (existing !== undefined && existing !== winner.code) throw new Error(`Ambiguous historical prerelease passcode ${row.code}`);
      addRemap(row.code, winner.code);
    }
  }
  const prerelease = [...kept.values()].sort((a,b) => a.code-b.code).map(({code,name,type,file}) => ({code,name,type,file}));
  drops.sort((a,b) => a.file.localeCompare(b.file) || a.code-b.code);
  const remapBytes = JSON.stringify({ version: 1, remaps, prerelease, drops }, null, 2) + "\n";
  await writeFile(join(directory, "card-remaps.json"), remapBytes);
  await rm(inputs, { recursive: true });
  return { path, files, inputHashes, releaseCodes, prereleaseCodes: new Set([...prereleaseCodes].sort((a,b)=>a-b)), scriptCodes,
    remaps, remapBytes, prerelease, released: [...released.values()], drops, bytes: await readFile(path) };
}

/** Both released and preview cards can have scripts in pre-release/. Keep loaded codes;
 * an official copy takes precedence. Root/shared Lua helpers remain available.
 */
export function restrictPrereleaseScripts(scriptRoot: string, loadedCodes: ReadonlySet<number>): void {
  const directory = join(scriptRoot, "pre-release");
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const match = /^c(\d+)\.lua$/.exec(entry.name);
    if (entry.isFile() && match && (!loadedCodes.has(Number(match[1])) || existsSync(join(scriptRoot, "official", entry.name)))) {
      unlinkSync(join(directory, entry.name));
    }
  }
}
