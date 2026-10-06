/** Weekly card-data updates only. Core, Lua, WASM and toolchain pins are never advanced here. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import Database from "better-sqlite3";
import { listIndex, scanText, stripComments } from "./scan-multiplayer-scripts.js";

export type Pins = { scripts: string; database: string; strings: string };
const repositories: Record<keyof Pins, string> = { scripts: "CardScripts", database: "BabelCDB", strings: "Distribution" };
const keys = Object.keys(repositories) as (keyof Pins)[];
const packagePath = "packages/duel-server";
const preparePath = `${packagePath}/scripts/prepare-data.ts`;
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const official = (path: string) => /^official\/c\d+\.lua$/.test(path);
const codeOf = (path: string) => Number(/c(\d+)\.lua$/.exec(path)?.[1]);
const sorted = (paths: string[]) => paths.sort((a, b) => codeOf(a) - codeOf(b));
const markdown = (value: string) => value.replace(/[\\`*_{}\[\]<>|]/g, "\\$&").replace(/[\r\n]+/g, " ");

export async function readPins(root: string): Promise<Pins> {
  const text = await readFile(join(root, preparePath), "utf8");
  return Object.fromEntries(keys.map((key) => {
    const value = new RegExp(`["']?${key}["']?\\s*:\\s*["']([a-f0-9]{40})["']`).exec(text)?.[1];
    if (!value) throw new Error(`Missing ${key} pin in ${preparePath}`);
    return [key, value];
  })) as Pins;
}

export function diffScripts(oldTree: Map<string, string>, newTree: Map<string, string>) {
  return {
    added: sorted([...newTree.keys()].filter((p) => official(p) && !oldTree.has(p))),
    changed: sorted([...newTree.keys()].filter((p) => official(p) && oldTree.has(p) && oldTree.get(p) !== newTree.get(p))),
    removed: sorted([...oldTree.keys()].filter((p) => official(p) && !newTree.has(p))),
  };
}

type OverlayCard = { code: number; file: string; name?: string; stockSha256?: string };
export function detectOverlayConflicts(cards: OverlayCard[], stock: Map<string, string>) {
  return cards.flatMap((card) => {
    const text = stock.get(`official/${card.file}`) ?? [...stock].find(([path]) => path === card.file || path.endsWith(`/${card.file}`))?.[1];
    const actualSha256 = text === undefined ? null : sha256(text);
    return actualSha256 === card.stockSha256 ? [] : [{ ...card, actualSha256 }];
  });
}

export function findNewRisks(stock: Map<string, string>, paths: string[], listed = new Set(listIndex().keys())) {
  return paths.filter(official).map((path) => scanText(codeOf(path), stock.get(path)!))
    .filter((card) => card.flagged && !listed.has(card.code));
}

/** Search tracked text, including hidden workflows, CI and checksum comments, rather than maintaining a second file list. */
export async function rewritePins(root: string, old: Pins, next: Pins, dryRun: boolean): Promise<string[]> {
  const replacements = new Map(keys.filter((key) => old[key] !== next[key]).map((key) => [old[key], next[key]]));
  if (!replacements.size) return [];
  const pattern = new RegExp(`\\b(?:${[...replacements.keys()].join("|")})\\b`, "g");
  const paths = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const changes: { path: string; content: string }[] = [];
  for (const path of paths) {
    const bytes = await readFile(join(root, path));
    if (bytes.includes(0)) continue;
    const original = bytes.toString("utf8");
    const content = original.replace(pattern, (sha) => replacements.get(sha)!);
    if (original === content) continue;
    if (/^(?:\.agents\/|\.worktrees\/|\.env$|skills-lock\.json$|packages\/web\/next-env\.d\.ts$)/.test(path)) {
      throw new Error(`Refusing to rewrite protected file ${path}`);
    }
    // Guard the rules-core records even if a future pin accidentally shares a data SHA.
    if (path.endsWith("/pins.json")) {
      const { cardScripts: _before, ...before } = JSON.parse(original);
      const { cardScripts: _after, ...after } = JSON.parse(content);
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`Refusing to change rules-core pins in ${path}`);
    }
    changes.push({ path, content });
  }
  if (!dryRun) for (const change of changes) await writeFile(join(root, change.path), change.content);
  return changes.map(({ path }) => path);
}

