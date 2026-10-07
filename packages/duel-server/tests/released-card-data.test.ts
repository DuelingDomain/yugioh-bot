import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { prepareData, sources } from "../scripts/prepare-data.js";
import { discoverReleasedDatabases, downloadReleasedCardData, restrictPrereleaseScripts } from "../scripts/released-card-data.js";
import * as releasedCardData from "../scripts/released-card-data.js";
import { loadCardDatabase } from "../src/cards.js";
import { inspectDeck } from "../src/deck-legality.js";
import { loadArtworkIdentityCatalog, mainArtworkId } from "../../shared/dist/services/card-artworks.js";
import { normalizeDuelSettings } from "@yugidraft/shared/duels";
import { openDatabase } from "@yugidraft/shared/db";
import { createCardCatalogService } from "@yugidraft/shared/services";

const roots: string[] = [];
const root = () => { const dir = mkdtempSync(join(tmpdir(), "released-data-test-")); roots.push(dir); return dir; };
afterEach(() => { roots.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const tree = (paths: string[]) => ({ truncated: false, tree: paths.map(path => ({ path, type: "blob", sha: "unused" })) });
function cdb(dir: string, name: string, rows: Array<[number, number, string]>) {
  const path = join(dir, name);
  const db = new Database(path);
  db.exec(`CREATE TABLE datas (id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode INTEGER, type INTEGER,
    atk INTEGER, def INTEGER, level INTEGER, race INTEGER, attribute INTEGER, category INTEGER);
    CREATE TABLE texts (id INTEGER PRIMARY KEY, name TEXT, desc TEXT);`);
  for (const [code, alias, label] of rows) {
    db.prepare("INSERT INTO datas VALUES (?,3,?,9223372036854775807,33,2500,2000,7,1,32,0)").run(code, alias);
    db.prepare("INSERT INTO texts VALUES (?,?,'release effect')").run(code, label);
  }
  db.close();
  return readFileSync(path);
}
function fixture() {
  const dir = root();
  const databases = new Map([
    ["cards.cdb", cdb(dir, "base.cdb", [[1, 0, "Base"], [2, 0, "Old text"]])],
    ["release-z.cdb", cdb(dir, "z.cdb", [[2, 1, "Released text"], [17242022, 0, "Red-Eyes Black Dragon Exceed"], [17242023, 17242022, "Red-Eyes Black Dragon Exceed"]])],
    ["release-a.cdb", cdb(dir, "a.cdb", [[2, 0, "Earlier release"]])],
  ]);
  const scripts = join(dir, "stock"); mkdirSync(join(scripts, "official"), { recursive: true }); mkdirSync(join(scripts, "pre-release"));
  for (const file of ["official/c1.lua", "official/c2.lua", "pre-release/c17242022.lua", "pre-release/c999.lua"]) writeFileSync(join(scripts, file), `-- ${file}\n`);
  const archive = execFileSync("tar", ["-czf", "-", "-C", dir, "stock"]);
  const request = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/git/trees/")) return Response.json(tree(["release-z.cdb", "prerelease-hidden.cdb", "cards-rush.cdb", "release-a.cdb", "cards.cdb", "cards-skills.cdb", "cards-unofficial.cdb", "goat-entries.cdb"]));
    if (url.endsWith("strings.conf")) return new Response("!system 1 Test\n");
    if (url.includes("codeload.github.com")) return new Response(new Uint8Array(archive));
    const bytes = databases.get(url.split("/").pop()!);
    if (bytes) return new Response(new Uint8Array(bytes));
    throw new Error(`Unexpected download ${url}`);
  });
  return { request, databases, directory: join(dir, "bundle") };
}

