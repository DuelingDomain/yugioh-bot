import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MULTI_SCRIPTS_ENV,
  REPLACE_MARKER,
  activeMultiScriptsHash,
  cardCodeOfScript,
  installMultiScripts,
  loadMultiScripts,
  multiScriptsFolderHash,
  readMultiScriptsManifest,
  repoMultiScriptsDirectory,
  resolveMultiScriptsDirectory,
} from "../src/multi-scripts.js";
import { STUB_UTILITY, makeOverlay, removeOverlays } from "./support/multi-scripts.js";

const temporary: string[] = [];
const temp = (stem: string) => {
  const directory = mkdtempSync(join(tmpdir(), stem));
  temporary.push(directory);
  return directory;
};
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

afterEach(() => {
  removeOverlays();
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("the overlay folder of the repo", () => {
  const repo = repoMultiScriptsDirectory();

  it("keeps the two stub statements first (the flag, then the guard) and defines the helpers after them", () => {
    const lines = readFileSync(join(repo, "mp-utility.lua"), "utf8").split("\n").filter((line) => line.trim() !== "");
    expect(lines[0]).toBe("MP_OVERLAY_ACTIVE = true");
    expect(lines[1]).toBe("if not Duel.MPBindOpponent then return end");
    const text = lines.slice(2).join("\n");
    for (const helper of ["MPAny", "MPValue", "MPOne", "MPPick", "MPTarget", "MPEachOpponent"]) {
      expect(text).toContain(`function aux.${helper}(fn)`);
    }
    for (const helper of ["MPForEachDuelist(fn)", "MPKey(p)", "MPForEachController(g,fn)"]) {
      expect(text).toContain(`function aux.${helper}`);
    }
  });

  it("loads and passes the checks", () => {
    const overlay = loadMultiScripts(repo);
    expect(overlay.utility.startsWith(STUB_UTILITY)).toBe(true);
    expect(overlay.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the manifest", () => {
  it("accepts a list of cards and gives each one its file", () => {
    const directory = makeOverlay([{ code: 123, kind: "whole", text: "-- a" }, { code: 45, kind: "hand", text: "-- b" }]);
    expect(readMultiScriptsManifest(directory)).toEqual([
      { code: 123, file: "c123.lua", kind: "whole" },
      { code: 45, file: "c45.lua", kind: "hand" },
    ]);
  });

  it.each([
    ["is not JSON", (d: string) => writeFileSync(join(d, "MANIFEST.json"), "{"), /missing or unreadable/],
    ["has a wrong version", (d: string) => writeFileSync(join(d, "MANIFEST.json"), '{"version":2,"cards":[]}'), /unknown version 2/],
    ["has no card list", (d: string) => writeFileSync(join(d, "MANIFEST.json"), '{"version":1}'), /`cards` is not a list/],
    ["has a bad code", (d: string) => writeFileSync(join(d, "MANIFEST.json"), '{"version":1,"cards":[{"code":"x","kind":"fix"}]}'), /bad card code/],
    ["has an unknown kind", (d: string) => writeFileSync(join(d, "MANIFEST.json"), '{"version":1,"cards":[{"code":1,"kind":"zzz"}]}'), /unknown kind "zzz"/],
    ["lists a card twice", (d: string) => {
      writeFileSync(join(d, "c1.lua"), "-- x");
      writeFileSync(join(d, "MANIFEST.json"), '{"version":1,"cards":[{"code":1,"kind":"fix"},{"code":1,"kind":"fix"}]}');
    }, /card 1 is listed twice/],
    ["names the wrong file", (d: string) => writeFileSync(join(d, "MANIFEST.json"), '{"version":1,"cards":[{"code":1,"file":"x.lua","kind":"fix"}]}'), /must use the file c1\.lua/],
    ["lists a file that is missing", (d: string) => writeFileSync(join(d, "MANIFEST.json"), '{"version":1,"cards":[{"code":9,"kind":"fix"}]}'), /lists c9\.lua, which is missing/],
    ["leaves out a file of the folder", (d: string) => writeFileSync(join(d, "c77.lua"), "-- x"), /c77\.lua is in the folder but not in the manifest/],
  ])("is refused when it %s", (_name, damage, pattern) => {
    const directory = makeOverlay([]);
    damage(directory);
    expect(() => readMultiScriptsManifest(directory)).toThrow(pattern);
  });

  it("is refused by loadMultiScripts when mp-utility.lua is missing", () => {
    const directory = makeOverlay([], { utility: null });
    expect(() => loadMultiScripts(directory)).toThrow(/has no mp-utility\.lua/);
  });
});

describe("applying the overlay", () => {
  const original = "local s,id=GetID()\nfunction s.initial_effect(c) end\n";

  it("appends a suffix to the original text", () => {
    const overlay = loadMultiScripts(makeOverlay([{ code: 100, text: "-- suffix\n" }]));
    expect(overlay.apply("c100.lua", original)).toBe(`${original}-- suffix\n`);
  });

  it("starts a new line when the original does not end with one", () => {
    const overlay = loadMultiScripts(makeOverlay([{ code: 100, text: "-- suffix" }]));
    expect(overlay.apply("c100.lua", "return 1")).toBe("return 1\n-- suffix");
  });

  it("replaces the script when the file starts with the replace marker", () => {
    const text = `${REPLACE_MARKER}\nlocal s,id=GetID()\n`;
    const overlay = loadMultiScripts(makeOverlay([{ code: 100, text }]));
    expect(overlay.apply("c100.lua", original)).toBe(text);
    expect(overlay.apply("c100.lua", null)).toBe(text);
  });

  it("does not make a script out of a suffix for a card without a script", () => {
    const overlay = loadMultiScripts(makeOverlay([{ code: 100, text: "-- suffix\n" }]));
    expect(overlay.apply("c100.lua", null)).toBeNull();
  });

  it("returns every other script as it is (the same string, or null)", () => {
    const overlay = loadMultiScripts(makeOverlay([{ code: 100, text: "-- suffix\n" }]));
    expect(overlay.apply("c101.lua", original)).toBe(original);
    expect(overlay.apply("utility.lua", original)).toBe(original);
    expect(overlay.apply("c101.lua", null)).toBeNull();
  });

  it.each([
    ["c100.lua", 100],
    ["./script/c100.lua", 100],
    [".\\script\\c100.lua", 100],
    ["official/c7.lua", 7],
    ["c100.lua.bak", null],
    ["cx100.lua", null],
    ["constant.lua", null],
    ["c.lua", null],
  ])("reads the card code of %s as %s", (name, code) => {
    expect(cardCodeOfScript(name)).toBe(code);
  });

  it("applies to the script names the core uses", () => {
    const overlay = loadMultiScripts(makeOverlay([{ code: 100, text: "-- suffix\n" }]));
    expect(overlay.apply("./script/c100.lua", original)).toBe(`${original}-- suffix\n`);
  });
});

describe("the folder hash", () => {
  it("covers the path and the bytes of every file, in bytewise path order", () => {
    const directory = temp("ms-hash-");
    mkdirSync(join(directory, "sub"));
    writeFileSync(join(directory, "b.lua"), "B");
    writeFileSync(join(directory, "a.lua"), "A");
    writeFileSync(join(directory, "sub", "c1.lua"), "C");
    writeFileSync(join(directory, "c10.lua"), "X");
    // Bytewise: "a.lua" < "b.lua" < "c10.lua" < "sub/c1.lua". The shell side sorts the same way (LC_ALL=C sort).
    const expected = createHash("sha256");
    for (const [path, text] of [["a.lua", "A"], ["b.lua", "B"], ["c10.lua", "X"], ["sub/c1.lua", "C"]]) expected.update(`${path}\0${sha(text!)}\n`);
    expect(multiScriptsFolderHash(directory)).toBe(expected.digest("hex"));
  });

  it("changes with a byte, a name, an added file", () => {
    const directory = makeOverlay([{ code: 1, text: "A" }]);
    const base = multiScriptsFolderHash(directory);
    expect(multiScriptsFolderHash(directory)).toBe(base);
    writeFileSync(join(directory, "c1.lua"), "B");
    const changed = multiScriptsFolderHash(directory);
    expect(changed).not.toBe(base);
    writeFileSync(join(directory, "extra.txt"), "");
    expect(multiScriptsFolderHash(directory)).not.toBe(changed);
  });

  it("does not depend on where the folder is", () => {
    expect(multiScriptsFolderHash(makeOverlay([{ code: 1, text: "A" }]))).toBe(multiScriptsFolderHash(makeOverlay([{ code: 1, text: "A" }])));
  });
});

describe("finding the folder", () => {
  const empty = (stem: string) => temp(stem);

  it("takes the env folder first", () => {
    const named = makeOverlay([]);
    const data = empty("ms-data-");
    mkdirSync(join(data, "multi-scripts"));
    expect(resolveMultiScriptsDirectory(data, { env: { [MULTI_SCRIPTS_ENV]: named }, repoDirectory: empty("ms-repo-") })).toBe(named);
  });

  it("refuses an env folder that does not exist", () => {
    expect(() => resolveMultiScriptsDirectory(empty("ms-data-"), { env: { [MULTI_SCRIPTS_ENV]: "/no/such/folder" } })).toThrow(/is not a directory/);
  });

  it("takes the repo folder second, outside production, before an older copy in <data>", () => {
    const repo = empty("ms-repo-");
    const data = empty("ms-data-");
    mkdirSync(join(data, "multi-scripts"));
    expect(resolveMultiScriptsDirectory(data, { env: {}, repoDirectory: repo })).toBe(repo);
    expect(resolveMultiScriptsDirectory(data, { env: { NODE_ENV: "test" }, repoDirectory: repo })).toBe(repo);
    expect(resolveMultiScriptsDirectory(empty("ms-data-"), { env: {}, repoDirectory: repo })).toBe(repo);
  });

  it("takes <data>/multi-scripts when the repo folder is missing", () => {
    const data = empty("ms-data-");
    mkdirSync(join(data, "multi-scripts"));
    expect(resolveMultiScriptsDirectory(data, { env: {}, repoDirectory: join(data, "no-repo") })).toBe(join(data, "multi-scripts"));
    expect(resolveMultiScriptsDirectory(empty("ms-data-"), { env: {}, repoDirectory: join(data, "no-repo") })).toBeNull();
  });

  it("in production uses <data>/multi-scripts only: no repo folder, no env folder", () => {
    const data = empty("ms-data-");
    const repo = empty("ms-repo-");
    const named = makeOverlay([]);
    expect(resolveMultiScriptsDirectory(data, { env: { NODE_ENV: "production" }, repoDirectory: repo })).toBeNull();
    expect(resolveMultiScriptsDirectory(data, { env: { NODE_ENV: "production", [MULTI_SCRIPTS_ENV]: named }, repoDirectory: repo })).toBeNull();
    mkdirSync(join(data, "multi-scripts"));
    expect(resolveMultiScriptsDirectory(data, { env: { NODE_ENV: "production", [MULTI_SCRIPTS_ENV]: named }, repoDirectory: repo })).toBe(join(data, "multi-scripts"));
  });
});

describe("the hash of the folder a duel would load", () => {
  it("is the hash of the resolved folder, and null when there is none", () => {
    const named = makeOverlay([{ code: 1, text: "A" }]);
    expect(activeMultiScriptsHash(temp("ms-data-"), { [MULTI_SCRIPTS_ENV]: named })).toBe(multiScriptsFolderHash(named));
    const data = temp("ms-data-");
    expect(activeMultiScriptsHash(data, { NODE_ENV: "production" })).toBeNull();
    installMultiScripts(data, named);
    expect(activeMultiScriptsHash(data, { NODE_ENV: "production" })).toBe(multiScriptsFolderHash(named));
  });

  it("is null, not a throw, when the env folder does not exist", () => {
    expect(activeMultiScriptsHash(temp("ms-data-"), { [MULTI_SCRIPTS_ENV]: "/no/such/folder" })).toBeNull();
  });
});

describe("installing the folder into a data directory", () => {
  it("copies it, returns its hash and replaces an older copy", () => {
    const data = temp("ms-install-");
    const first = makeOverlay([{ code: 1, text: "A" }]);
    const hash = installMultiScripts(data, first);
    expect(hash).toBe(multiScriptsFolderHash(first));
    expect(multiScriptsFolderHash(join(data, "multi-scripts"))).toBe(hash);
    const second = makeOverlay([{ code: 2, text: "B" }]);
    expect(installMultiScripts(data, second)).toBe(multiScriptsFolderHash(second));
    expect(readMultiScriptsManifest(join(data, "multi-scripts")).map((card) => card.code)).toEqual([2]);
  });

  it("refuses a broken folder and leaves the old copy", () => {
    const data = temp("ms-install-");
    const good = makeOverlay([{ code: 1, text: "A" }]);
    const hash = installMultiScripts(data, good);
    expect(() => installMultiScripts(data, makeOverlay([], { utility: null }))).toThrow(/has no mp-utility\.lua/);
    expect(multiScriptsFolderHash(join(data, "multi-scripts"))).toBe(hash);
  });

  it("leaves no sibling folders behind and swaps in one step", () => {
    const data = temp("ms-install-");
    installMultiScripts(data, makeOverlay([{ code: 1, text: "A" }]));
    installMultiScripts(data, makeOverlay([{ code: 2, text: "B" }]));
    expect(readdirSync(data).sort()).toEqual(["multi-scripts"]);
  });

  it("installs the repo folder by default", () => {
    const data = temp("ms-install-");
    expect(installMultiScripts(data)).toBe(multiScriptsFolderHash(repoMultiScriptsDirectory()));
  });
});
