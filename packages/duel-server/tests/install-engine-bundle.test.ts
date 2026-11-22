import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { fixture, run, snapshot, writeDomainMulti } from "./helpers/install-engine-bundle.js";

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
