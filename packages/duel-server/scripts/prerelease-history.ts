import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { GraduationTransition } from "./prerelease-graduations.js";
import { isPrereleaseDatabaseFile, releasedDatabaseFiles } from "../src/released-database-files.js";

export interface CardIdentity {
  code: number; name: string; type: number; alias?: number;
  atk?: number; def?: number; level?: number; attribute?: number; race?: string; description?: string;
}

export const hasDedupeIdentity = (card: CardIdentity) => !card.alias && (card.type & 0x4000) === 0 && !!card.name.trim();

export function cardIdentities(path: string): CardIdentity[] {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const data = new Set((db.prepare("PRAGMA table_info(datas)").all() as { name: string }[]).map(row => row.name));
    const text = new Set((db.prepare("PRAGMA table_info(texts)").all() as { name: string }[]).map(row => row.name));
    const extra = ["atk", "def", "level", "attribute"].filter(column => data.has(column)).map(column => `,d.${column}`).join("")
      + (data.has("race") ? ",CAST(d.race AS TEXT) AS race" : "") + (text.has("desc") ? ",t.desc AS description" : "");
    return db.prepare(`SELECT d.id AS code,t.name,d.type,d.alias${extra} FROM datas d JOIN texts t USING(id)
      WHERE (d.ot & 1536)=0 AND (d.type & 16384)=0 ORDER BY d.id`).all() as CardIdentity[];
  } finally { db.close(); }
}

/** All prerelease identities since support began, including files later deleted.
 * A fresh CI/deploy preparation must yield the same remaps as an incremental one.
 * Read distinct pinned Git blobs, never HEAD's databases. Fail closed on incomplete history.
 */
export async function prereleaseHistory(start: string, commit: string, directory: string): Promise<PrereleaseHistory> {
  if (!/^[a-f0-9]{12,40}$/.test(start) || !/^[a-f0-9]{40}$/.test(commit)) throw new Error("Invalid prerelease history pin");
  const repo = join(directory, "prerelease-history");
  execFileSync("git", ["clone", "--filter=blob:none", "--no-checkout", "--single-branch", "https://github.com/ProjectIgnis/BabelCDB.git", repo], { timeout: 120_000, stdio: "pipe" });
  return readPrereleaseSnapshots(repo, start, commit, join(directory, "historical-cdbs"));
}

export interface PrereleaseHistory { cards: CardIdentity[]; transitions: GraduationTransition[] }

/** Compatibility reader for callers that need only historical identities. */
export async function readPrereleaseHistory(repo: string, start: string, commit: string, directory: string): Promise<CardIdentity[]> {
  return (await readPrereleaseSnapshots(repo, start, commit, directory)).cards;
}

/** Snapshot edges retain the actual commit boundary, including skipped weekly
 * bumps and merged branches. Blob reads are batched; races remain exact strings. */
export async function readPrereleaseSnapshots(repo: string, start: string, commit: string, directory: string): Promise<PrereleaseHistory> {
  const git = (args: string[], input?: string) => execFileSync("git", ["-C", repo, ...args], { input, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  try { git(["cat-file", "-e", `${commit}^{commit}`]); }
  catch { git(["fetch", "origin", commit]); }
  git(["merge-base", "--is-ancestor", start, commit]);
  const commits = git(["rev-list", "--full-history", "--reverse", `${start}..${commit}`, "--", "prerelease-*.cdb"]).toString("utf8").trim().split("\n").filter(Boolean);
  const edges: Array<{ pin: string; parent: string }> = [];
  const pins = new Set([git(["rev-parse", start]).toString("utf8").trim(), ...commits]);
  for (const pin of commits) for (const parent of git(["rev-parse", `${pin}^@`]).toString("utf8").trim().split("\n").filter(Boolean)) {
    try { git(["merge-base", "--is-ancestor", start, parent]); }
    catch { continue; } // Never extend the immutable support boundary backwards.
    pins.add(parent); edges.push({ pin, parent });
  }
  const trees = new Map<string, Map<string, string>>();
  for (const pin of pins) {
    const tree = new Map<string, string>();
    for (const line of git(["ls-tree", pin]).toString("utf8").split("\n")) {
      const match = /^\d+ blob ([a-f0-9]+)\t(.+)$/.exec(line);
      if (match) tree.set(match[2]!, match[1]!);
    }
    trees.set(pin, tree);
  }
  let partial = false;
  try { partial = git(["config", "--get", "remote.origin.promisor"]).toString("utf8").trim() === "true"; }
  catch { /* complete clones have no promisor remote */ }
  const fetched = new Set<string>();
  const fetchBlobs = (blobs: Set<string>) => {
    const needed = [...blobs].filter(blob => !fetched.has(blob)).sort();
    if (partial && needed.length) git(["fetch", "--no-tags", "--no-write-fetch-head", "--stdin", "origin"], needed.join("\n") + "\n");
    needed.forEach(blob => fetched.add(blob));
  };
  fetchBlobs(new Set([...trees.values()].flatMap(tree => [...tree].filter(([file]) => isPrereleaseDatabaseFile(file)).map(([, blob]) => blob))));
  await mkdir(directory, { recursive: true });
  const rows = new Map<string, CardIdentity[]>();
  const readBlob = async (blob: string) => {
    if (!rows.has(blob)) {
      const path = join(directory, `${blob}.cdb`);
      await writeFile(path, git(["cat-file", "blob", blob]));
      rows.set(blob, cardIdentities(path));
    }
    return rows.get(blob)!;
  };
  const previews = new Map<string, CardIdentity[]>(), identities = new Map<string, CardIdentity>();
  for (const [pin, tree] of trees) {
    const snapshot: CardIdentity[] = [];
    for (const [file, blob] of tree) if (isPrereleaseDatabaseFile(file)) snapshot.push(...await readBlob(blob));
    previews.set(pin, snapshot);
    for (const row of snapshot) identities.set(JSON.stringify(row), row);
  }
  const removals = edges.map(edge => ({ ...edge, removed: previews.get(edge.parent)!.filter(row => !previews.get(edge.pin)!.some(next => next.code === row.code)) })).filter(edge => edge.removed.length);
  const releaseFiles = (pin: string) => {
    const tree = trees.get(pin)!;
    if (!tree.has("cards.cdb")) return []; // Minimal isolated test histories.
    return releasedDatabaseFiles({ truncated: false, tree: [...tree].map(([path, sha]) => ({ path, sha, type: "blob" })) }).filter(file => !isPrereleaseDatabaseFile(file));
  };
  fetchBlobs(new Set(removals.flatMap(edge => [edge.parent, edge.pin].flatMap(pin => releaseFiles(pin).map(file => trees.get(pin)!.get(file)!)))));
  const releases = new Map<string, Map<number, CardIdentity>>();
  const releasedAt = async (pin: string) => {
    if (!releases.has(pin)) {
      const snapshot = new Map<number, CardIdentity>();
      for (const file of releaseFiles(pin)) for (const row of await readBlob(trees.get(pin)!.get(file)!)) snapshot.set(row.code, row);
      releases.set(pin, snapshot);
    }
    return releases.get(pin)!;
  };
  const transitions: GraduationTransition[] = [];
  for (const edge of removals) {
    const before = await releasedAt(edge.parent), after = await releasedAt(edge.pin);
    transitions.push({ commit: edge.pin, removed: edge.removed, added: [...after.values()].filter(row => !before.has(row.code)) });
  }
  return { cards: [...identities.values()].sort((a, b) => a.code - b.code || a.name.localeCompare(b.name) || a.type - b.type), transitions };
}