it.each([
  [403, { "Retry-After": "2" }, 2_000],
  [429, { "Retry-After": "Tue, 06 Oct 2026 12:00:03 GMT" }, 3_000],
  [403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1791288004" }, 4_000],
  [503, { "Retry-After": "1", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1791288004" }, 4_000],
  [403, { "x-ratelimit-reset": "1791288004" }, 1_000],
  [403, { "x-ratelimit-remaining": "1", "x-ratelimit-reset": "1791288004" }, 1_000],
  [429, { "Retry-After": "2", "x-ratelimit-remaining": "1", "x-ratelimit-reset": "1791288004" }, 2_000],
  [500, {}, 1_000],
])("retries a %i tree response with authentication after the server's delay", async (status, headers, delay) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
  vi.stubEnv("GH_TOKEN", "");
  vi.stubEnv("GITHUB_TOKEN", "test-read-token");
  const request = vi.fn()
    .mockResolvedValueOnce(new Response("retry", { status, headers }))
    .mockResolvedValueOnce(Response.json(tree(["cards.cdb"])));
  const result = discoverReleasedDatabases(sources.database, request);
  const assertion = expect(result).resolves.toEqual(["cards.cdb"]);
  await vi.advanceTimersByTimeAsync(delay - 1);
  expect(request).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(request).toHaveBeenCalledTimes(2);
  await assertion;
  expect(request.mock.calls[1][1].headers.Authorization).toBe("Bearer test-read-token");
});

it.each<Record<string, string>>([
  { "Retry-After": "3600" },
  { "Retry-After": "Tue, 06 Oct 2026 13:00:00 GMT" },
  { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1791291600" },
])("caps each server delay at one minute and fails after three retries: %j", async headers => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
  const request = vi.fn(async () => new Response("retry", { status: 429, headers }));
  const assertion = expect(discoverReleasedDatabases(sources.database, request)).rejects.toThrow("(429)");
  for (let retry = 1; retry <= 3; retry++) {
    await vi.advanceTimersByTimeAsync(59_999);
    expect(request).toHaveBeenCalledTimes(retry);
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(retry + 1);
  }
  await assertion;
});

it("stops after three retries and does not retry other client errors", async () => {
  vi.useFakeTimers();
  const limited = vi.fn(async () => new Response("retry", { status: 403 }));
  const assertion = expect(discoverReleasedDatabases(sources.database, limited)).rejects.toThrow("(403)");
  await vi.runAllTimersAsync();
  await assertion;
  expect(limited).toHaveBeenCalledTimes(4);
  const missing = vi.fn(async () => new Response("missing", { status: 404 }));
  await expect(discoverReleasedDatabases(sources.database, missing)).rejects.toThrow("(404)");
  expect(missing).toHaveBeenCalledTimes(1);
});

it("merges release rows and text deterministically without converting SQLite 64-bit values or loading prerelease data", async () => {
  const { request, directory } = fixture(); mkdirSync(directory);
  const first = await downloadReleasedCardData(sources.database, directory, request);
  const bytes = readFileSync(first.path);
  const secondDir = root();
  const second = await downloadReleasedCardData(sources.database, secondDir, request);
  expect(readFileSync(second.path)).toEqual(bytes);
  expect(first.files).toEqual(["cards.cdb", "release-a.cdb", "release-z.cdb"]);
  expect([...first.releaseCodes].sort((a,b) => a-b)).toEqual([2,17242022,17242023]);
  const db = new Database(first.path, { readonly: true });
  try {
    expect(db.prepare("SELECT name FROM texts WHERE id=2").get()).toEqual({ name: "Released text" });
    expect(db.prepare("SELECT alias FROM datas WHERE id=2").get()).toEqual({ alias: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM datas").get()).toEqual({ n: 4 });
    expect(db.prepare("SELECT setcode FROM datas WHERE id=17242022").safeIntegers().get()).toEqual({ setcode: 9223372036854775807n });
  } finally { db.close(); }
  expect(request.mock.calls.every(([input]) => !String(input).includes("prerelease-hidden.cdb"))).toBe(true);
});

it("drops obsolete release files and rebuilds from the base after Ignis merges a set", async () => {
  const { request, directory } = fixture();
  await downloadReleasedCardData(sources.database, directory, request);
  const base = cdb(root(), "upstream.cdb", [[1, 0, "Base"], [17242022, 0, "Merged upstream"]]);
  const nextRequest = vi.fn(async (input: string | URL | Request) => {
    if (String(input).includes("/git/trees/")) return Response.json(tree(["cards.cdb", "prerelease-next.cdb"]));
    if (String(input).endsWith("/cards.cdb")) return new Response(new Uint8Array(base));
    throw new Error(`Obsolete release download: ${input}`);
  });
  const next = await downloadReleasedCardData("a".repeat(40), directory, nextRequest);
  expect(next.files).toEqual(["cards.cdb"]);
  expect(next.releaseCodes.size).toBe(0);
  expect(next.bytes).toEqual(base);
  expect(existsSync(join(directory, "release-z.cdb"))).toBe(false);
});

it("keeps pre-release card scripts only for loaded release codes and prefers official copies", () => {
  const dir = root(); mkdirSync(join(dir, "pre-release")); mkdirSync(join(dir, "official"));
  for (const file of ["pre-release/c1.lua", "pre-release/c2.lua", "pre-release/c3.lua", "official/c2.lua"]) writeFileSync(join(dir, file), file);
  restrictPrereleaseScripts(dir, new Set([1, 2]));
  expect(existsSync(join(dir, "pre-release/c1.lua"))).toBe(true);
  expect(existsSync(join(dir, "pre-release/c2.lua"))).toBe(false);
  expect(existsSync(join(dir, "pre-release/c3.lua"))).toBe(false);
});

it("loads official scripts before pre-release and other duplicate basenames while preserving explicit paths", async () => {
  const { request, directory } = fixture();
  await prepareData(directory, request);
  const scriptRoot = join(directory, "card-scripts");
  for (const folder of ["official", "pre-release", "pre-errata", "unofficial"]) {
    mkdirSync(join(scriptRoot, folder), { recursive: true });
    for (const code of [95200011, 95200012, 95200013, 95200102]) writeFileSync(join(scriptRoot, folder, `c${code}.lua`), folder);
  }
  writeFileSync(join(scriptRoot, "pre-release/c17242022.lua"), "pre-release");
  writeFileSync(join(scriptRoot, "unofficial/c17242022.lua"), "unofficial");
  writeFileSync(join(scriptRoot, "unofficial/helper.lua"), "other helper");
  writeFileSync(join(scriptRoot, "helper.lua"), "root helper");
  const cards = loadCardDatabase(directory);
  try {
    for (const code of [95200011, 95200012, 95200013, 95200102]) {
      expect(cards.readScript(`c${code}.lua`)).toBe("official");
      expect(cards.readScript(`unofficial/c${code}.lua`)).toBe("unofficial");
      expect(cards.readScript(`pre-errata/c${code}.lua`)).toBe("pre-errata");
    }
    expect(cards.readScript("c17242022.lua")).toBe("pre-release");
    expect(cards.readScript("helper.lua")).toBe("root helper");
  } finally { cards.close(); }
});

it("prepares a versioned merged manifest visible to artwork identity, engine readers and duel deck validation", async () => {
  const { request, databases, directory } = fixture();
  const result = await prepareData(directory, request);
  expect(result.skipped).toBe(false);
  expect(result.sources.databaseFiles).toEqual(["cards.cdb", "release-a.cdb", "release-z.cdb"]);
  expect(result.integrity.cards).toBe(hash(["cards.cdb", "release-a.cdb", "release-z.cdb"].map(file => `${file}:${hash(databases.get(file)!)}`).join("\n")));
  expect(result.integrity.cardsMerged).toBe(hash(readFileSync(join(directory, "cards.cdb"))));
  const { multiScripts: _overlay, cardsMerged: _merged, ...engine } = result.integrity;
  expect(result.bundleVersion).toBe(hash(JSON.stringify({ sources: result.sources, integrity: engine })));
  const cards = loadCardDatabase(directory);
  try {
    expect(cards.cardData(17242023)?.alias).toBe(17242022);
    expect(cards.get(17242023)?.canonicalPasscode).toBe(17242022);
    expect(cards.readScript("c17242022.lua")).toContain("pre-release/c17242022.lua");
    expect(cards.readScript("c999.lua")).toBeNull();
  } finally { cards.close(); }
  const identity = loadArtworkIdentityCatalog(directory);
  expect(mainArtworkId({ id: 17242023, name: "Red-Eyes Black Dragon Exceed", card_images: [{id:17242023}, {id:17242022}] }, identity)).toBe(17242022);
  vi.stubEnv("DUEL_DATA_DIR", directory);
  const app = openDatabase(":memory:");
  try {
    app.prepare(`INSERT INTO card_catalog (ygoprodeck_id,name,type,frame_type,effect_text,image_url,image_url_small,card_sets_json,cached_at)
      VALUES (17242022,'Red-Eyes Black Dragon Exceed','Effect Monster','effect','','main','small','[]','now')`).run();
    const fetch = vi.fn();
    const catalog = createCardCatalogService(app, { fetch });
    await catalog.syncDraftPool({ setNames: [], includeNames: [], excludeNames: [], customCardIds: [17242023] });
    expect(fetch).not.toHaveBeenCalled();
    expect(app.prepare("SELECT card_id,artwork_id,source FROM card_artworks WHERE artwork_id=17242023").get())
      .toEqual({ card_id: 17242022, artwork_id: 17242023, source: "engine" });
  } finally { app.close(); }
  expect(inspectDeck("normal", { main:[17242023], extra:[], side:[] }, directory,
    normalizeDuelSettings("normal", { validateDeck:false, startingHand:1, banlist:"none", cardPool:"both" })).issues).toEqual([]);
  request.mockClear();
  expect((await prepareData(directory, request)).skipped).toBe(true);
  expect(request).not.toHaveBeenCalled();
});

it("rebuilds an old base-only cache at identical pins and preserves built Domain resources", async () => {
  const { request, directory } = fixture();
  const first = await prepareData(directory, request);
  const { databaseFormat: _format, databaseFiles: _files, ...oldSources } = first.sources;
  writeFileSync(join(directory, "card-scripts/domain.lua"), "domain");
  writeFileSync(join(directory, "card-scripts/domain.legacy.lua"), "legacy domain");
  writeFileSync(join(directory, "ocgcore.domain.wasm"), "domain wasm");
  writeFileSync(join(directory, "ocgcore.domain.legacy.wasm"), "legacy wasm");
  const old = { ...first, sources:{...oldSources, domainCore:{pin:"domain"}, domainCoreLegacy:{pin:"legacy"}} };
  writeFileSync(join(directory, "manifest.json"), JSON.stringify(old));
  request.mockClear();
  const updated = await prepareData(directory, request);
  expect(updated.skipped).toBe(false);
  expect(request).toHaveBeenCalled();
  expect(updated.sources.domainCore).toEqual({pin:"domain"});
  expect(updated.integrity.domainWasm).toBe(hash("domain wasm"));
  expect(updated.integrity.domainLua).toBe(hash("domain"));
  expect(updated.integrity.domainLegacyLua).toBe(hash("legacy domain"));
  expect(updated.bundleVersion).not.toBe(old.bundleVersion);
});

it("keeps the bundle version stable when SQLite changes only the merged bytes", async () => {
  const { request, directory } = fixture();
  const first = await prepareData(directory, request);
  const merge = releasedCardData.downloadReleasedCardData;
  vi.spyOn(releasedCardData, "downloadReleasedCardData").mockImplementation(async (...args) => {
    const result = await merge(...args);
    const bytes = Buffer.from(result.bytes);
    bytes.writeUInt32BE(bytes.readUInt32BE(96) + 1, 96); // SQLite's library version header
    return { ...result, bytes };
  });
  const second = await prepareData(join(root(), "bundle"), request);
  expect(second.integrity.cardsMerged).not.toBe(first.integrity.cardsMerged);
  expect(second.integrity.cards).toBe(first.integrity.cards);
  expect(second.bundleVersion).toBe(first.bundleVersion);
});

it("rebuilds merged-byte manifests and corrupt output, but changes version only for changed inputs", async () => {
  const { request, databases, directory } = fixture();
  const first = await prepareData(directory, request);
  const { cardsMerged: _merged, ...oldIntegrity } = first.integrity;
  writeFileSync(join(directory, "manifest.json"), JSON.stringify({ sources: first.sources, integrity: oldIntegrity, bundleVersion: first.bundleVersion }));
  request.mockClear();
  expect((await prepareData(directory, request)).skipped).toBe(false);
  expect(request).toHaveBeenCalled();
  writeFileSync(join(directory, "cards.cdb"), "corrupt");
  const repaired = await prepareData(directory, request);
  expect(repaired.skipped).toBe(false);
  expect(repaired.integrity.cardsMerged).toBe(first.integrity.cardsMerged);
  expect(repaired.bundleVersion).toBe(first.bundleVersion);
  databases.set("release-z.cdb", cdb(root(), "changed.cdb", [[2, 1, "Changed upstream"]]));
  rmSync(join(directory, "manifest.json"));
  expect((await prepareData(directory, request)).bundleVersion).not.toBe(first.bundleVersion);
});
