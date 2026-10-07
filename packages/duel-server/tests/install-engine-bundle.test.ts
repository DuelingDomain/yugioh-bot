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
  writeFileSync(join(dir, "card-scripts/.host-card-script-patches.json"), JSON.stringify([{ stockPath }]));
  if (options.legacy !== false) {
    writeFileSync(join(dir, "ocgcore.domain.legacy.wasm"), "legacy domain");
    writeFileSync(join(dir, "card-scripts", "domain.legacy.lua"), "-- legacy domain");
  }
  for (const [name, text] of Object.entries(overlay)) writeFileSync(join(dir, "multi-scripts", name), text);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    tag: options.tag,
    integrity: {
      multiScripts: multiScriptsHash(overlay),
      cardScriptPatches: sha(`${stockPath}\0${sha(patched)}\n`),
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

/** A bundle that was made without the legacy 1v1 files (or with a wrong hash) is refused, also in the preflight. */
function incompleteFixture(legacy: false | "bad-hash"): Fixture {
  const f = fixture({ tag: "old", multi: "m1" }, { tag: "new", multi: "m1" }, []);
  rmSync(f.src, { recursive: true, force: true });
  mkdirSync(f.src, { recursive: true });
  writeBundle(f.src, { tag: "new", multi: "m1", legacy });
  return f;
}

function run(f: Fixture, preflight: boolean): { status: number | null; out: string } {
  const result = spawnSync("sh", [script], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", DUEL_BUNDLE_SRC: f.src, DUEL_DATA_DIR: f.dst, ...(preflight ? { DUEL_PREFLIGHT: "1" } : {}) },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

function snapshot(dir: string): Record<string, string> {
  const names = ["manifest.json", "ocgcore.standard.wasm", "ocgcore.multi.wasm", "ocgcore.multi-domain.wasm"];
  return Object.fromEntries(names.filter((name) => existsSync(join(dir, name))).map((name) => [name, readFileSync(join(dir, name), "utf8")]));
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function writeDomainMulti(dir: string, bytes: string): void {
  writeFileSync(join(dir, "ocgcore.multi-domain.wasm"), bytes);
  writeFileSync(join(dir, "ocgcore.multi-domain.sha256"), `${sha(bytes)}  ocgcore.multi-domain.wasm\n`);
  writeFileSync(join(dir, "ocgcore.multi-domain.SOURCE"), "tag=deploy-test\n");
}

describe("install-engine-bundle.sh Domain multi core", () => {
  it("adds Domain to an existing base bundle and leaves an identical core alone during a multiplayer duel", () => {
    const f = fixture({ tag: "same", multi: "m1" }, { tag: "same", multi: "m1" }, []);
    writeDomainMulti(f.src, "d1");
    expect(run(f, false).status).toBe(0);
    expect(snapshot(f.dst)).toEqual(snapshot(f.src));
    const db = new Database(join(f.root, "data", "bot.sqlite"));
    db.prepare("insert into duels (status, format) values (?, ?)").run("active", "ffa3");
    db.close();
    for (const preflight of [true, false]) expect(run(f, preflight).status).toBe(0);
  });
  it("updates Domain alone under an identical manifest while a 1v1 duel is active", () => {
    const f = fixture({ tag: "same", multi: "m1" }, { tag: "same", multi: "m1" }, [{ format: "1v1", status: "active" }]);
    writeDomainMulti(f.dst, "d1");
    writeDomainMulti(f.src, "d2");
    expect(run(f, true).status).toBe(0);
    expect(readFileSync(join(f.dst, "ocgcore.multi-domain.wasm"), "utf8")).toBe("d1");
    expect(run(f, false).status).toBe(0);
    expect(snapshot(f.dst)).toEqual(snapshot(f.src));
    expect(readFileSync(join(f.dst, "ocgcore.multi-domain.SOURCE"), "utf8")).toBe("tag=deploy-test\n");
  });

  it.each(["ffa3", "ffa4", "tag"])("refuses a changed Domain core during an active %s duel before writing anything", (format) => {
    const f = fixture({ tag: "same", multi: "m1" }, { tag: "same", multi: "m2" }, [{ format, status: "active" }]);
    writeDomainMulti(f.dst, "d1");
    writeDomainMulti(f.src, "d2");
    const before = snapshot(f.dst);
    for (const preflight of [true, false]) {
      expect(run(f, preflight).status).toBe(1);
      expect(snapshot(f.dst)).toEqual(before);
    }
  });

  it.each(["missing", "bad", "empty"])("refuses a %s Domain checksum/artifact before replacing the base bundle", (kind) => {
    const f = fixture({ tag: "old", multi: "m1" }, { tag: "new", multi: "m1" }, []);
    writeDomainMulti(f.src, kind === "empty" ? "" : "d2");
    if (kind === "missing") rmSync(join(f.src, "ocgcore.multi-domain.sha256"));
    if (kind === "bad") writeFileSync(join(f.src, "ocgcore.multi-domain.sha256"), `${"0".repeat(64)}  ocgcore.multi-domain.wasm\n`);
    const before = snapshot(f.dst);
    for (const preflight of [true, false]) {
      const result = run(f, preflight);
      expect(result.status).toBe(1);
      expect(result.out).toContain("bad multi core");
      expect(snapshot(f.dst)).toEqual(before);
    }
  });

  it("refuses a Domain-only change during an active multiplayer duel", () => {
    const f = fixture({ tag: "same", multi: "m1" }, { tag: "same", multi: "m1" }, [{ format: "ffa4", status: "active" }]);
    writeDomainMulti(f.dst, "d1");
    writeDomainMulti(f.src, "d2");
    for (const preflight of [true, false]) expect(run(f, preflight).status).toBe(1);
    expect(readFileSync(join(f.dst, "ocgcore.multi-domain.wasm"), "utf8")).toBe("d1");
  });
});

describe("staging bundle wrapper", () => {
  function stagingRun(f: Fixture): { status: number | null; out: string } {
    writeFileSync(join(f.src, "ocgcore.multi.SOURCE"), "tag=deploy-test\n");
    const tarball = join(f.root, "bundle.tar.gz");
    expect(spawnSync("tar", ["-C", f.src, "-czf", tarball, "."]).status).toBe(0);
    const wrapper = join(dirname(script), "../../../scripts/staging/install-staging-bundle.sh");
    const result = spawnSync("sh", [wrapper, tarball, dirname(f.dst)], { encoding: "utf8" });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  }

  it("requires the Domain artifact before changing the installed bundle", () => {
    const f = fixture({ tag: "old", multi: "m1" }, { tag: "new", multi: "m2" }, []);
    const before = snapshot(f.dst);
    const result = stagingRun(f);
    expect(result.status).toBe(1);
    expect(result.out).toContain("ocgcore.multi-domain.wasm is missing");
    expect(snapshot(f.dst)).toEqual(before);
  });

  it("updates both cores under an identical manifest", () => {
    const f = fixture({ tag: "same", multi: "m1" }, { tag: "same", multi: "m2" }, []);
    writeDomainMulti(f.dst, "d1");
    writeDomainMulti(f.src, "d2");
    expect(stagingRun(f).status).toBe(0);
    expect(snapshot(f.dst)).toEqual(snapshot(f.src));
  });

  it("uses the shared active-duel guard for a Domain-only update", () => {
    const f = fixture({ tag: "same", multi: "m1" }, { tag: "same", multi: "m1" }, [{ format: "tag", status: "active" }]);
    writeDomainMulti(f.dst, "d1");
    writeDomainMulti(f.src, "d2");
    const before = snapshot(f.dst);
    expect(stagingRun(f).status).toBe(1);
    expect(snapshot(f.dst)).toEqual(before);
  });
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

describe("install-engine-bundle.sh patched card scripts", () => {
  it.each(["stock", "missing script", "missing receipt", "empty receipt", "invalid receipt", "unsafe path"])("refuses %s in the incoming bundle before writing", kind => {
    const f = fixture({ tag: "old" }, { tag: "new" }, []);
    const script = join(f.src, "card-scripts/official/c3743515.lua");
    const receipt = join(f.src, "card-scripts/.host-card-script-patches.json");
    if (kind === "stock") writeFileSync(script, "-- stock\n");
    if (kind === "missing script") rmSync(script);
    if (kind === "missing receipt") rmSync(receipt);
    if (kind === "empty receipt") writeFileSync(receipt, "[]");
    if (kind === "invalid receipt") writeFileSync(receipt, "{}");
    if (kind === "unsafe path") writeFileSync(receipt, JSON.stringify([{ stockPath: "../manifest.json" }]));
    const before = snapshot(f.dst);
    for (const preflight of [true, false]) {
      const result = run(f, preflight);
      expect(result.status).toBe(1);
      expect(result.out).toContain("cardScriptPatches");
      expect(snapshot(f.dst)).toEqual(before);
    }
  });

  it("repairs an installed stock script even when the manifest is identical", () => {
    const f = fixture({ tag: "same" }, { tag: "same" }, []);
    const path = "card-scripts/official/c3743515.lua";
    writeFileSync(join(f.dst, path), "-- stock\n");
    expect(run(f, false).status).toBe(0);
    expect(readFileSync(join(f.dst, path), "utf8")).toBe(readFileSync(join(f.src, path), "utf8"));
  });

  it("refuses repair of an installed stock script while a duel is active", () => {
    const f = fixture({ tag: "same" }, { tag: "same" }, [{ format: "1v1", status: "active" }]);
    const path = join(f.dst, "card-scripts/official/c3743515.lua");
    writeFileSync(path, "-- stock\n");
    for (const preflight of [true, false]) {
      expect(run(f, preflight).status).toBe(1);
      expect(readFileSync(path, "utf8")).toBe("-- stock\n");
    }
  });
});

describe("install-engine-bundle.sh and the legacy 1v1 engine files", () => {
  it.each([
    ["has no legacy files", false],
    ["has a legacy wasm that does not match integrity.domainLegacyWasm", "bad-hash"],
  ] as const)("refuses a bundle that %s", (_name, legacy) => {
    const f = incompleteFixture(legacy);
    const before = snapshot(f.dst);
    for (const preflight of [true, false]) {
      const result = run(f, preflight);
      expect(result.status).toBe(1);
      expect(result.out).toMatch(/bundle source is incomplete/);
    }
    expect(snapshot(f.dst)).toEqual(before);
  });

  it("installs the legacy files with the bundle", () => {
    const f = fixture({ tag: "old", multi: "m1" }, { tag: "new", multi: "m1" }, []);
    expect(run(f, false).status).toBe(0);
    expect(readFileSync(join(f.dst, "ocgcore.domain.legacy.wasm"), "utf8")).toBe("legacy domain");
    expect(readFileSync(join(f.dst, "card-scripts", "domain.legacy.lua"), "utf8")).toBe("-- legacy domain");
  });
});
