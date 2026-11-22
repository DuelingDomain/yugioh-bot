import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach } from "vitest";

const script = fileURLToPath(new URL("../../scripts/install-engine-bundle.sh", import.meta.url));
const roots: string[] = [];

export function sha(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// The multi-scripts hash of the install script: the lines "<path>\0<sha256 of the file>\n", sorted by path.
function multiScriptsHash(files: Record<string, string>): string {
  const lines = Object.keys(files).sort().map((name) => `${name}\0${sha(files[name]!)}\n`);
  return createHash("sha256").update(lines.join("")).digest("hex");
}

/** A small, complete bundle. `tag` changes manifest.json, `multi` changes only the multi core. */
function writeBundle(dir: string, options: { tag: string; multi?: string; legacy?: false | "bad-hash" }): void {
  const overlay = { "mp-utility.lua": "-- overlay", "MANIFEST.json": "{}" };
  mkdirSync(join(dir, "card-scripts"), { recursive: true });
  mkdirSync(join(dir, "multi-scripts"), { recursive: true });
  writeFileSync(join(dir, "cards.cdb"), "cdb");
  writeFileSync(join(dir, "strings.conf"), "strings");
  writeFileSync(join(dir, "ocgcore.domain.wasm"), "domain");
  writeFileSync(join(dir, "ocgcore.standard.wasm"), `standard-${options.tag}`);
  writeFileSync(join(dir, "card-scripts", "domain.lua"), "-- domain");
  const patched = "-- stock\n-- BEGIN HOST CARD SCRIPT PATCH\n-- patched\n";
  const stockPath = "official/c3743515.lua";
  mkdirSync(join(dir, "card-scripts/official"), { recursive: true });
  writeFileSync(join(dir, "card-scripts", stockPath), patched);
  writeFileSync(join(dir, "card-scripts/utility.lua"), patched);
  writeFileSync(join(dir, "card-scripts/.host-card-script-patches.json"), JSON.stringify([{ stockPath }, { stockPath: "utility.lua" }]));
  if (options.legacy !== false) {
    writeFileSync(join(dir, "ocgcore.domain.legacy.wasm"), "legacy domain");
    writeFileSync(join(dir, "card-scripts", "domain.legacy.lua"), "-- legacy domain");
  }
  for (const [name, text] of Object.entries(overlay)) writeFileSync(join(dir, "multi-scripts", name), text);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    tag: options.tag,
    integrity: {
      multiScripts: multiScriptsHash(overlay),
      cardScriptPatches: sha(`${stockPath}\0${sha(patched)}\nutility.lua\0${sha(patched)}\n`),
      domainLegacyWasm: sha(options.legacy === "bad-hash" ? "other" : "legacy domain"),
      domainLegacyLua: sha("-- legacy domain"),
    },
  }));
  if (options.multi !== undefined) {
    writeFileSync(join(dir, "ocgcore.multi.wasm"), options.multi);
    writeFileSync(join(dir, "ocgcore.multi.sha256"), `${sha(options.multi)}  ocgcore.multi.wasm\n`);
  }
}

interface Fixture {
  src: string;
  dst: string;
  root: string;
}

/** `installed` is what the VM holds, `incoming` is the new bundle. The database sits next to the data directory. */
export function fixture(installed: { tag: string; multi?: string }, incoming: { tag: string; multi?: string }, duels: Array<{ format: string | null; status: string }>): Fixture {
  const root = mkdtempSync(join(tmpdir(), "install-bundle-"));
  roots.push(root);
  const dst = join(root, "data", "engine-bundle");
  const src = join(root, "incoming");
  mkdirSync(dst, { recursive: true });
  mkdirSync(src, { recursive: true });
  writeBundle(dst, installed);
  writeBundle(src, incoming);
  const db = new Database(join(root, "data", "bot.sqlite"));
  const withFormat = duels.every((duel) => duel.format !== null);
  db.exec(withFormat ? "create table duels (id integer primary key, status text, format text)" : "create table duels (id integer primary key, status text)");
  for (const duel of duels) {
    if (withFormat) db.prepare("insert into duels (status, format) values (?, ?)").run(duel.status, duel.format);
    else db.prepare("insert into duels (status) values (?)").run(duel.status);
  }
  db.close();
  return { src, dst, root };
}

/** A bundle that was made without the legacy 1v1 files (or with a wrong hash) is refused, also in the preflight. */
export function incompleteFixture(legacy: false | "bad-hash"): Fixture {
  const f = fixture({ tag: "old", multi: "m1" }, { tag: "new", multi: "m1" }, []);
  rmSync(f.src, { recursive: true, force: true });
  mkdirSync(f.src, { recursive: true });
  writeBundle(f.src, { tag: "new", multi: "m1", legacy });
  return f;
}

export function run(f: Fixture, preflight: boolean, idleClose?: string): { status: number | null; out: string } {
  const result = spawnSync("sh", [script], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", DUEL_BUNDLE_SRC: f.src, DUEL_DATA_DIR: f.dst,
      ...(preflight ? { DUEL_PREFLIGHT: "1" } : {}), ...(idleClose === undefined ? {} : { DUEL_IDLE_CLOSE: idleClose }) },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

export function snapshot(dir: string): Record<string, string> {
  const names = ["manifest.json", "ocgcore.standard.wasm", "ocgcore.multi.wasm", "ocgcore.multi-domain.wasm"];
  return Object.fromEntries(names.filter((name) => existsSync(join(dir, name))).map((name) => [name, readFileSync(join(dir, name), "utf8")]));
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

export function writeDomainMulti(dir: string, bytes: string): void {
  writeFileSync(join(dir, "ocgcore.multi-domain.wasm"), bytes);
  writeFileSync(join(dir, "ocgcore.multi-domain.sha256"), `${sha(bytes)}  ocgcore.multi-domain.wasm\n`);
  writeFileSync(join(dir, "ocgcore.multi-domain.SOURCE"), "tag=deploy-test\n");
}
