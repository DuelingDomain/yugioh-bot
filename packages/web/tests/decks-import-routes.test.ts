import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { migrate } from "@yugidraft/shared/db";
import { createSavedDeckService } from "@yugidraft/shared/services";
import { encodeYdke } from "@yugidraft/shared/decks";

const mocks = vi.hoisted(() => ({ savedActor: vi.fn(), duelActor: vi.fn(), callDuelHost: vi.fn() }));
vi.mock("@/lib/saved-decks", async original => ({
  ...await original<typeof import("../src/lib/saved-decks")>(), requireSavedDeckActor: mocks.savedActor,
}));
vi.mock("@/lib/duel-host", () => ({ requireDuelActor: mocks.duelActor, callDuelHost: mocks.callDuelHost }));

import { POST as preview } from "../app/api/decks/import/preview/route";
import { POST as bulk } from "../app/api/decks/import/bulk/route";

let db: Database.Database;
let decks: ReturnType<typeof createSavedDeckService>;
let testTime = 1700000000000;
const deck = (main = [89631139]) => ({ main, extra: [] as number[], side: [] as number[], deckMaster: null });
const source = (text = "#main\n89631139\n#extra\n!side", id = "f1", name = "Blue_Eyes.ydk") => ({ id, name, text });
const request = (body: unknown, headers?: HeadersInit) => new Request("http://test/api/decks/import", {
  method: "POST", headers, body: JSON.stringify(body),
});
const row = (name = "Blue-Eyes", value: unknown = deck()) => ({ name, deck: value });
const previewRows = async (sources: unknown[] = [source()]) => (await (await preview(request({ sources }))).json()).rows;

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(testTime += 600000);
  db = new Database(":memory:");
  migrate(db);
  db.exec("insert into users(id, username, display_name) values (1, 'owner', 'Owner'), (2, 'other', 'Other')");
  decks = createSavedDeckService(db);
  mocks.savedActor.mockResolvedValue({ ok: true, guildId: "g", ownerUserId: 1, discordUserId: null, decks });
  mocks.duelActor.mockResolvedValue({ ok: true, guildId: "g", playerId: 7 });
  mocks.callDuelHost.mockImplementation(async (input: { op: string; codes?: number[] }) => ({
    ok: true, data: input.op === "normalize-codes"
      ? { codes: Object.fromEntries(input.codes!.map(id => [id, id === 999 ? null : id === 101402052 ? 40235813 : id])) }
      : { ok: true },
  }));
});
afterEach(() => { db.close(); vi.restoreAllMocks(); });

