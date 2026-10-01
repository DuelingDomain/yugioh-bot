import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "install-engine-bundle.sh");
const roots: string[] = [];

function sha(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// The multi-scripts hash of the install script: the lines "<path>\0<sha256 of the file>\n", sorted by path.
function multiScriptsHash(files: Record<string, string>): string {
  const lines = Object.keys(files).sort().map((name) => `${name}\0${sha(files[name]!)}\n`);
  return createHash("sha256").update(lines.join("")).digest("hex");
}

/** A small, complete bundle. `tag` changes manifest.json, `multi` changes only the multi core. */
function writeBundle(dir: string, options: { tag: string; multi?: string }): void {
  const overlay = { "mp-utility.lua": "-- overlay", "MANIFEST.json": "{}" };
  mkdirSync(join(dir, "card-scripts"), { recursive: true });
  mkdirSync(join(dir, "multi-scripts"), { recursive: true });
  writeFileSync(join(dir, "cards.cdb"), "cdb");
  writeFileSync(join(dir, "strings.conf"), "strings");
  writeFileSync(join(dir, "ocgcore.domain.wasm"), "domain");
  writeFileSync(join(dir, "ocgcore.standard.wasm"), `standard-${options.tag}`);
  writeFileSync(join(dir, "card-scripts", "domain.lua"), "-- domain");
  for (const [name, text] of Object.entries(overlay)) writeFileSync(join(dir, "multi-scripts", name), text);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ tag: options.tag, integrity: { multiScripts: multiScriptsHash(overlay) } }));
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
function fixture(installed: { tag: string; multi?: string }, incoming: { tag: string; multi?: string }, duels: Array<{ format: string | null; status: string }>): Fixture {
  const root = mkdtempSync(join(tmpdir(), "install-bundle-"));
  roots.push(root);
  const dst = join(root, "data", "duel-engine");
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

function run(f: Fixture, preflight: boolean): { status: number | null; out: string } {
  const result = spawnSync("sh", [script], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", DUEL_BUNDLE_SRC: f.src, DUEL_DATA_DIR: f.dst, ...(preflight ? { DUEL_PREFLIGHT: "1" } : {}) },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

function snapshot(dir: string): Record<string, string> {
  const names = ["manifest.json", "ocgcore.standard.wasm", "ocgcore.multi.wasm"];
  return Object.fromEntries(names.filter((name) => existsSync(join(dir, name))).map((name) => [name, readFileSync(join(dir, name), "utf8")]));
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("install-engine-bundle.sh preflight (DUEL_PREFLIGHT=1)", () => {
  it("refuses a changed bundle while a 1v1 duel is active, and changes nothing", () => {
    const f = fixture({ tag: "old", multi: "m1" }, { tag: "new", multi: "m1" }, [{ format: "1v1", status: "active" }]);
    const before = snapshot(f.dst);
    const result = run(f, true);
    expect(result.status).toBe(1);
    expect(result.out).toContain("1 active duel(s)");
    expect(snapshot(f.dst)).toEqual(before);
  });

  it("passes a changed bundle when no duel is active, and still installs nothing", () => {
    const f = fixture({ tag: "old", multi: "m1" }, { tag: "new", multi: "m2" }, [{ format: "1v1", status: "finished" }]);
    const before = snapshot(f.dst);
    const result = run(f, true);
    expect(result.status).toBe(0);
    expect(result.out).toContain("preflight ok");
    expect(snapshot(f.dst)).toEqual(before);
  });

  it("passes a new multi core under an identical manifest while only a 1v1 duel is active", () => {
    const f = fixture({ tag: "same", multi: "m1" }, { tag: "same", multi: "m2" }, [{ format: "1v1", status: "active" }]);
    expect(run(f, true).status).toBe(0);
  });

  it("refuses a new multi core under an identical manifest while a free-for-all duel is active", () => {
    const f = fixture({ tag: "same", multi: "m1" }, { tag: "same", multi: "m2" }, [{ format: "ffa3", status: "active" }]);
    const result = run(f, true);
    expect(result.status).toBe(1);
    expect(result.out).toContain("active Tag or free-for-all duel(s)");
  });

  it("passes an identical bundle while any duel is active", () => {
    const f = fixture({ tag: "same", multi: "m1" }, { tag: "same", multi: "m1" }, [{ format: "ffa4", status: "active" }]);
    expect(run(f, true).status).toBe(0);
  });

  it("refuses a bundle with a bad multi core sidecar", () => {
    const f = fixture({ tag: "old", multi: "m1" }, { tag: "new", multi: "m2" }, []);
    writeFileSync(join(f.src, "ocgcore.multi.sha256"), `${"0".repeat(64)}  ocgcore.multi.wasm\n`);
    const result = run(f, true);
    expect(result.status).toBe(1);
    expect(result.out).toContain("bad multi core");
  });

  it("treats a database from before the format column as having no Tag or free-for-all duel", () => {
    const f = fixture({ tag: "same", multi: "m1" }, { tag: "same", multi: "m2" }, [{ format: null, status: "active" }]);
    expect(run(f, true).status).toBe(0);
  });
});

describe("install-engine-bundle.sh install", () => {
  it("still refuses a changed bundle while a duel is active", () => {
    const f = fixture({ tag: "old", multi: "m1" }, { tag: "new", multi: "m1" }, [{ format: "1v1", status: "active" }]);
    const before = snapshot(f.dst);
    expect(run(f, false).status).toBe(1);
    expect(snapshot(f.dst)).toEqual(before);
  });

  it("installs a changed bundle when no duel is active", () => {
    const f = fixture({ tag: "old", multi: "m1" }, { tag: "new", multi: "m2" }, []);
    expect(run(f, false).status).toBe(0);
    expect(snapshot(f.dst)).toEqual(snapshot(f.src));
  });

  it("installs only the multi core when the manifest is identical, and a 1v1 duel does not block it", () => {
    const f = fixture({ tag: "same", multi: "m1" }, { tag: "same", multi: "m2" }, [{ format: "1v1", status: "active" }]);
    const standardBefore = readFileSync(join(f.dst, "ocgcore.standard.wasm"), "utf8");
    expect(run(f, false).status).toBe(0);
    expect(readFileSync(join(f.dst, "ocgcore.multi.wasm"), "utf8")).toBe("m2");
    expect(readFileSync(join(f.dst, "ocgcore.standard.wasm"), "utf8")).toBe(standardBefore);
  });
});
