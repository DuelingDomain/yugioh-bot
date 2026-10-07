import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import { isPrereleaseDatabaseFile } from "../src/released-database-files.js";

export interface CardIdentity {
  code: number; name: string; type: number; alias?: number;
  atk?: number; def?: number; level?: number; attribute?: number;
}

export const hasDedupeIdentity = (card: CardIdentity) => !card.alias && (card.type & 0x4000) === 0 && !!card.name.trim();

export function cardIdentities(path: string): CardIdentity[] {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return db.prepare("SELECT d.id AS code, t.name, d.type, d.alias FROM datas d JOIN texts t USING(id) WHERE (d.ot & 1536)=0 AND (d.type & 16384)=0 ORDER BY d.id").all() as CardIdentity[];
  } finally { db.close(); }
}

/** All prerelease identities since support began, including files later deleted.
 * A fresh CI/deploy preparation must yield the same remaps as an incremental one.
 * Read distinct pinned Git blobs, never HEAD's databases. Fail closed on incomplete history.
 */
export async function prereleaseHistory(start: string, commit: string, directory: string): Promise<CardIdentity[]> {
  if (!/^[a-f0-9]{12,40}$/.test(start) || !/^[a-f0-9]{40}$/.test(commit)) throw new Error("Invalid prerelease history pin");
  const repo = join(directory, "prerelease-history");
  execFileSync("git", ["clone", "--filter=blob:none", "--no-checkout", "--single-branch", "https://github.com/ProjectIgnis/BabelCDB.git", repo], { timeout: 120_000, stdio: "pipe" });
  return readPrereleaseHistory(repo, start, commit, join(directory, "historical-cdbs"));
}

/** Separate local reader also allows tests to use a real, isolated upstream history. */
export async function readPrereleaseHistory(repo: string, start: string, commit: string, directory: string): Promise<CardIdentity[]> {
  const git = (args: string[], input?: string) => execFileSync("git", ["-C", repo, ...args], { input, timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
  try { git(["cat-file", "-e", `${commit}^{commit}`]); }
  catch { git(["fetch", "origin", commit]); }
  git(["merge-base", "--is-ancestor", start, commit]);
  const commits = [start, ...git(["rev-list", "--full-history", "--reverse", `${start}..${commit}`, "--", "prerelease-*.cdb"]).toString("utf8").trim().split("\n").filter(Boolean)];
  const blobs = new Set<string>();
  for (const pin of commits) {
    for (const line of git(["ls-tree", pin]).toString("utf8").split("\n")) {
      const match = /^\d+ blob ([a-f0-9]+)\t(.+)$/.exec(line);
      if (match && isPrereleaseDatabaseFile(match[2]!)) blobs.add(match[1]!);
    }
  }
  // A filtered clone has every tree but no blobs. Fetch the distinct databases in
  // one pack before cat-file can trigger a separate network request per snapshot.
  // stdin avoids argument-size limits as the history grows; local/full clones need no fetch.
  let partial = false;
  try { partial = git(["config", "--get", "remote.origin.promisor"]).toString("utf8").trim() === "true"; }
  catch { /* Local fixtures and complete clones may have no promisor remote. */ }
  if (partial && blobs.size) git(["fetch", "--no-tags", "--no-write-fetch-head", "--stdin", "origin"], [...blobs].sort().join("\n") + "\n");
  await mkdir(directory, { recursive: true });
  const identities = new Map<string, CardIdentity>();
  for (const blob of [...blobs].sort()) {
    const path = join(directory, `${blob}.cdb`);
    await writeFile(path, git(["cat-file", "blob", blob]));
    for (const row of cardIdentities(path)) identities.set(JSON.stringify(row), row);
  }
  return [...identities.values()].sort((a, b) => a.code - b.code || a.name.localeCompare(b.name) || a.type - b.type);
}