describe("backend review fixes", () => {
  it("sends one import budget and uses cache only for saved-deck identities", async () => {
    decks.create("g", 1, { name: "Old", mode: "normal", deck: { main: [777], extra: [], side: [] } });
    const response = await preview(request({ sources: [source()] }));
    expect(response.status).toBe(200);
    const calls = mocks.callDuelHost.mock.calls.map(([input]) => input);
    expect(calls).toContainEqual(expect.objectContaining({ op: "normalize-codes", codes: [89631139], lookupLimit: 50, includeCanonical: true }));
    expect(calls).toContainEqual(expect.objectContaining({ op: "normalize-codes", codes: [777], cacheOnly: true, lookupLimit: 0 }));
    expect(calls.filter(input => !input.cacheOnly).flatMap(input => input.codes)).not.toContain(777);
  });

  it.each([preview, bulk])("reports skipped lookups as row errors", async route => {
    const codes = Array.from({ length: 55 }, (_, i) => 90000000 + i);
    mocks.callDuelHost.mockResolvedValue({ ok: true, data: {
      codes: Object.fromEntries(codes.map((id, i) => [id, i < 50 ? id : null])),
      lookupRemaining: 0, lookupLimited: codes.slice(50),
    } });
    const response = await route(request(route === preview ? { sources: [source(`#main\n${codes.join("\n")}`)] } : { rows: [row("Limited", deck(codes))] }));
    expect(response.status).toBe(200);
    const body = await response.json();
    const errors = route === preview ? body.rows[0].errors : body.failed[0].errors;
    expect(errors).toHaveLength(5);
    expect(errors[0]).toMatchObject({ code: "lookup_limited", message: "lookup limit reached, try again", passcode: codes[50] });
    expect(mocks.callDuelHost).toHaveBeenCalledWith(expect.objectContaining({ lookupLimit: 50 }));
  });

  it("carries the remaining budget between batches", async () => {
    const codes = Array.from({ length: 1200 }, (_, i) => 90000000 + i);
    mocks.callDuelHost.mockImplementation(async (input: { codes: number[] }) => ({ ok: true, data: {
      codes: Object.fromEntries(input.codes.map(id => [id, id])), lookupRemaining: 0, lookupLimited: [],
    } }));
    const response = await bulk(request({ rows: Array.from({ length: 4 }, (_, i) => row(`Deck ${i}`, deck(codes.slice(i * 300, (i + 1) * 300)))) }));
    expect(response.status).toBe(200);
    expect(mocks.callDuelHost.mock.calls.map(([input]) => input.lookupLimit)).toEqual([50, 0]);
  });

  it.each([preview, bulk])("rejects more than 4550 unique request codes before host work", async route => {
    const codes = Array.from({ length: 4800 }, (_, i) => 90000000 + i);
    const response = await route(request(route === preview
      ? { sources: Array.from({ length: 16 }, (_, i) => source(`#main\n${codes.slice(i * 300, (i + 1) * 300).join("\n")}`, `f${i}`)) }
      : { rows: Array.from({ length: 16 }, (_, i) => row(`Deck ${i}`, deck(codes.slice(i * 300, (i + 1) * 300)))) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Import must contain at most 4550 unique card codes" });
    expect(mocks.callDuelHost).not.toHaveBeenCalled();
  });

  it("rate limits preview and bulk together per user and refills a token each minute", async () => {
    for (let i = 0; i < 6; i++) {
      const response = i % 2 ? await bulk(request({ rows: [row()] })) : await preview(request({ sources: [source()] }));
      expect(response.status).toBe(200);
    }
    const calls = mocks.callDuelHost.mock.calls.length;
    for (const route of [preview, bulk]) {
      const response = await route(request(route === preview ? { sources: [source()] } : { rows: [row()] }));
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("60");
      expect(await response.json()).toHaveProperty("error");
    }
    expect(mocks.callDuelHost).toHaveBeenCalledTimes(calls);
    mocks.savedActor.mockResolvedValueOnce({ ok: true, guildId: "g", ownerUserId: 2, decks });
    expect((await preview(request({ sources: [source()] }))).status).toBe(200);
    vi.spyOn(Date, "now").mockReturnValue(testTime + 60000);
    expect((await bulk(request({ rows: [row()] }))).status).toBe(200);
    expect((await preview(request({ sources: [source()] }))).status).toBe(429);
  });

  it("retains valid YDK cards and returns bad lines as warnings", async () => {
    const [shown] = await previewRows([source("# MAIN deck\n89631139\n89631139 Blue-Eyes\n# Extra deck\n! SIDE")]);
    expect(shown.deck.main).toEqual([89631139]);
    expect(shown.errors).toEqual([]);
    expect(shown.warnings).toContainEqual(expect.objectContaining({ code: "invalid_passcode", line: 3 }));
  });

  it("bounds the response and the total errors plus warnings per row", async () => {
    const response = await preview(request({ sources: [source(`#main\n${"a\n".repeat(10000)}89631139`)] }));
    const text = await response.text();
    expect(text.length).toBeLessThan(5000);
    const shown = JSON.parse(text).rows[0];
    expect(shown.errors).toEqual([]);
    expect(shown.warnings).toHaveLength(21);
    expect(shown.warnings.at(-1)).toMatchObject({ code: "more_issues", message: "and 9981 more issues", count: 9981 });
  });

  it("caps card errors in both preview and bulk", async () => {
    const codes = Array.from({ length: 100 }, (_, i) => 90000000 + i);
    mocks.callDuelHost.mockResolvedValue({ ok: true, data: { codes: Object.fromEntries(codes.map(id => [id, null])) } });
    const [shown] = await previewRows([source(`#main\n${codes.join("\n")}`)]);
    expect(shown.errors.length + shown.warnings.length).toBe(21);
    expect(shown.errors.slice(0, 20)).toHaveLength(20);
    expect([...shown.errors, ...shown.warnings]).toContainEqual(expect.objectContaining({ code: "more_issues", count: 81 }));
    const body = await (await bulk(request({ rows: [row("Unknown", deck(codes))] }))).json();
    expect(body.failed[0].errors).toHaveLength(21);
    expect(body.failed[0].errors.at(-1)).toMatchObject({ code: "more_issues", count: 80 });
  });

  it.each(["#main\n#extra\n!side", "ydke://!!!", "#main\nbad"])('rejects an empty parsed deck from %s', async text => {
    const [shown] = await previewRows([source(text)]);
    expect(shown.errors).toContainEqual({ code: "empty_deck", message: "No cards found" });
    expect(mocks.callDuelHost).not.toHaveBeenCalled();
  });

  it("rejects an empty bulk row but permits a Deck Master alone", async () => {
    const response = await bulk(request({ rows: [row("Empty", deck([])), row("Master", { ...deck([]), deckMaster: 89631139 })] }));
    const body = await response.json();
    expect(body.failed).toEqual([{ index: 0, errors: [{ code: "empty_deck", message: "No cards found" }] }]);
    expect(body.created).toEqual([{ id: expect.any(Number), name: "Master" }]);
  });

  it.each([preview, bulk])("returns clear 503 JSON if the duel host throws", async route => {
    mocks.callDuelHost.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const response = await route(request(route === preview ? { sources: [source()] } : { rows: [row()] }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Duel engine unavailable, try again" });
    expect(decks.list("g", 1)).toEqual([]);
  });

  it("does not save earlier rows if Deck Master validation becomes unavailable", async () => {
    mocks.callDuelHost.mockImplementation(async (input: { op: string; codes?: number[] }) => {
      if (input.op === "validate-deck-master") throw new Error("connect ECONNREFUSED");
      return { ok: true, data: { codes: Object.fromEntries(input.codes!.map(id => [id, id])) } };
    });
    const response = await bulk(request({ rows: [row("First"), row("Domain", { ...deck(), deckMaster: 89631139 })] }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Duel engine unavailable, try again" });
    expect(decks.list("g", 1)).toEqual([]);
  });

  it("compares canonical identities but keeps chosen artwork", async () => {
    const saved = decks.create("g", 1, { name: "Saved", mode: "normal", deck: { main: [89631139], extra: [], side: [] } });
    mocks.callDuelHost.mockImplementation(async (input: { codes: number[] }) => ({ ok: true, data: {
      codes: Object.fromEntries(input.codes.map(id => [id, id])),
      canonicalCodes: Object.fromEntries(input.codes.map(id => [id, id === 89631133 ? 89631139 : id])),
    } }));
    const [shown] = await previewRows([source("#main\n89631133")]);
    expect(shown.deck.main).toEqual([89631133]);
    expect(shown.duplicateOf).toEqual({ kind: "saved", deckId: saved.id, name: "Saved" });
  });

  it("carries source lines for card issues and split YDKE errors", async () => {
    const rows = await previewRows([source("#main\n999\n101402052"), source("\n ydke://!!!\n\nydke://broken", "f2")]);
    expect(rows[0].errors[0]).toMatchObject({ code: "unknown_card", line: 2 });
    expect(rows[0].warnings).toContainEqual(expect.objectContaining({ code: "remapped", line: 3 }));
    expect(rows[2].errors[0]).toMatchObject({ line: 4 });
  });
});

describe("import request boundary", () => {
  it.each([preview, bulk])("requires the same saved-deck actor before parsing or resolving", async route => {
    mocks.savedActor.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    expect((await route(request({}))).status).toBe(401);
    expect(mocks.duelActor).not.toHaveBeenCalled();
    expect(mocks.callDuelHost).not.toHaveBeenCalled();
  });

  it.each([preview, bulk])("rejects invalid JSON and nonobject bodies", async route => {
    expect((await route(new Request("http://test", { method: "POST", body: "{" }))).status).toBe(400);
    expect((await route(request([]))).status).toBe(400);
    expect((await route(request({}))).status).toBe(400);
  });

  it.each([preview, bulk])("measures the body without trusting Content-Length", async route => {
    const response = await route(request({ padding: "x".repeat(1024 * 1024) }, { "content-length": "1" }));
    expect(response.status).toBe(413);
    expect(await response.json()).toHaveProperty("error");
    expect(mocks.callDuelHost).not.toHaveBeenCalled();
  });

  it("rejects 51 sources, expanded decks or bulk rows before resolution", async () => {
    const sources = Array.from({ length: 51 }, (_, i) => source(undefined, `f${i}`));
    expect((await preview(request({ sources }))).status).toBe(400);
    expect((await preview(request({ sources: [source("ydke://!!!\n".repeat(51))] }))).status).toBe(400);
    expect((await bulk(request({ rows: Array.from({ length: 51 }, () => row()) }))).status).toBe(400);
    expect(mocks.callDuelHost).not.toHaveBeenCalled();
  });

  it("accepts 50 rows and a source of exactly 64 KiB", async () => {
    const text = `#${"x".repeat(64 * 1024 - 2)}\n`;
    expect((await preview(request({ sources: [source(text)] }))).status).toBe(200);
    const response = await bulk(request({ rows: Array.from({ length: 50 }, (_, i) => row(`Deck ${i}`)) }));
    expect(response.status).toBe(200);
    expect((await response.json()).created).toHaveLength(50);
  });

  it("measures source UTF-8 bytes and requires unique string source ids", async () => {
    expect((await preview(request({ sources: [source("é".repeat(32769))] }))).status).toBe(413);
    expect((await preview(request({ sources: [source(), source()] }))).status).toBe(400);
    expect((await preview(request({ sources: [{ id: 1, name: "a", text: "a" }] }))).status).toBe(400);
    expect((await preview(request({ sources: [] }))).status).toBe(400);
  });
});

describe("preview", () => {
  it("accepts an omitted source name and defaults to Standard", async () => {
    const response = await preview(request({ sources: [{ id: "paste", text: "#main\n89631139" }] }));
    expect(response.status).toBe(200);
    expect((await response.json()).rows[0]).toMatchObject({ sourceId: "paste", name: "Untitled deck", mode: "standard", errors: [] });
  });

  it.each(["normal", "invalid", null, 1])("rejects invalid source mode %s before resolution", async mode => {
    expect((await preview(request({ sources: [{ ...source(), mode }] }))).status).toBe(400);
    expect(mocks.callDuelHost).not.toHaveBeenCalled();
  });

  it("echoes Standard and retains its lone Side card", async () => {
    const [shown] = await previewRows([{ ...source("#main\n89631139\n!side\n46986414"), mode: "standard" }]);
    expect(shown).toMatchObject({ mode: "standard", deck: { ...deck(), side: [46986414] }, counts: { main: 1, extra: 0, side: 1 } });
    expect(mocks.callDuelHost).not.toHaveBeenCalledWith(expect.objectContaining({ op: "validate-deck-master" }));
  });

  it.each([
    "#main\n89631139\n!side\n101402052",
    encodeYdke({ ...deck(), side: [101402052] }),
  ])("moves and resolves a lone Domain Side card into Deck Master for %s", async text => {
    const [shown] = await previewRows([{ ...source(text), mode: "domain" }]);
    expect(shown).toMatchObject({ mode: "domain", deck: { ...deck(), deckMaster: 40235813 }, counts: { main: 1, extra: 0, side: 0 }, errors: [] });
    expect(shown.warnings).toContainEqual(expect.objectContaining({ code: "remapped", from: 101402052, to: 40235813 }));
    expect(mocks.callDuelHost).toHaveBeenCalledWith(expect.objectContaining({ op: "validate-deck-master", deck: { main: [], extra: [], side: [], deckMaster: 40235813 } }));
  });

  it("keeps Domain mode for each split line, including a malformed line", async () => {
    const rows = await previewRows([{ ...source("ydke://!!!\r\nydke://broken\r\nydke://!!!"), mode: "domain" }]);
    expect(rows.map((shown: { mode: string }) => shown.mode)).toEqual(["domain", "domain", "domain"]);
    expect(rows[1].errors.length).toBeGreaterThan(0);
  });

  it("selects Domain for an explicit #deckmaster as the existing library importer does", async () => {
    const [shown] = await previewRows([{ ...source("#deckmaster\n46986414\n#main\n89631139\n!side\n14558127"), mode: "standard" }]);
    expect(shown).toMatchObject({ mode: "domain", deck: { ...deck(), deckMaster: 46986414, side: [14558127] }, errors: [] });
  });

  it("keeps an unfinished Domain deck with multiple Side cards for editing", async () => {
    const [shown] = await previewRows([{ ...source("#main\n89631139\n!side\n46986414\n14558127"), mode: "domain" }]);
    expect(shown).toMatchObject({ mode: "domain", deck: { ...deck(), side: [46986414, 14558127] }, errors: [] });
  });

  it("returns contract fields, normalized names, counts and size warnings", async () => {
    const response = await preview(request({ sources: [source()] }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.maxDecks).toBe(50);
    expect(body.rows[0]).toMatchObject({ rowId: "f1#0", sourceId: "f1", name: "Blue Eyes", deck: deck(), counts: { main: 1, extra: 0, side: 0 }, errors: [] });
    expect(body.rows[0].warnings).toContainEqual(expect.objectContaining({ code: "main_size" }));
    expect(decks.list("g", 1)).toEqual([]);
    expect(mocks.callDuelHost).toHaveBeenCalledWith({ op: "normalize-codes", guildId: "g", playerId: 7, codes: [89631139], preserveArtwork: true, lookupLimit: 50, includeCanonical: true });
  });

  it("assigns stable row ids and sequential YDKE names across sources", async () => {
    const rows = await previewRows([source("ydke://!!!\r\n\r\nydke://!!!"), source("ydke://!!!", "f2")]);
    expect(rows.map((r: { rowId: string; name: string }) => [r.rowId, r.name])).toEqual([
      ["f1#0", "Imported deck 1"], ["f1#1", "Imported deck 2"], ["f2#0", "Imported deck 3"],
    ]);
  });

  it("keeps YDKE strict and treats YDK syntax issues as warnings", async () => {
    const rows = await previewRows([source("ydke://o6lXBQ==!!"), source("#main\n89631139\n123junk", "f2"), source("#deckmaster\n1\n2", "f3")]);
    expect(rows).toHaveLength(3);
    expect(rows[0].deck).toEqual(deck([]));
    expect(rows[0].errors.length).toBeGreaterThan(0);
    expect(rows[1]).toMatchObject({ deck: deck(), errors: [] });
    expect(rows[1].warnings[0]).toMatchObject({ code: "invalid_passcode", line: 3 });
    expect(rows[2]).toMatchObject({ deck: { ...deck([]), deckMaster: 1 }, errors: [] });
    expect(rows[2].warnings[0]).toMatchObject({ code: "invalid_deck_master", line: 1 });
  });

  it("keeps unknown passcodes and artwork copies, and reports remaps once", async () => {
    const [result] = await previewRows([source("#main\n999\n999\n101402052\n101402052\n89631133")]);
    expect(result.deck.main).toEqual([999, 999, 40235813, 40235813, 89631133]);
    expect(result.errors).toEqual([{ code: "unknown_card", message: expect.any(String), passcode: 999, line: 2 }]);
    expect(result.warnings.filter((w: { code: string }) => w.code === "remapped")).toEqual([{ code: "remapped", message: expect.any(String), from: 101402052, to: 40235813, line: 4 }]);
  });

  it("detects owner-saved or earlier-row duplicates by the combined card multiset", async () => {
    const saved = decks.create("g", 1, { name: "Saved", mode: "normal", deck: { main: [40235813, 89631139], extra: [], side: [] } });
    const rows = await previewRows([
      source("#main\n89631139\n101402052"),
      source("#main\n89631133\n89631139", "f2"),
      source("#main\n89631139\n#extra\n89631133", "f3"),
      source("#main\n89631139\n89631139\n89631133", "f4"),
    ]);
    expect(rows[0].duplicateOf).toEqual({ kind: "saved", deckId: saved.id, name: "Saved" });
    expect(rows[1].duplicateOf).toBeUndefined();
    expect(rows[2].duplicateOf).toEqual({ kind: "row", rowId: "f2#0", name: "Blue Eyes" });
    expect(rows[3].duplicateOf).toBeUndefined();
  });

  it("includes Deck Master in duplicate identity and never reveals foreign decks", async () => {
    for (const [guildId, userId] of [["g", 2], ["other", 1]] as const) {
      decks.create(guildId, userId, { name: "Private", mode: "normal", deck: { main: [89631139], extra: [], side: [] } });
    }
    const rows = await previewRows([source(), source("#main\n89631139\n#deckmaster\n46986414", "f2")]);
    expect(rows.every((r: { duplicateOf?: unknown }) => r.duplicateOf === undefined)).toBe(true);
  });

  it("returns storage overflow as an error and game size issues as warnings", async () => {
    const rows = await previewRows([source(`#main\n${"89631139\n".repeat(301)}`), source(`#main\n89631139\n#extra\n${"44508094\n".repeat(16)}!side\n${"14558127\n".repeat(16)}`, "f2")]);
    expect(rows[0].errors).toContainEqual(expect.objectContaining({ code: "invalid_deck" }));
    expect(rows[1].errors).toEqual([]);
    expect(rows[1].warnings.map((w: { code: string }) => w.code)).toEqual(["main_size", "extra_size", "side_size"]);
  });

  it("reports rejected Domain masters using the ordinary save rule", async () => {
    mocks.callDuelHost.mockImplementation(async (input: { op: string; codes?: number[] }) => input.op === "validate-deck-master"
      ? { ok: false, response: NextResponse.json({ error: "Spell cannot be Deck Master" }, { status: 400 }) }
      : { ok: true, data: { codes: Object.fromEntries(input.codes!.map(id => [id, id])) } });
    const [result] = await previewRows([source("#main\n89631139\n#deckmaster\n55144522")]);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "invalid_deck_master" }));
  });

  it("returns malformed rows even when the owner has saved decks and the engine is down", async () => {
    decks.create("g", 1, { name: "Saved", mode: "normal", deck: { main: [89631139], extra: [], side: [] } });
    mocks.callDuelHost.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Unavailable" }, { status: 503 }) });
    const response = await preview(request({ sources: [source("ydke://broken")] }));
    expect(response.status).toBe(200);
    expect((await response.json()).rows[0].deck).toEqual(deck([]));
    expect(mocks.callDuelHost).not.toHaveBeenCalled();
  });

  it("returns engine failure or invalid response without calling cards unknown", async () => {
    mocks.callDuelHost.mockResolvedValueOnce({ ok: false, response: NextResponse.json({ error: "Host unavailable" }, { status: 503 }) });
    expect((await preview(request({ sources: [source()] }))).status).toBe(503);
    mocks.callDuelHost.mockResolvedValueOnce({ ok: true, data: { codes: {} } });
    expect((await preview(request({ sources: [source()] }))).status).toBe(502);
  });
});

describe("bulk", () => {
  it("saves Standard by default, explicit Domain, and unfinished Domain without a master", async () => {
    const response = await bulk(request({ rows: [
      row("Default", { ...deck(), side: [46986414] }),
      { ...row("Domain", { ...deck(), side: [101402052] }), mode: "domain" },
      { ...row("Unfinished"), mode: "domain" },
      { ...row("Standard"), mode: "standard" },
    ] }));
    const { created, failed } = await response.json();
    expect(failed).toEqual([]);
    expect(created).toHaveLength(4);
    const stored = decks.list("g", 1);
    expect(stored.find(d => d.name === "Default")).toMatchObject({ mode: "normal", deck: { side: [46986414] } });
    expect(stored.find(d => d.name === "Domain")).toMatchObject({ mode: "domain", deck: { side: [], deckMaster: 40235813 } });
    expect(stored.find(d => d.name === "Unfinished")?.mode).toBe("domain");
    expect(stored.find(d => d.name === "Standard")?.mode).toBe("normal");
  });

  it("rechecks a Domain row whose master was moved back into Side after preview", async () => {
    const [shown] = await previewRows([{ ...source("#main\n89631139\n!side\n46986414"), mode: "domain" }]);
    const response = await bulk(request({ rows: [{ name: shown.name, mode: shown.mode, deck: { ...shown.deck, deckMaster: null, side: [55144522] } }] }));
    // The edited Side card must become the master and pass the ordinary library save check.
    expect((await response.json()).failed).toEqual([]);
    expect(decks.list("g", 1)[0]).toMatchObject({ mode: "domain", deck: { side: [], deckMaster: 55144522 } });
    expect(mocks.callDuelHost).toHaveBeenCalledWith(expect.objectContaining({ op: "validate-deck-master", deck: { main: [], extra: [], side: [], deckMaster: 55144522 } }));
  });

  it("rejects forged modes per row and still saves an independent valid row", async () => {
    const response = await bulk(request({ rows: [
      { ...row("Bad mode"), mode: "normal" },
      { ...row("Missing mode"), mode: null },
      { ...row("Good"), mode: "domain" },
    ] }));
    const { created, failed } = await response.json();
    expect(created).toEqual([{ id: expect.any(Number), name: "Good" }]);
    expect(failed.map((f: { index: number }) => f.index)).toEqual([0, 1]);
    expect(decks.list("g", 1)[0].mode).toBe("domain");
  });

  it("does not save a Domain lone Side card rejected by Deck Master validation", async () => {
    mocks.callDuelHost.mockImplementation(async (input: { op: string; codes?: number[] }) => input.op === "validate-deck-master"
      ? { ok: false, response: NextResponse.json({ error: "Spell cannot be Deck Master" }, { status: 400 }) }
      : { ok: true, data: { codes: Object.fromEntries(input.codes!.map(id => [id, id])) } });
    const response = await bulk(request({ rows: [{ ...row("Spell", { ...deck(), side: [55144522] }), mode: "domain" }] }));
    expect((await response.json()).failed[0]).toMatchObject({ index: 0, errors: [{ code: "invalid_deck_master" }] });
    expect(decks.list("g", 1)).toEqual([]);
  });

  it("revalidates each row and saves independent rows with remaps and artwork intact", async () => {
    const response = await bulk(request({ rows: [row("Good", deck([101402052, 89631133])), row("Unknown", deck([999])), row("Edited", deck([0])), row("Also good", deck([44508094]))] }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.created.map((r: { name: string }) => r.name)).toEqual(["Good", "Also good"]);
    expect(body.failed.map((r: { index: number }) => r.index)).toEqual([1, 2]);
    expect(body.failed[0].errors[0]).toMatchObject({ code: "unknown_card", passcode: 999 });
    expect(body.failed[1].errors[0]).toMatchObject({ code: "invalid_deck" });
    expect(decks.list("g", 1).find(d => d.name === "Good")?.deck).toEqual({ main: [40235813, 89631133], extra: [], side: [] });
  });

  it("checks a changed preview deck against the server resolver again", async () => {
    const [shown] = await previewRows();
    mocks.callDuelHost.mockResolvedValue({ ok: true, data: { codes: { 89631139: null } } });
    const response = await bulk(request({ rows: [row(shown.name, shown.deck)] }));
    expect((await response.json()).failed[0].errors[0].code).toBe("unknown_card");
    expect(decks.list("g", 1)).toEqual([]);
  });

  it("enforces saved name, uint32 and section limits on forged rows", async () => {
    const values = [null, { main: [4294967296], extra: [], side: [] }, { main: Array(301).fill(1), extra: [], side: [] }, { main: [], extra: "bad", side: [] }, { ...deck(), deckMaster: -1 }];
    const response = await bulk(request({ rows: [...values.map(value => row("Bad", value)), row("a".repeat(101)), row("   "), row(" Fine ")] }));
    const body = await response.json();
    expect(body.failed).toHaveLength(7);
    expect(body.created).toEqual([{ id: expect.any(Number), name: "Fine" }]);
  });

  it("uses actor ownership and cannot set draft, tournament or owner links", async () => {
    const response = await bulk(request({ guildId: "other", ownerUserId: 2, rows: [{ ...row(), ownerUserId: 2, guildId: "other", draftId: 999, tournamentId: 999 }] }));
    const { created } = await response.json();
    expect(decks.get(created[0].id, "g", 1).draftId).toBeNull();
    expect(decks.list("g", 2)).toEqual([]);
    expect(decks.list("other", 1)).toEqual([]);
    expect(db.prepare("select count(*) as n from tournament_participants").get()).toEqual({ n: 0 });
  });

  it("infers Domain for an explicit master and rechecks its save rule", async () => {
    const value = { ...deck(), deckMaster: 46986414 };
    const response = await bulk(request({ rows: [row("Domain", value)] }));
    const { created } = await response.json();
    expect(decks.get(created[0].id, "g", 1).mode).toBe("domain");
    expect(mocks.callDuelHost).toHaveBeenCalledWith(expect.objectContaining({ op: "validate-deck-master", deck: { main: [], extra: [], side: [], deckMaster: 46986414 } }));
  });

  it("fails a rejected Domain master without writing it", async () => {
    mocks.callDuelHost.mockImplementation(async (input: { op: string; codes?: number[] }) => input.op === "validate-deck-master"
      ? { ok: false, response: NextResponse.json({ error: "Spell cannot be Deck Master" }, { status: 400 }) }
      : { ok: true, data: { codes: Object.fromEntries(input.codes!.map(id => [id, id])) } });
    const response = await bulk(request({ rows: [row("Bad master", { ...deck(), deckMaster: 55144522 })] }));
    expect((await response.json()).failed[0]).toMatchObject({ index: 0, errors: [{ code: "invalid_deck_master" }] });
    expect(decks.list("g", 1)).toEqual([]);
  });

  it("permits selected duplicates to create separate ordinary decks", async () => {
    const response = await bulk(request({ rows: [row(), row()] }));
    expect((await response.json()).created).toHaveLength(2);
  });

  it("does not write any row when the resolver is unavailable", async () => {
    mocks.callDuelHost.mockResolvedValueOnce({ ok: false, response: NextResponse.json({ error: "Unavailable" }, { status: 503 }) });
    expect((await bulk(request({ rows: [row()] }))).status).toBe(503);
    expect(decks.list("g", 1)).toEqual([]);
  });
});


it("uses the real bundle resolver for approved chained remaps, protected artwork and catalog ids", async () => {
  const directory = mkdtempSync(join(tmpdir(), "deck-import-resolver-"));
  try {
    const engine = new Database(join(directory, "cards.cdb"));
    engine.exec(`
      create table datas (id integer primary key, ot integer, alias integer, type integer);
      create table texts (id integer primary key, name text);
      insert into datas values (40235813, 3, 0, 33), (89631139, 3, 0, 17), (89631133, 3, 89631139, 17);
      insert into texts values (40235813, 'Official card'), (89631139, 'Blue-Eyes White Dragon'), (89631133, 'Blue-Eyes White Dragon');
    `);
    engine.close();
    const bytes = JSON.stringify({ version: 1, remaps: { 101402052: 101402053, 101402053: 40235813, 89631133: 40235813 } });
    writeFileSync(join(directory, "card-remaps.json"), bytes);
    writeFileSync(join(directory, "manifest.json"), JSON.stringify({ sources: { databaseFormat: "official-releases-prerelease-v4" }, integrity: { cardRemaps: createHash("sha256").update(bytes).digest("hex") } }));
    db.prepare("insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at) values (81480461, 'Blue-Eyes White Dragon', 'Normal Monster', 'normal', '', '', '[]', current_timestamp)").run();
    const { normalizeCardCodes } = await import("../../duel-server/src/deck-import.js");
    mocks.callDuelHost.mockImplementation(async (input: { codes: number[]; preserveArtwork: boolean }) => ({
      ok: true, data: { codes: Object.fromEntries(await normalizeCardCodes(input.codes, directory, db, { preserveArtwork: input.preserveArtwork })) },
    }));
    const [shown] = await previewRows([source(encodeYdke(deck([101402052, 89631133, 81480461])))]);
    expect(shown.deck.main).toEqual([40235813, 89631133, 89631139]);
    expect(shown.errors).toEqual([]);
    expect(shown.warnings).toContainEqual(expect.objectContaining({ code: "remapped", from: 101402052, to: 40235813 }));
    const response = await bulk(request({ rows: [row("Real maps", deck([101402052, 89631133, 81480461]))] }));
    const { created, failed } = await response.json();
    expect(failed).toEqual([]);
    expect(decks.get(created[0].id, "g", 1).deck.main).toEqual([40235813, 89631133, 89631139]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
