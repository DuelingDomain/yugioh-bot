import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import {
  checkCoreCompatibility, detectOverlayConflicts, diffScripts, findNewRisks, readPins, rewritePins, runUpdate,
  type Pins,
} from "../scripts/update-engine-data.js";

const oldPins: Pins = { scripts: "a".repeat(40), database: "b".repeat(40), strings: "c".repeat(40) };
const nextPins: Pins = { scripts: "d".repeat(40), database: "e".repeat(40), strings: "f".repeat(40) };
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "engine-data-test-"));
  temporary.push(root);
  execFileSync("git", ["init", "-q", root]);
  const files = {
    "packages/duel-server/scripts/prepare-data.ts": `const sources = ${JSON.stringify({ corePackage: "ocgcore-wasm@0.1.2", ...oldPins })};`,

  };
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), content);
  }
  for (const path of ["domain-core/pins.json", "legacy-1v1/domain-core/pins.json"]) {
    await mkdir(dirname(join(root, "packages/duel-server", path)), { recursive: true });
    await writeFile(join(root, "packages/duel-server", path), JSON.stringify({ ygoproCore: { commit: "1".repeat(40) } }));
  }
  execFileSync("git", ["-C", root, "add", "."]);
  return { root, files };
}

describe("engine data update", () => {
  it("diffs full official script lists, including removals, without counting helpers or unofficial cards", () => {
    const old = new Map([["official/c1.lua", "one"], ["official/c2.lua", "two"], ["official/c3.lua", "three"]]);
    const next = new Map([["official/c1.lua", "one"], ["official/c2.lua", "changed"], ["official/c4.lua", "four"], ["utility.lua", "helper"], ["unofficial/c5.lua", "five"]]);
    expect(diffScripts(old, next)).toEqual({ added: ["official/c4.lua"], changed: ["official/c2.lua"], removed: ["official/c3.lua"] });
  });

  it("reports changed, missing, and unrecorded stock hashes, never silently refreshing the manifest", () => {
    const cards = [1, 2, 3, 4].map((code) => ({ code, file: `c${code}.lua`, stockSha256: code === 4 ? undefined : sha256("original") }));
    const before = JSON.stringify(cards);
    expect(detectOverlayConflicts(cards, new Map([["official/c1.lua", "original"], ["official/c2.lua", "edited"], ["official/c4.lua", "new"]]))).toEqual([
      { ...cards[1], actualSha256: sha256("edited") }, { ...cards[2], actualSha256: null }, { ...cards[3], actualSha256: sha256("new") },
    ]);
    expect(JSON.stringify(cards)).toBe(before);
  });

  it("checks stock scripts outside official too, including the pre-errata overlay", () => {
    const cards = [{ code: 1, file: "c1.lua", stockSha256: sha256("pre-errata") }];
    expect(detectOverlayConflicts(cards, new Map([["pre-errata/c1.lua", "pre-errata"]]))).toEqual([]);
  });

  it("rewrites the allowlisted data source, leaving core pins untouched", async () => {
    const { root, files } = await fixture();
    const rewritten = await rewritePins(root, oldPins, nextPins, false);
    expect(rewritten.sort()).toEqual(Object.keys(files).sort());
    for (const [file, original] of Object.entries(files)) {
      let expected = original;
      for (const key of Object.keys(oldPins) as (keyof Pins)[]) expected = expected.replaceAll(oldPins[key], nextPins[key]);
      expect(await readFile(join(root, file), "utf8")).toBe(expected);
    }
    expect(await readPins(root)).toEqual(nextPins);
  });

  it("discovers every current tracked occurrence without modifying the real repository", async () => {
    const root = resolve(import.meta.dirname, "../../..");
    const pins = await readPins(root);
    const matches = execFileSync("git", ["grep", "-l", "-E", Object.values(pins).join("|")], { cwd: root, encoding: "utf8" }).trim().split("\n");
    expect((await rewritePins(root, pins, nextPins, true)).sort()).toEqual(matches.sort());
  });

  it("dry-run discovers rewrites but writes no pins", async () => {
    const { root, files } = await fixture();
    expect(await rewritePins(root, oldPins, nextPins, true)).toHaveLength(Object.keys(files).length);
    for (const [file, original] of Object.entries(files)) expect(await readFile(join(root, file), "utf8")).toBe(original);
  });

  it("limits new risks to new/changed flagged scripts not in the existing lists", () => {
    // The existing scanner flags per-player Lua tables as F.
    const source = "s.player_state[tp]=false\n";
    const scripts = new Map([["official/c999999991.lua", source], ["official/c999999992.lua", source], ["official/c999999993.lua", "Duel.Draw(tp,1,REASON_EFFECT)"]]);
    expect(findNewRisks(scripts, ["official/c999999991.lua", "official/c999999993.lua"], new Set())).toMatchObject([{ code: 999999991, cls: "F", flagged: true }]);
    expect(findNewRisks(scripts, ["official/c999999991.lua"], new Set([999999991]))).toEqual([]);
  });

  it("returns no update with mocked API heads, without downloading data or modifying pins", async () => {
    const { root } = await fixture();
    const request = vi.fn(async (url: string | URL | Request) => {
      const key = String(url).includes("CardScripts") ? "scripts" : String(url).includes("BabelCDB") ? "database" : "strings";
      return new Response(JSON.stringify([{ sha: oldPins[key] }]));
    });
    const result = await runUpdate({ root, report: ".status/report.md", request });
    expect(result.changed).toBe(false);
    expect(request).toHaveBeenCalledTimes(3);
    expect(await readPins(root)).toEqual(oldPins);
    expect(await readFile(join(root, ".status/report.md"), "utf8")).toContain("no update");
  });

  it("accepts unchanged overrides offline and rejects malformed SHAs before any requests", async () => {
    const { root } = await fixture();
    const request = vi.fn(() => { throw new Error("network forbidden"); });
    expect((await runUpdate({ root, overrides: oldPins, request })).changed).toBe(false);
    expect(request).not.toHaveBeenCalled();
    await expect(runUpdate({ root, overrides: { scripts: "main; echo nope" }, request })).rejects.toThrow(/40.*hex/i);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([true, false])("reports a complete mocked update (dryRun=%s), preserving overlays and core pins", async (dryRun) => {
    const { root } = await fixture();
    const manifest = { cards: [{ code: 1, file: "c1.lua", name: "Old card", stockSha256: sha256("old") }] };
    const manifestPath = join(root, "packages/duel-server/domain-core/multi-scripts/MANIFEST.json");
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, JSON.stringify(manifest));
    const stock = join(root, "stock/official");
    await mkdir(stock, { recursive: true });
    await writeFile(join(stock, "c1.lua"), "s.state[tp]=true\n");
    await writeFile(join(stock, "c2.lua"), "-- new script\n");
    const archive = execFileSync("tar", ["-czf", "-", "-C", root, "stock"]);
    const dbPath = join(root, "cards.cdb");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE texts (id INTEGER, name TEXT); INSERT INTO texts VALUES (1, 'Changed card'), (2, 'New card');");
    db.close();
    const database = await readFile(dbPath);
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/compare/")) return Response.json({ ahead_by: 2, behind_by: 0, status: "ahead" });
      if (url.includes("/git/trees/")) {
        const old = url.includes(oldPins.scripts);
        return Response.json({ truncated: false, tree: [
          { path: "official/c1.lua", type: "blob", sha: old ? "old" : "changed" },
          { path: old ? "official/c3.lua" : "official/c2.lua", type: "blob", sha: "other" },
        ] });
      }
      if (url.includes("codeload.github.com")) return new Response(new Uint8Array(archive));
      if (url.endsWith("/cards.cdb")) return new Response(new Uint8Array(database));
      throw new Error(`Unexpected request: ${url}`);
    });
    const result = await runUpdate({ root, overrides: nextPins, dryRun, request });
    expect(result.changed).toBe(true);
    expect(await readPins(root)).toEqual(dryRun ? oldPins : nextPins);
    const report = await readFile(result.reportPath, "utf8");
    expect(report).toContain("New official card scripts (1)");
    expect(report).toContain("New card");
    expect(report).toContain("Changed official scripts (1)");
    expect(report).toContain("Removed official scripts (1)");
    expect(report).toContain("Overlay conflicts (1)");
    expect(report).toContain("New multiplayer risks (1)");
    expect(report).toContain("merge at a quiet time");
    expect(await readFile(manifestPath, "utf8")).toBe(JSON.stringify(manifest));
    const pins = JSON.parse(await readFile(join(root, "packages/duel-server/domain-core/pins.json"), "utf8"));
    expect(pins.ygoproCore.commit).toBe("1".repeat(40));
  });

  it("does not rewrite pins when an upstream request fails", async () => {
    const { root } = await fixture();
    const request = vi.fn(async () => new Response("rate limited", { status: 403 }));
    await expect(runUpdate({ root, overrides: nextPins, request })).rejects.toThrow("Download failed (403)");
    expect(await readPins(root)).toEqual(oldPins);
  });

  it("rejects pin occurrences outside the exact allowlist before writing anything", async () => {
    const { root } = await fixture();
    await writeFile(join(root, "unexpected.txt"), oldPins.scripts);
    execFileSync("git", ["-C", root, "add", "unexpected.txt"]);
    await expect(rewritePins(root, oldPins, nextPins, false)).rejects.toThrow(/unexpected.txt/);
    expect(await readPins(root)).toEqual(oldPins);
  });

  it("does not match a suffix of another property when reading pins", async () => {
    const { root } = await fixture();
    const path = join(root, "packages/duel-server/scripts/prepare-data.ts");
    await writeFile(path, `const distractor = { myscripts: "${nextPins.scripts}" };\n${await readFile(path, "utf8")}`);
    expect(await readPins(root)).toEqual(oldPins);
  });

  it.each(["behind", "diverged"])("refuses a %s manual SHA without rewriting pins", async (status) => {
    const { root } = await fixture();
    const request = vi.fn(async () => Response.json({ status, ahead_by: 1, behind_by: 1 }));
    await expect(runUpdate({ root, overrides: nextPins, request })).rejects.toThrow(/behind|diverged/);
    expect(await readPins(root)).toEqual(oldPins);
  });

  it("checks cached pinned macro registrations and aliases, excludes Lua helpers, and flags unknown names", async () => {
    const { root } = await fixture();
    const cache = join(root, "packages/duel-server/domain-core/.build/ygopro-core");
    await mkdir(cache, { recursive: true });
    execFileSync("git", ["init", "-q", cache]);
    await writeFile(join(cache, "libduel.cpp"), "LUA_STATIC_FUNCTION(Draw) {}\nLUA_FUNCTION_ALIAS(DrawAlias);\n");
    await writeFile(join(cache, "libcard.cpp"), "LUA_FUNCTION(GetCode) {}\n");
    await writeFile(join(cache, "libeffect.cpp"), 'LUA_STATIC_FUNCTION(CreateEffect) {}\n{"OldExport", pointer},\n');
    execFileSync("git", ["-C", cache, "add", "."]);
    const tree = execFileSync("git", ["-C", cache, "write-tree"], { encoding: "utf8" }).trim();
    const commit = execFileSync("git", ["-C", cache, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit-tree", tree], {
      encoding: "utf8", input: "Core fixture\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01Jo347fwscScmug26ujsNN2\n",
    }).trim();
    const pinPath = join(root, "packages/duel-server/domain-core/pins.json");
    const pins = JSON.parse(await readFile(pinPath, "utf8"));
    pins.ygoproCore.commit = commit;
    await writeFile(pinPath, JSON.stringify(pins));
    const source = "Duel.Draw(tp,1,0)\nDuel.DrawAlias(tp)\nCard.GetCode(c)\nEffect.CreateEffect(c)\nEffect.OldExport()\nDuel.Helper()\nDuel.NewAPI()\n";
    const changed = new Map([["official/c1.lua", source]]);
    const stock = new Map([...changed, ["utility.lua", "function Duel.Helper() end\n"]]);
    const notes = await checkCoreCompatibility(root, changed, stock);
    expect(notes.join("\n")).not.toContain("Skipped");
    expect(notes.filter((line) => line.startsWith("-"))).toEqual(["- **may need a newer core**: `Duel.NewAPI` (`official/c1.lua`)"]);
  });
});