type Options = {
  root?: string;
  overrides?: Partial<Pins>;
  dryRun?: boolean;
  report?: string;
  request?: typeof fetch;
  token?: string;
};
type Tree = { truncated: boolean; tree: { path: string; type: string; sha: string }[] };

export async function checkCoreCompatibility(root: string, changedLua: Map<string, string>, stock: Map<string, string>): Promise<string[]> {
  const pins = JSON.parse(await readFile(join(root, packagePath, "domain-core/pins.json"), "utf8"));
  const commit = pins.ygoproCore.commit as string;
  const caches = ["domain-core/.build/ygopro-core", "domain-core/.build/ocgcore-wasm/cpp/ygo"];
  for (const cache of caches) {
    const directory = join(root, packagePath, cache);
    if (!existsSync(directory)) continue;
    try {
      const exported = new Set<string>();
      for (const [owner, file] of [["Duel", "libduel.cpp"], ["Card", "libcard.cpp"], ["Effect", "libeffect.cpp"]]) {
        const source = execFileSync("git", ["-C", directory, "show", `${commit}:${file}`], {
          encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000,
          env: { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" },
        });
        const names = [...source.matchAll(/\{\s*"(\w+)"\s*,|LUA_(?:STATIC_)?FUNCTION(?:_ALIAS)?\s*\(\s*(\w+)/g)].map((m) => m[1] ?? m[2]);
        if (!names.length) throw new Error(`No registrations recognized in ${file}`);
        for (const name of names) exported.add(`${owner}.${name}`);
      }
      // Lua helpers also extend these tables; they do not require a new C++ export.
      for (const source of stock.values()) {
        for (const match of stripComments(source).matchAll(/(?:function\s+)?\b((?:Duel|Card|Effect)\.\w+)\s*(?:=|\()/g)) {
          if (/^function\s/.test(match[0]) || /=\s*$/.test(match[0])) exported.add(match[1]);
        }
      }
      const missing = new Map<string, string[]>();
      for (const [path, source] of changedLua) {
        for (const match of stripComments(source).matchAll(/\b((?:Duel|Card|Effect)\.\w+)/g)) {
          if (!exported.has(match[1])) missing.set(match[1], [...new Set([...(missing.get(match[1]) ?? []), path])]);
        }
      }
      return [
        `Best effort: checked Duel./Card./Effect. names against offline core \`${commit}\` and candidate Lua helpers. Global constants and colon-method calls are not checked. This is not a compatibility guarantee.`,
        ...[...missing].sort().map(([name, files]) => `- **may need a newer core**: \`${name}\` (${files.map((p) => `\`${p}\``).join(", ")})`),
        ...(missing.size ? [] : ["No missing names found in the checked subset."]),
      ];
    } catch {
      // Build caches are optional. Never fetch or advance a core as part of a data update.
    }
  }
  return [`Skipped core API/constant check: pinned core \`${commit}\` sources/registrations are not available in the local build caches. Changed Lua **may need a newer core**; review upstream changes manually. Rules-core pins remain unchanged.`];
}

export async function runUpdate(options: Options = {}) {
  const root = resolve(options.root ?? repoRoot);
  const reportPath = resolve(root, options.report ?? ".status/engine-data-update.md");
  const overrides = options.overrides ?? {};
  for (const [key, sha] of Object.entries(overrides)) {
    if (!/^[a-fA-F0-9]{40}$/.test(sha)) throw new Error(`--${key} must be a full 40-character hexadecimal commit SHA`);
  }
  const old = await readPins(root);
  for (const pinFile of ["domain-core/pins.json", "legacy-1v1/domain-core/pins.json"]) {
    const pins = JSON.parse(await readFile(join(root, packagePath, pinFile), "utf8"));
    if (pins.cardScripts.commit !== old.scripts) throw new Error(`CardScripts pin out of sync: ${pinFile}`);
  }
  const request = options.request ?? fetch;
  const token = options.token ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  async function download(url: string) {
    const headers: Record<string, string> = { "User-Agent": "yugidraft-engine-data-update" };
    if (new URL(url).hostname === "api.github.com") {
      headers.Accept = "application/vnd.github+json";
      headers["X-GitHub-Api-Version"] = "2022-11-28";
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const response = await request(url, { headers, signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
    return response;
  }
  const api = async <T>(path: string): Promise<T> => (await download(`https://api.github.com/repos/ProjectIgnis/${path}`)).json() as Promise<T>;
  const next = Object.fromEntries(await Promise.all(keys.map(async (key) => {
    const sha = overrides[key]?.toLowerCase() ?? (await api<{ sha: string }[]>(`${repositories[key]}/commits?per_page=1`))[0]?.sha;
    if (!sha || !/^[a-f0-9]{40}$/.test(sha)) throw new Error(`Invalid upstream ${key} commit`);
    return [key, sha];
  }))) as Pins;
  const changed = keys.some((key) => old[key] !== next[key]);
  const report = ["# Project Ignis engine data update", "", `Mode: ${options.dryRun ? "dry run (pins unchanged)" : "update"}. Rules core, ocgcore-wasm, Lua and Emscripten pins remain unchanged.`, ""];
  async function saveReport() {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, report.join("\n") + "\n");
  }
  if (!changed) {
    report.push("no update: all three data pins already match the requested commits.");
    await saveReport();
    console.log("no update");
    return { changed, next, reportPath, files: [] as string[] };
  }
  report.push("| Repository | Old → new | Commits ahead |", "| --- | --- | --- |");
  for (const key of keys) {
    const repo = repositories[key];
    const comparison = old[key] === next[key] ? null : await api<{ ahead_by: number; behind_by: number; status: string }>(`${repo}/compare/${old[key]}...${next[key]}?per_page=1`);
    report.push(`| ${repo} | [\`${old[key]}\` → \`${next[key]}\`](https://github.com/ProjectIgnis/${repo}/compare/${old[key]}...${next[key]}) | ${comparison ? `${comparison.ahead_by} (${comparison.status}${comparison.behind_by ? `; ${comparison.behind_by} behind` : ""})` : "unchanged"} |`);
  }
  const temporary = await mkdtemp(join(tmpdir(), "engine-data-update-"));
  try {
    const treeAt = async (sha: string) => {
      const tree = await api<Tree>(`CardScripts/git/trees/${sha}?recursive=1`);
      if (tree.truncated) throw new Error("GitHub truncated the script tree; refusing an incomplete report");
      return new Map(tree.tree.filter((entry) => entry.type === "blob").map((entry) => [entry.path, entry.sha]));
    };
    const [oldTree, newTree] = await Promise.all([treeAt(old.scripts), treeAt(next.scripts)]);
    const diff = diffScripts(oldTree, newTree);
    const archive = join(temporary, "scripts.tar.gz");
    await writeFile(archive, Buffer.from(await (await download(`https://codeload.github.com/ProjectIgnis/CardScripts/tar.gz/${next.scripts}`)).arrayBuffer()));
    const extracted = join(temporary, "scripts");
    await mkdir(extracted);
    execFileSync("tar", ["-xzf", archive, "--strip-components=1", "-C", extracted]);
    const stock = new Map<string, string>();
    for (const path of newTree.keys()) if (path.endsWith(".lua")) stock.set(path, await readFile(join(extracted, path), "utf8"));
    const databasePath = join(temporary, "cards.cdb");
    await writeFile(databasePath, Buffer.from(await (await download(`https://raw.githubusercontent.com/ProjectIgnis/BabelCDB/${next.database}/cards.cdb`)).arrayBuffer()));
    const names = new Map<number, string>();
    const db = new Database(databasePath, { readonly: true });
    try {
      for (const row of db.prepare("SELECT id, name FROM texts").all() as { id: number; name: string }[]) names.set(row.id, row.name);
    } finally { db.close(); }
    const cardLine = (path: string) => {
      const name = names.get(codeOf(path));
      return `- [\`${path}\`](https://github.com/ProjectIgnis/CardScripts/blob/${next.scripts}/${path})${name ? ` — ${markdown(name)}` : " — name unavailable in cards.cdb"}`;
    };
    for (const [title, paths] of [["New official card scripts", diff.added], ["Changed official scripts", diff.changed], ["Removed official scripts", diff.removed]] as const) {
      report.push("", `## ${title} (${paths.length})`, "", ...(paths.length ? paths.map((path) => title.startsWith("Removed") ? `- \`${path}\`` : cardLine(path)) : ["None."]));
    }
    const manifest = JSON.parse(await readFile(join(root, packagePath, "domain-core/multi-scripts/MANIFEST.json"), "utf8")) as { cards: OverlayCard[] };
    const conflicts = detectOverlayConflicts(manifest.cards, stock);
    report.push("", `## Overlay conflicts (${conflicts.length})`, "", "Compared every MANIFEST stockSha256 against candidate stock scripts. A human/Codex must update affected overlay files and review their baseline hashes; this job does not regenerate them.", "",
      ...(conflicts.length ? conflicts.map((card) => `- \`${card.file}\` ${markdown(names.get(card.code) ?? card.name ?? "")} — stock \`${card.stockSha256 ?? "unrecorded"}\` → \`${card.actualSha256 ?? "removed"}\``) : ["None."]));
    const risks = findNewRisks(stock, [...diff.added, ...diff.changed]);
    report.push("", `## New multiplayer risks (${risks.length})`, "", "scan-multiplayer-scripts: new/changed cards flagged F or ambiguous O, absent from MULTIPLAYER_FORBIDDEN / MULTIPLAYER_CARD_RULES.", "",
      ...(risks.length ? risks.map((card) => `- \`c${card.code}.lua\` ${markdown(names.get(card.code) ?? card.name)} — **${card.cls}**, ${card.rules.map((rule) => `\`${rule}\``).join(", ")}`) : ["None."]));
    const changedLua = new Map([...stock].filter(([path]) => newTree.get(path) !== oldTree.get(path)));
    report.push("", "## Core compatibility", "", ...await checkCoreCompatibility(root, changedLua, stock));
    const files = await rewritePins(root, old, next, true);
    report.push("", "## Synchronized files", "", ...files.map((path) => `- \`${path}\``));
    report.push("", "## Deployment", "", "**Live-duel warning:** a data pin bump changes bundleVersion. On recovery after deploy, an active duel whose bundleVersion differs is interrupted. Drain active duels and merge at a quiet time. The deploy preflight may refuse until duels finish.");
    await saveReport();
    if (!options.dryRun) await rewritePins(root, old, next, false);
    console.log(`${options.dryRun ? "dry run" : "update"}: ${diff.added.length} new, ${diff.changed.length} changed, ${diff.removed.length} removed official scripts; ${conflicts.length} overlay conflicts; ${risks.length} new multiplayer risks. Report: ${reportPath}`);
    return { changed, next, reportPath, files };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function main() {
  const { values } = parseArgs({ options: { scripts: { type: "string" }, database: { type: "string" }, strings: { type: "string" }, "dry-run": { type: "boolean", default: false }, report: { type: "string" } } });
  const overrides = Object.fromEntries(keys.filter((key) => values[key] !== undefined).map((key) => [key, values[key]]));
  const result = await runUpdate({ overrides, dryRun: values["dry-run"], report: values.report });
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, [`changed=${result.changed}`, ...keys.map((key) => `${key}=${result.next[key]}`), ""].join("\n"));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
