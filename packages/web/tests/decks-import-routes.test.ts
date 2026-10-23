import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react/pure";
import { NextResponse } from "next/server";
import { migrate } from "@yugidraft/shared/db";
import { createSavedDeckService } from "@yugidraft/shared/services";
import { encodeYdke } from "@yugidraft/shared/decks";
import { pasteSource, readSources } from "../src/components/decks/bulk-import";
import { useBulkImport } from "../src/components/decks/use-bulk-import";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), savedActor: vi.fn(), duelActor: vi.fn(), callDuelHost: vi.fn(),
  engine: new Map<number, { name: string; type: number }>(),
}));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@yugidraft/shared/services", async original => {
  const actual = await original<typeof import("@yugidraft/shared/services")>();
  return { ...actual, createDeckTypeLookup: (db: Database.Database) => actual.createDeckTypeLookup(db, mocks.engine) };
});
vi.mock("@/lib/saved-decks", async original => ({
  ...await original<typeof import("../src/lib/saved-decks")>(), requireSavedDeckActor: mocks.savedActor,
}));
vi.mock("@/lib/duel-host", () => ({ requireDuelActor: mocks.duelActor, callDuelHost: mocks.callDuelHost }));

import { POST as preview } from "../app/api/decks/import/preview/route";
import { POST as bulk } from "../app/api/decks/import/bulk/route";
import { POST as createDeck } from "../app/api/decks/route";

import { domainDeck, domainEngine, domainYdk } from "./fixtures/domain-engine-deck";

let db: Database.Database;
let decks: ReturnType<typeof createSavedDeckService>;
let testTime = 1700000000000;
const deck = (main = [89631139]) => ({ main, extra: [] as number[], side: [] as number[], deckMaster: null });
const source = (text = "#main\n89631139\n#extra\n!side", id = "f1", name = "Blue_Eyes.ydk") => ({ id, name, text });
const request = (body: unknown, headers?: HeadersInit) => new Request("http://test/api/decks/import", {
  method: "POST", headers, body: JSON.stringify(body),
});
// A deck at the hard limits: 60 Main, then 15 Extra, then 15 Side (a saved section never holds more).
const wide = (codes: number[]) => ({ main: codes.slice(0, 60), extra: codes.slice(60, 75), side: codes.slice(75, 90), deckMaster: null });
const row = (name = "Blue-Eyes", value: unknown = deck()) => ({ name, deck: value });
const previewRows = async (sources: unknown[] = [source()]) => (await (await preview(request({ sources }))).json()).rows;
const advanceFetchClock = () => {
  const started = performance.now();
  vi.mocked(Date.now).mockImplementation(() => testTime + Math.floor(performance.now() - started));
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(testTime += 3600000);
  db = new Database(":memory:");
  migrate(db);
  mocks.getDb.mockReturnValue(db);
  mocks.engine.clear();
  mocks.engine.set(44508094, { name: "Test Extra", type: 0x41 });
  db.exec("insert into users(id, username, display_name) values (1, 'owner', 'Owner'), (2, 'other', 'Other')");
  decks = createSavedDeckService(db, mocks.engine);
  mocks.savedActor.mockResolvedValue({ ok: true, guildId: "g", ownerUserId: 1, discordUserId: null, decks });
  mocks.duelActor.mockResolvedValue({ ok: true, guildId: "g", playerId: 7 });
  mocks.callDuelHost.mockImplementation(async (input: { op: string; codes?: number[]; lookupLimit: number }) => ({
    ok: true, data: input.op === "normalize-codes"
      ? { codes: Object.fromEntries(input.codes!.map(id => [id, id === 999 ? null : id === 101402052 ? 40235813 : id])), lookupRemaining: input.lookupLimit }
      : { ok: true },
  }));
});
afterEach(() => { db.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("pasted preview lifecycle through the import routes", () => {
  let window: Window;
  beforeAll(async () => {
    // Keep Node's File and Request implementations for the real client/route boundary.
    const jsdom = "jsdom";
    const { JSDOM } = await import(jsdom);
    window = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://test" }).window;
  });
  afterAll(() => window.close());
  beforeEach(() => {
    vi.stubGlobal("window", window);
    vi.stubGlobal("document", window.document);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const req = new Request(new URL(input, "http://test"), init);
      if (req.url.endsWith("/api/decks/import/preview")) return preview(req);
      if (req.url.endsWith("/api/decks/import/bulk")) return bulk(req);
      if (req.url.endsWith("/api/duels/cards")) return Response.json({ cards: [], missing: [] });
      throw new Error(`Unexpected request ${req.url}`);
    }));
  });
  afterEach(() => cleanup());

  it.each(["YDK", "YDKE", "name list"])("replaces earlier invalid pastes with one %s deck and preserves edited file rows", async format => {
    db.exec("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (46986414,'Dark Magician','Normal Monster','normal','','','[]','test')");
    const { result } = renderHook(() => useBulkImport(vi.fn()));
    const items = () => "items" in result.current.view ? result.current.view.items : [];
    act(() => result.current.previewFiles([new File([source().text], "Picked.ydk")]));
    await waitFor(() => expect(result.current.view.phase).toBe("preview"));
    act(() => {
      result.current.rename(items()[0].row.rowId, "Keep this file name");
      result.current.toggle(items()[0].row.rowId);
    });
    const kept = items()[0];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await act(async () => { expect(await result.current.previewPaste("#main\n0\n#extra\n!side")).toBe(true); });
    }
    const text = format === "YDKE" ? encodeYdke(deck([46986414]))
      : format === "name list" ? "Main Deck:\n1x Dark Magician" : "#main\n46986414\n#extra\n!side";
    await act(async () => { expect(await result.current.previewPaste(` \t\r\n \r\n${text}\r\n \t\n\r `)).toBe(true); });
    expect(items()).toHaveLength(2);
    expect(items()[0]).toBe(kept);
    expect(items()[0]).toMatchObject({ name: "Keep this file name", selected: false });
    expect(items()[1]).toMatchObject({ row: { deck: deck([46986414]), errors: [] }, selected: true });
    await act(async () => { await result.current.importSelected(); });
    expect(decks.list("g", 1).map(saved => saved.deck.main)).toEqual([[46986414]]);
    expect(items()).toEqual([kept]);
  });

  it("replaces selected and renamed paste rows while later file picks still append", async () => {
    const { result } = renderHook(() => useBulkImport(vi.fn()));
    const items = () => "items" in result.current.view ? result.current.view.items : [];
    const code = encodeYdke(deck());
    await act(async () => { await result.current.previewPaste(`${code}\n${code}`); });
    expect(items()).toHaveLength(2);
    act(() => result.current.rename(items()[0].row.rowId, "Old pasted name"));
    act(() => result.current.toggle(items()[1].row.rowId));
    act(() => result.current.previewFiles([new File([source().text], "First.ydk")]));
    await waitFor(() => expect(result.current.view.phase).toBe("preview"));
    expect(items()).toHaveLength(3);
    await act(async () => { await result.current.previewPaste(`\n \t\r\n${code}\n \r\n`); });
    expect(items()).toHaveLength(2);
    expect(items().map(item => item.name)).not.toContain("Old pasted name");
    act(() => result.current.previewFiles([new File([source().text], "Second.ydk")]));
    await waitFor(() => expect(result.current.view.phase).toBe("preview"));
    expect(items()).toHaveLength(3);
    expect(items().filter(item => item.row.sourceId.endsWith("-paste"))).toHaveLength(1);
  });

  it("keeps the visible preview on request failure and supersedes held pastes without dropping held files", async () => {
    const { result } = renderHook(() => useBulkImport(vi.fn()));
    const items = () => "items" in result.current.view ? result.current.view.items : [];
    await act(async () => { await result.current.previewPaste(source().text); });
    const original = items()[0];
    const unavailable = () => mocks.savedActor.mockResolvedValueOnce({ ok: false, response: NextResponse.json({ error: "Unavailable" }, { status: 503 }) });
    unavailable();
    await act(async () => { expect(await result.current.previewPaste("#main\n46986414")).toBe(false); });
    expect(items()).toEqual([original]);
    expect(result.current.heldCount).toBe(1);
    unavailable();
    act(() => result.current.previewFiles([new File([source().text], "Retry file.ydk")]));
    await waitFor(() => expect(result.current.view.phase).toBe("preview"));
    expect(result.current.heldCount).toBe(2);
    await act(async () => { await result.current.previewPaste(encodeYdke(deck([46986414]))); });
    expect(items()).toHaveLength(1);
    expect(items()[0].row.deck).toEqual(deck([46986414]));
    expect(result.current.heldCount).toBe(1);
    act(() => result.current.retryHeld());
    await waitFor(() => expect(result.current.view.phase).toBe("preview"));
    expect(result.current.heldCount).toBe(0);
    expect(items().map(item => item.row.deck.main)).toEqual([[46986414], [89631139]]);
  });
});

describe("simulator name lists", () => {
  function seedNames() {
    advanceFetchClock();
    db.exec(`insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values
      (901,'Test Spell','Spell Card','spell','','','[]','test'),
      (902,'Test Trap','Trap Card','trap','','','[]','test'),
      (903,'Test Fusion','Fusion Monster','fusion','','','[]','test'),
      (904,'Test Monster','Effect Monster','effect','','','[]','test')`);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "No card matching your query was found" }, { status: 400 })));
  }

  it.each(["paste", "file"])("previews and saves a simulator %s list with section and category headings", async kind => {
    seedNames();
    const text = "Main Deck (5):\nMonsters (2):\n2x Test Monster\nSpells\nTest Spell x2\nTraps:\n1 Test Trap\nExtra Deck\n1x Test Fusion\nSide Deck:\n1 Test Spell\n1 Test Fusion";
    const picked = kind === "paste" ? pasteSource(text) : await readSources([new File([text], "Simulator.txt")]);
    const [shown] = await previewRows(picked.sources);
    expect(shown.name).toBe(kind === "paste" ? "Pasted deck" : "Simulator");
    expect(shown.errors).toEqual([]);
    expect(shown.deck).toEqual({ main: [904, 904, 901, 901, 902], extra: [903], side: [901, 903], deckMaster: null });
    expect(shown.warnings.filter((issue: { code: string }) => issue.code === "invalid_passcode")).toEqual([]);
    const result = await (await bulk(request({ rows: [shown] }))).json();
    expect(result.failed).toEqual([]);
    expect(decks.get(result.created[0].id, "g", 1)?.deck).toEqual({ main: shown.deck.main, extra: shown.deck.extra, side: shown.deck.side });
  });

  it("routes Extra monsters listed in Main and promotes one Domain Side card to Master", async () => {
    seedNames();
    const [shown] = await previewRows([{ ...pasteSource("Monsters:\nTest Monster\nTest Fusion\nSide\nTest Monster").sources[0], mode: "domain" }]);
    expect(shown.errors).toEqual([]);
    expect(shown.deck).toEqual({ main: [904], extra: [903], side: [], deckMaster: 904 });
    expect(shown.counts).toEqual({ main: 1, extra: 1, side: 0 });
  });

  it("reports unresolved names with their original source lines and keeps independent rows usable", async () => {
    seedNames();
    const rows = await previewRows([source(`Monsters:\n2x Test Monster\n\n3x Missing Card (my note)\n${"Long name".repeat(40)}`, "names", "Names.txt"), source()]);
    expect(rows[0].deck.main).toEqual([904, 904]);
    expect(rows[0].errors).toContainEqual(expect.objectContaining({ code: "unknown_card", line: 4, message: expect.stringContaining("3x Missing Card (my note)") }));
    expect(rows[0].errors).toContainEqual(expect.objectContaining({ code: "unknown_card", line: 5, message: expect.stringContaining("Long name") }));
    expect(rows[1].errors).toEqual([]);
  });

  it("keeps invalid name-list copy counts local to their row", async () => {
    seedNames();
    const rows = await previewRows([source("0x Test Monster", "bad"), source()]);
    expect(rows[0].errors).toContainEqual(expect.objectContaining({ code: "invalid_list", message: expect.stringContaining("Invalid copy count") }));
    expect(rows[1].errors).toEqual([]);
  });

  it("shares one lookup allowance across name lists and numeric YDK rows", async () => {
    seedNames();
    const response = await preview(request({ sources: [source("Missing Card", "names"), source()] }));
    expect(response.status).toBe(200);
    const remote = vi.mocked(fetch).mock.calls.length;
    expect(remote).toBeGreaterThan(0);
    expect(mocks.callDuelHost.mock.calls[0][0].lookupLimit).toBe(50 - remote);
  });

  it("holds name-list picks for a retry when the card database is unavailable", async () => {
    seedNames();
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    const response = await preview(request({ sources: [source("Missing Card")] }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Card database is unavailable. Try again shortly." });
    expect(decks.list("g", 1)).toEqual([]);
  });
});

describe("backend review fixes", () => {
  it("previews and saves a 70-card Domain deck with engine-only Extra cards", async () => {
    for (const [code, card] of domainEngine) mocks.engine.set(code, card);
    const [shown] = await previewRows([{ ...source(domainYdk), mode: "domain" }]);
    expect(shown.deck).toEqual({ ...domainDeck, deckMaster: domainDeck.deckMaster });
    expect(shown.errors).toEqual([]);
    expect(shown.warnings.filter((warning: { code: string }) => warning.code === "section_moved")).toEqual([]);
    const response = await bulk(request({ rows: [shown] }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.failed).toEqual([]);
    expect(decks.get(result.created[0].id, "g", 1)?.deck).toEqual(domainDeck);
  });
  it("keeps a named unknown-type card in Extra in the import preview", async () => {
    db.exec("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (9999,'Named unknown','','fusion','','','[]','test')");
    const [shown] = await previewRows([source("#extra\n9999")]);
    expect(shown.deck.extra).toEqual([9999]);
    expect(shown.warnings.some((warning: { message: string }) => warning.message.includes("Named unknown"))).toBe(true);
  });
  const unknownCodes = (offset = 0) => Array.from({ length: 50 }, (_, i) => 91000000 + offset + i);
  function unknownHost() {
    const fetch = vi.fn();
    mocks.callDuelHost.mockImplementation(async (input: { codes: number[]; lookupLimit: number }) => {
      const used = Math.min(input.codes.length, input.lookupLimit);
      for (const code of input.codes.slice(0, used)) fetch(code);
      return { ok: true, data: { codes: Object.fromEntries(input.codes.map(id => [id, null])),
        lookupRemaining: input.lookupLimit - used, lookupLimited: input.codes.slice(used) } };
    });
    return fetch;
  }

  it.each([false, true])("bounds remote fetches to 100 across 20 requests (mix bulk: %s)", async mixed => {
    const fetch = unknownHost();
    for (let i = 0; i < 20; i++) {
      const codes = unknownCodes(i * 50);
      const response = mixed && i % 2
        ? await bulk(request({ rows: [row("Unknown", deck(codes))] }))
        : await preview(request({ sources: [source(`#main\n${codes.join("\n")}`)] }));
      expect(response.status).toBe(200);
      const body = await response.json();
      const errors = mixed && i % 2 ? body.failed[0].errors : body.rows[0].errors;
      expect(errors[0].code).toBe(i < 2 ? "unknown_card" : "lookup_limited");
    }
    expect(fetch).toHaveBeenCalledTimes(100);
    expect(mocks.callDuelHost.mock.calls.map(([input]) => input.lookupLimit)).toEqual([50, 50, ...Array(18).fill(0)]);
  });

  it("charges only used lookups and keeps cached imports working at zero tokens", async () => {
    const fetch = unknownHost();
    const first = unknownCodes().slice(0, 45);
    const second = unknownCodes(50).slice(0, 45);
    for (const codes of [first, second, unknownCodes(100)]) {
      expect((await preview(request({ sources: [source(`#main\n${codes.join("\n")}`)] }))).status).toBe(200);
    }
    expect(mocks.callDuelHost.mock.calls.map(([input]) => input.lookupLimit)).toEqual([50, 50, 10]);
    expect(fetch).toHaveBeenCalledTimes(100);
    mocks.callDuelHost.mockImplementation(async (input: { codes: number[]; lookupLimit: number }) => ({ ok: true,
      data: { codes: Object.fromEntries(input.codes.map(id => [id, id])), lookupRemaining: input.lookupLimit } }));
    const [shown] = await previewRows();
    expect(shown.errors).toEqual([]);
    const saved = await bulk(request({ rows: [row()] }));
    expect(saved.status).toBe(200);
    expect((await saved.json()).created).toHaveLength(1);
    expect(mocks.callDuelHost.mock.calls.slice(3).every(([input]) => input.lookupLimit === 0)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(100);
  });

  it.each([[5999, 0], [6000, 1], [60000, 10], [120000, 20], [600000, 50]])(
    "refills the lookup bucket after %i ms without resetting it early", async (elapsed, expected) => {
      const fetch = unknownHost();
      for (const offset of [0, 50]) await previewRows([source(`#main\n${unknownCodes(offset).join("\n")}`)]);
      vi.spyOn(Date, "now").mockReturnValue(testTime + elapsed);
      await previewRows([source(`#main\n${unknownCodes(100).join("\n")}`)]);
      expect(mocks.callDuelHost.mock.calls.at(-1)![0].lookupLimit).toBe(expected);
      expect(fetch).toHaveBeenCalledTimes(100 + expected);
    },
  );

  it.each([[preview, preview], [preview, bulk], [bulk, preview], [bulk, bulk]])(
    "rejects a second import while another is in flight", async (firstRoute, secondRoute) => {
      let release!: (value: unknown) => void;
      let started!: () => void;
      const entered = new Promise<void>(resolve => { started = resolve; });
      mocks.callDuelHost.mockImplementationOnce(() => {
        started();
        return new Promise(resolve => { release = resolve; });
      });
      const body = (route: typeof preview) => route === preview ? { sources: [source()] } : { rows: [row()] };
      const pending = firstRoute(request(body(firstRoute)));
      await entered;
      const second = await secondRoute(request(body(secondRoute)));
      expect(second.status).toBe(429);
      expect(second.headers.get("retry-after")).toBe("1");
      expect(await second.json()).toEqual({ error: "A deck import is already in progress, try again shortly", retryAfterSeconds: 1 });
      expect(mocks.callDuelHost).toHaveBeenCalledTimes(1);
      release({ ok: true, data: { codes: { 89631139: 89631139 }, lookupRemaining: 50 } });
      expect((await pending).status).toBe(200);
      expect((await secondRoute(request(body(secondRoute)))).status).toBe(200);
    },
  );

  it.each([preview, bulk])("releases the in-flight lock after invalid bodies and host failures", async route => {
    expect((await route(new Request("http://test", { method: "POST", body: "{" }))).status).toBe(400);
    const body = route === preview ? { sources: [source()] } : { rows: [row()] };
    mocks.callDuelHost.mockRejectedValueOnce(new Error("timeout"));
    expect((await route(request(body))).status).toBe(503);
    expect((await route(request(body))).status).toBe(200);
  });

  it("caches confirmed unknown codes for ten minutes across preview and bulk", async () => {
    const fetch = unknownHost();
    const codes = unknownCodes();
    for (let i = 0; i < 3; i++) {
      const [shown] = await previewRows([source(`#main\n${codes.join("\n")}`)]);
      expect(shown.errors[0].code).toBe("unknown_card");
    }
    const saved = await bulk(request({ rows: [row("Unknown", deck(codes))] }));
    expect((await saved.json()).failed[0].errors[0].code).toBe("unknown_card");
    expect(fetch).toHaveBeenCalledTimes(50);
    vi.spyOn(Date, "now").mockReturnValue(testTime + 599999);
    await previewRows([source(`#main\n${codes.join("\n")}`)]);
    expect(fetch).toHaveBeenCalledTimes(50);
    vi.spyOn(Date, "now").mockReturnValue(testTime + 600000);
    await previewRows([source(`#main\n${codes.join("\n")}`)]);
    expect(fetch).toHaveBeenCalledTimes(100);
  });

  it("does not cache lookup-limited codes as unknown", async () => {
    const fetch = unknownHost();
    for (const offset of [0, 50]) await previewRows([source(`#main\n${unknownCodes(offset).join("\n")}`)]);
    const codes = unknownCodes(100);
    expect((await previewRows([source(`#main\n${codes.join("\n")}`)]))[0].errors[0].code).toBe("lookup_limited");
    vi.spyOn(Date, "now").mockReturnValue(testTime + 60000);
    expect((await previewRows([source(`#main\n${codes.join("\n")}`)]))[0].errors[0].code).toBe("unknown_card");
    expect(fetch).toHaveBeenCalledTimes(110);
  });

  it("does not renew unconfirmed lookup allowance after a timeout or missing remainder", async () => {
    mocks.callDuelHost.mockRejectedValueOnce(new Error("timeout"));
    expect((await preview(request({ sources: [source()] }))).status).toBe(503);
    mocks.callDuelHost.mockResolvedValueOnce({ ok: true, data: { codes: { 89631139: 89631139 } } });
    expect((await preview(request({ sources: [source()] }))).status).toBe(200);
    expect((await preview(request({ sources: [source()] }))).status).toBe(200);
    expect(mocks.callDuelHost.mock.calls.map(([input]) => input.lookupLimit)).toEqual([50, 50, 0]);
  });

  it("keeps the lookup bucket separate for each authenticated user", async () => {
    const fetch = unknownHost();
    for (const offset of [0, 50]) await previewRows([source(`#main\n${unknownCodes(offset).join("\n")}`)]);
    mocks.savedActor.mockResolvedValueOnce({ ok: true, guildId: "g", ownerUserId: 2, decks });
    await previewRows([source(`#main\n${unknownCodes(100).join("\n")}`)]);
    expect(mocks.callDuelHost.mock.calls.at(-1)![0].lookupLimit).toBe(50);
    await previewRows([source(`#main\n${unknownCodes(150).join("\n")}`)]);
    expect(mocks.callDuelHost.mock.calls.at(-1)![0].lookupLimit).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(150);
  });

  it("bounds the negative cache and evicts the oldest confirmed misses", async () => {
    // These null mappings represent cached cards the engine cannot resolve; they spend no lookup.
    mocks.callDuelHost.mockImplementation(async (input: { codes: number[]; lookupLimit: number }) => ({ ok: true,
      data: { codes: Object.fromEntries(input.codes.map(id => [id, null])), lookupRemaining: input.lookupLimit } }));
    const codes = Array.from({ length: 5100 }, (_, i) => 92000000 + i);
    for (const group of [codes.slice(0, 4500), codes.slice(4500)]) {
      const rows = Array.from({ length: Math.ceil(group.length / 90) }, (_, i) => row(`Unknown ${i}`, wide(group.slice(i * 90, (i + 1) * 90))));
      expect((await bulk(request({ rows }))).status).toBe(200);
    }
    mocks.callDuelHost.mockClear();
    await previewRows([source(`#main\n${codes[0]}\n${codes.at(-1)}`)]);
    expect(mocks.callDuelHost).toHaveBeenCalledTimes(1);
    expect(mocks.callDuelHost).toHaveBeenCalledWith(expect.objectContaining({ codes: [codes[0]], lookupLimit: 50 }));
  });

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
    expect(errors[0]).toMatchObject({ code: "lookup_limited", message: expect.stringContaining("the card check hit its limit"), passcode: codes[50] });
    expect(mocks.callDuelHost).toHaveBeenCalledWith(expect.objectContaining({ lookupLimit: 50 }));
  });

  it("carries the remaining budget between batches", async () => {
    const codes = Array.from({ length: 1200 }, (_, i) => 90000000 + i);
    mocks.callDuelHost.mockImplementation(async (input: { codes: number[] }) => ({ ok: true, data: {
      codes: Object.fromEntries(input.codes.map(id => [id, id])), lookupRemaining: 0, lookupLimited: [],
    } }));
    const response = await bulk(request({ rows: Array.from({ length: 20 }, (_, i) => row(`Deck ${i}`, deck(codes.slice(i * 60, (i + 1) * 60)))) }));
    expect(response.status).toBe(200);
    expect(mocks.callDuelHost.mock.calls.map(([input]) => input.lookupLimit)).toEqual([50, 0]);
  });

  it("rejects more than 4550 unique request codes before host work", async () => {
    // Only a preview can reach this: a bulk row holds at most 91 codes, so 50 rows stay at 4550.
    const codes = Array.from({ length: 4800 }, (_, i) => 90000000 + i);
    const response = await preview(request({ sources: Array.from({ length: 16 }, (_, i) => source(`#main\n${codes.slice(i * 300, (i + 1) * 300).join("\n")}`, `f${i}`)) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Import must contain at most 4550 unique card codes" });
    expect(mocks.callDuelHost).not.toHaveBeenCalled();
  });

  it("allows a shared burst of 20 preview and bulk requests per user and refills 10 each minute", async () => {
    for (let i = 0; i < 20; i++) {
      const response = i % 2 ? await bulk(request({ rows: [row()] })) : await preview(request({ sources: [source()] }));
      expect(response.status).toBe(200);
    }
    const calls = mocks.callDuelHost.mock.calls.length;
    for (const route of [preview, bulk]) {
      const response = await route(request(route === preview ? { sources: [source()] } : { rows: [row()] }));
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("6");
      expect(await response.json()).toEqual({ error: "Too many deck imports, try again shortly", retryAfterSeconds: 6 });
    }
    expect(mocks.callDuelHost).toHaveBeenCalledTimes(calls);
    mocks.savedActor.mockResolvedValueOnce({ ok: true, guildId: "g", ownerUserId: 2, decks });
    expect((await preview(request({ sources: [source()] }))).status).toBe(200);
    vi.spyOn(Date, "now").mockReturnValue(testTime + 60000);
    for (let i = 0; i < 10; i++) {
      const response = i % 2 ? await bulk(request({ rows: [row()] })) : await preview(request({ sources: [source()] }));
      expect(response.status).toBe(200);
    }
    expect((await preview(request({ sources: [source()] }))).status).toBe(429);
  });

  it.each([preview, bulk])("rounds retry seconds up and refills one token after six seconds", async route => {
    const body = route === preview ? { sources: [source()] } : { rows: [row()] };
    for (let i = 0; i < 20; i++) expect((await route(request(body))).status).toBe(200);
    for (const [elapsed, retryAfterSeconds] of [[0, 6], [1501, 5], [5999, 1]]) {
      vi.spyOn(Date, "now").mockReturnValue(testTime + elapsed);
      const response = await route(request(body));
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe(String(retryAfterSeconds));
      expect(await response.json()).toEqual({ error: "Too many deck imports, try again shortly", retryAfterSeconds });
    }
    vi.spyOn(Date, "now").mockReturnValue(testTime + 6000);
    expect((await route(request(body))).status).toBe(200);
    expect((await route(request(body))).status).toBe(429);
  });

  it("counts only preview and bulk requests toward the import bucket", async () => {
    const savedDeck = { ...row(), mode: "normal", deck: { main: [89631139], extra: [], side: [] } };
    for (let i = 0; i < 21; i++) expect((await createDeck(request(savedDeck))).status).toBe(201);
    for (let i = 0; i < 20; i++) expect((await preview(request({ sources: [source()] }))).status).toBe(200);
    expect((await preview(request({ sources: [source()] }))).status).toBe(429);
    expect((await createDeck(request(savedDeck))).status).toBe(201);
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
    expect(shown.warnings.at(-1)).toMatchObject({ code: "more_issues", message: "and 9982 more issues", count: 9982 });
  });

  it("caps card errors in both preview and bulk", async () => {
    const codes = Array.from({ length: 60 }, (_, i) => 90000000 + i);
    mocks.callDuelHost.mockResolvedValue({ ok: true, data: { codes: Object.fromEntries(codes.map(id => [id, null])) } });
    const [shown] = await previewRows([source(`#main\n${codes.join("\n")}`)]);
    expect(shown.errors.length + shown.warnings.length).toBe(21);
    expect(shown.errors.slice(0, 20)).toHaveLength(20);
    expect([...shown.errors, ...shown.warnings]).toContainEqual(expect.objectContaining({ code: "more_issues", count: 40 }));
    const body = await (await bulk(request({ rows: [row("Unknown", deck(codes))] }))).json();
    expect(body.failed[0].errors).toHaveLength(21);
    expect(body.failed[0].errors.at(-1)).toMatchObject({ code: "more_issues", count: 40 });
  });

  it.each(["#main\n#extra\n!side", "ydke://!!!", "#main\nbad"])('rejects an empty parsed deck from %s', async text => {
    advanceFetchClock();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "No card matching your query was found" }, { status: 400 })));
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
    expect(rows[0].notes).toContainEqual(expect.objectContaining({ code: "remapped", line: 3 }));
    expect(rows[0].warnings.filter((issue: { code: string }) => issue.code === "remapped")).toEqual([]);
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
  it.each(["YDK", "YDKE"])("routes resolved %s cards by real type with section_moved warnings and updated counts", async format => {
    db.exec("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (901,'Test Spell','Spell Card','link','','','[]','test'), (902,'Test Trap','Trap Card','fusion','','','[]','test'), (903,'Test Fusion','Fusion Monster','normal','','','[]','test')");
    const original = { main: [903], extra: [901, 901, 902, 903], side: [901], deckMaster: 904 };
    const text = format === "YDK" ? "#main\n903\n#extra\n901\n901\n902\n903\n!side\n901\n#deckmaster\n904" : encodeYdke(original);
    const [shown] = await previewRows([source(text)]);
    expect(shown.deck).toEqual({ main: [901, 901, 902], extra: [903, 903], side: [901], deckMaster: format === "YDK" ? 904 : null });
    expect(shown.counts).toEqual({ main: 3, extra: 2, side: 1 });
    expect(shown.errors).toEqual([]);
    expect(shown.warnings.filter((issue: { code: string }) => issue.code === "section_moved")).toEqual([
      { code: "section_moved", message: "3 cards moved from Extra Deck to Main Deck: Test Spell, Test Spell, Test Trap." },
      { code: "section_moved", message: "1 card moved from Main Deck to Extra Deck: Test Fusion." },
    ]);
    expect(decks.list("g", 1)).toEqual([]);
  });

  it("routes by engine bits when catalog types and frames disagree", async () => {
    db.exec("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (901,'Catalog Fusion','Fusion Monster','fusion','','','[]','test'), (903,'Catalog Spell','Spell Card','spell','','','[]','test')");
    mocks.engine.set(901, { name: "Engine Spell", type: 0x2 });
    mocks.engine.set(903, { name: "Engine Fusion", type: 0x41 });
    const [shown] = await previewRows([source("#main\n903\n#extra\n901")]);
    expect(shown.deck).toEqual({ main: [901], extra: [903], side: [], deckMaster: null });
    expect(shown.warnings).toContainEqual({ code: "section_moved", message: "1 card moved from Extra Deck to Main Deck: Engine Spell." });
    expect(shown.errors).toEqual([]);
  });

  it.each(["main", "extra"] as const)("cuts %s to its limit after routing and reports what was left out", async section => {
    mocks.engine.set(901, { name: "Test Spell", type: 0x2 });
    mocks.engine.set(903, { name: "Test Fusion", type: 0x41 });
    const original = section === "main" ? { main: Array(100).fill(901), extra: [901], side: [] }
      : { main: [903], extra: Array(30).fill(903), side: [] };
    const [shown] = await previewRows([source(encodeYdke(original))]);
    const limit = section === "main" ? 60 : 15;
    const total = section === "main" ? 101 : 31;
    expect(shown.deck[section]).toHaveLength(limit);
    expect(shown.counts[section]).toBe(limit);
    expect(shown.errors).toEqual([]);
    expect(shown.warnings).toContainEqual(expect.objectContaining({ code: `${section}_full`, count: total - limit,
      message: expect.stringContaining(`${section === "main" ? "Main" : "Extra"} Deck is full (${limit}/${limit}). ${total - limit} cards were left out`) }));
    expect(shown.warnings).toContainEqual(expect.objectContaining({ code: "section_moved" }));
  });

  it("refuses a preview file that is far past the limits instead of loading it", async () => {
    const [shown] = await previewRows([source(`#main\n${"89631139\n".repeat(301)}`)]);
    expect(shown.errors).toContainEqual(expect.objectContaining({ code: "invalid_deck" }));
    expect(decks.list("g", 1)).toEqual([]);
  });

  it.each([
    ["YDK", false], ["YDK", true], ["YDKE", false], ["YDKE", true],
  ] as const)("keeps every section in an unresolved %s row (lookup limited: %s)", async (format, limited) => {
    db.exec("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (901,'Test Spell','Spell Card','spell','','','[]','test'), (903,'Test Fusion','Fusion Monster','fusion','','','[]','test')");
    mocks.callDuelHost.mockResolvedValue({ ok: true, data: {
      codes: { 901: 901, 903: 903, 999: null }, lookupLimited: limited ? [999] : [],
    } });
    const original = { main: [903], extra: [999, 999, 901], side: [903], deckMaster: null };
    const text = format === "YDK" ? "#main\n903\n#extra\n999\n999\n901\n!side\n903" : encodeYdke(original);
    const [shown] = await previewRows([source(text)]);
    expect(shown.deck).toEqual(original);
    expect(shown.counts).toEqual({ main: 1, extra: 3, side: 1 });
    expect(shown.errors).toEqual([expect.objectContaining({ code: limited ? "lookup_limited" : "unknown_card", passcode: 999 })]);
    expect(shown.warnings.filter((issue: { code: string }) => issue.code === "section_moved")).toEqual([]);
    expect(decks.list("g", 1)).toEqual([]);
  });

  it("accepts an omitted source name and defaults to Standard", async () => {
    const response = await preview(request({ sources: [{ id: "paste", text: "#main\n89631139" }] }));
    expect(response.status).toBe(200);
    expect((await response.json()).rows[0]).toMatchObject({ sourceId: "paste", name: "Untitled deck", mode: "standard", errors: [] });
  });

  it.each(["normal", "invalid", null, 1])("rejects invalid source mode %s before resolution", async mode => {
    expect((await preview(request({ sources: [{ ...source(), mode }] }))).status).toBe(400);
    expect(mocks.callDuelHost).not.toHaveBeenCalled();
  });

  it.each(["standard", "genesys"] as const)("echoes %s and retains its lone Side card through saving", async mode => {
    const [shown] = await previewRows([{ ...source("#main\n89631139\n!side\n46986414"), mode }]);
    expect(shown).toMatchObject({ mode, deck: { ...deck(), side: [46986414] }, counts: { main: 1, extra: 0, side: 1 } });
    expect(mocks.callDuelHost).not.toHaveBeenCalledWith(expect.objectContaining({ op: "validate-deck-master" }));
    const response = await bulk(request({ rows: [shown] }));
    const { created, failed } = await response.json();
    expect(failed).toEqual([]);
    expect(decks.get(created[0].id, "g", 1)).toMatchObject({ mode: "normal", deck: { main: shown.deck.main, extra: [], side: [46986414] },
      genesys: mode === "genesys" ? { pointCap: 100 } : null });
  });

  it.each((["domain", "genesys-domain"] as const).flatMap(mode => [
    "#main\n89631139\n!side\n101402052",
    encodeYdke({ ...deck(), side: [101402052] }),
  ].map(text => ({ mode, text }))))("moves and resolves a lone $mode Side card into Deck Master for $text", async ({ mode, text }) => {
    mocks.engine.set(40235813, { name: "Official Test Card", type: 0x21 });
    const [shown] = await previewRows([{ ...source(text), mode }]);
    expect(shown).toMatchObject({ mode, deck: { ...deck(), deckMaster: 40235813 }, counts: { main: 1, extra: 0, side: 0 }, errors: [] });
    expect(shown.notes).toContainEqual(expect.objectContaining({ code: "remapped", from: 101402052, to: 40235813 }));
    expect(shown.notes[0].message).toBe("101402052 read as Official Test Card. Uses the game's own copy of this card. No action needed.");
    expect(shown.warnings.filter((issue: { code: string }) => issue.code === "remapped")).toEqual([]);
    expect(mocks.callDuelHost).toHaveBeenCalledWith(expect.objectContaining({ op: "validate-deck-master", deck: { main: [], extra: [], side: [], deckMaster: 40235813 } }));
    const response = await bulk(request({ rows: [shown] }));
    const { created, failed } = await response.json();
    expect(failed).toEqual([]);
    expect(decks.get(created[0].id, "g", 1)).toMatchObject({ mode: "domain", deck: shown.deck,
      genesys: mode === "genesys-domain" ? { pointCap: 100 } : null });
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
    expect(result.errors).toEqual([{ code: "unknown_card", message: "Card 999: not found in the game's card data. Check the passcode in the deck file.", passcode: 999, line: 2 }]);
    expect(result.notes.filter((w: { code: string }) => w.code === "remapped")).toEqual([{ code: "remapped", message: "Card 101402052: uses the game's copy under ID 40235813. No action needed.", from: 101402052, to: 40235813, line: 4 }]);
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

  it("detects a saved duplicate when type routing corrects the imported section", async () => {
    db.prepare("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (901,'Test Spell','Spell Card','link','','','[]','test')").run();
    const saved = decks.create("g", 1, { name: "Saved", mode: "normal", deck: { main: [901], extra: [], side: [] } });
    const [shown] = await previewRows([source("#extra\n901")]);
    expect(shown.deck).toEqual({ main: [901], extra: [], side: [], deckMaster: null });
    expect(shown.duplicateOf).toEqual({ kind: "saved", deckId: saved.id, name: "Saved" });
  });

  it("includes Deck Master in duplicate identity and never reveals foreign decks", async () => {
    for (const [guildId, userId] of [["g", 2], ["other", 1]] as const) {
      decks.create(guildId, userId, { name: "Private", mode: "normal", deck: { main: [89631139], extra: [], side: [] } });
    }
    const rows = await previewRows([source(), source("#main\n89631139\n#deckmaster\n46986414", "f2")]);
    expect(rows.every((r: { duplicateOf?: unknown }) => r.duplicateOf === undefined)).toBe(true);
  });

  it("cuts Extra and Side to 15 and reports the cards left out", async () => {
    const rows = await previewRows([source(`#main\n89631139\n#extra\n${"44508094\n".repeat(16)}!side\n${"14558127\n".repeat(16)}`)]);
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].warnings.map((w: { code: string }) => w.code)).toEqual(["extra_full", "side_full", "unknown_card_type", "unknown_card_type", "main_size"]);
    expect(rows[0].deck.extra).toHaveLength(15);
    expect(rows[0].deck.side).toHaveLength(15);
    expect(rows[0].warnings[0].message).toContain("Extra Deck is full (15/15). 1 card was left out");
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
  it.each([
    [901, "Spell Card"], [902, "Trap Card"], [904, "Pendulum Effect Monster"], [906, "Ritual Monster"],
  ])("rejects a forged Extra %s with the normal-save 400 code before writing any row", async (id, type) => {
    db.prepare("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (?,?,?,'fusion','','','[]','test')").run(id, `Test ${type}`, type);
    const bad = { main: [], extra: [id], side: [] };
    const expected = await createDeck(request({ name: "Bad", mode: "normal", deck: bad }));
    expect(expected.status).toBe(400);
    const response = await bulk(request({ rows: [row("Good"), row("Bad", bad)] }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(await expected.json());
    expect(decks.list("g", 1)).toEqual([]);
  });

  it.each([
    [901, "Spell Card"], [902, "Trap Card"], [904, "Pendulum Effect Monster"],
    [905, "Ritual Effect Monster"], [906, "Token"], [907, "Skill Card"], [998, null],
  ] as const)("rejects a resolved bad Extra card %s before writing any row", async (code, type) => {
    if (type) db.prepare("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (?, 'Test Bad Extra', ?, 'link', '', '', '[]', 'test')").run(code, type);
    const response = await bulk(request({ rows: [row("Good"), row("Bad", { main: [], extra: [code], side: [] })] }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "INVALID_EXTRA_DECK_CARD", error: expect.stringContaining(type ? "Test Bad Extra" : "card 998") });
    expect(decks.list("g", 1)).toEqual([]);
  });

  it("reports an unresolved card before checking a bad Extra card in the same row", async () => {
    db.exec("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (901,'Test Spell','Spell Card','link','','','[]','test')");
    const response = await bulk(request({ rows: [row("Bad", { main: [999], extra: [901], side: [] })] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ created: [], failed: [{ index: 0, errors: [{ code: "unknown_card", message: "Card 999: not found in the game's card data. Check the passcode in the deck file.", passcode: 999 }] }] });
    expect(decks.list("g", 1)).toEqual([]);
  });

  it.each([false, true])("reports an unresolved Extra code per row and saves an independent row (lookup limited: %s)", async limited => {
    mocks.callDuelHost.mockResolvedValue({ ok: true, data: {
      codes: { 89631139: 89631139, 999: null }, lookupLimited: limited ? [999] : [],
    } });
    const response = await bulk(request({ rows: [row("Good"), row("Unknown Extra", { main: [], extra: [999], side: [] })] }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      created: [{ id: expect.any(Number), name: "Good" }],
      failed: [{ index: 1, errors: [{ code: limited ? "lookup_limited" : "unknown_card",
        message: limited ? "Card 999: the card check hit its limit. Check this deck again in a moment." : "Card 999: not found in the game's card data. Check the passcode in the deck file.", passcode: 999 }] }],
    });
    expect(result.warnings).toContainEqual({ index: 0, warnings: [{ code: "unknown_card_type", message: expect.stringContaining("89631139") }] });
    expect(decks.list("g", 1).map(saved => saved.name)).toEqual(["Good"]);
  });

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
    expect(shown.notes).toContainEqual(expect.objectContaining({ code: "remapped", from: 101402052, to: 40235813 }));
    expect(shown.warnings.filter((issue: { code: string }) => issue.code === "remapped")).toEqual([]);
    const response = await bulk(request({ rows: [row("Real maps", deck([101402052, 89631133, 81480461]))] }));
    const { created, failed } = await response.json();
    expect(failed).toEqual([]);
    expect(decks.get(created[0].id, "g", 1).deck.main).toEqual([40235813, 89631133, 89631139]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("uses the real resolver for the reported simulator artwork ID and rejects unproven neighboring IDs", async () => {
  advanceFetchClock();
  const directory = mkdtempSync(join(tmpdir(), "deck-import-simulator-"));
  try {
    const engine = new Database(join(directory, "cards.cdb"));
    engine.exec(`
      create table datas (id integer primary key, ot integer, alias integer, type integer);
      create table texts (id integer primary key, name text);
      insert into datas values (70828912, 3, 0, 130), (89631139, 3, 0, 17), (89631140, 3, 89631139, 17);
      insert into texts values (70828912, 'Premature Burial'), (89631139, 'Blue-Eyes White Dragon'), (89631140, 'Blue-Eyes White Dragon');
    `);
    engine.close();
    mocks.engine.set(70828912, { name: "Premature Burial", type: 130 });
    const { normalizeCardCodes } = await import("../../duel-server/src/deck-import.js");
    const upstream = vi.fn(async () => Response.json({ error: "No card matching your query was found" }, { status: 400 }));
    mocks.callDuelHost.mockImplementation(async (input: { op: string; codes: number[]; preserveArtwork: boolean; lookupLimit: number }) => {
      const canonicalCodes = new Map<number, number | null>();
      const codes = await normalizeCardCodes(input.codes, directory, db, { preserveArtwork: input.preserveArtwork,
        fetch: upstream, canonicalCodes, lookupBudget: { remaining: input.lookupLimit, lookupLimited: false } });
      return { ok: true, data: { codes: Object.fromEntries(codes), canonicalCodes: Object.fromEntries(canonicalCodes) } };
    });
    const [shown] = await previewRows([source(encodeYdke(deck([70828913, 89631140])))]);
    expect(shown.errors).toEqual([]);
    expect(shown.deck.main).toEqual([70828912, 89631140]);
    expect(shown.notes).toContainEqual(expect.objectContaining({ code: "remapped", from: 70828913, to: 70828912, line: 1,
      message: expect.stringContaining("70828913 read as Premature Burial") }));
    expect(upstream).not.toHaveBeenCalled();
    const result = await (await bulk(request({ rows: [shown] }))).json();
    expect(result.failed).toEqual([]);
    expect(decks.get(result.created[0].id, "g", 1)?.deck.main).toEqual([70828912, 89631140]);
    db.exec("insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (70828912,'Premature Burial','Spell Card','spell','','','[]','test')");
    vi.stubGlobal("fetch", upstream);
    const [counted] = await previewRows([source("Main Deck\n1x 70828913\nPremature Burial", "counted")]);
    expect(counted.errors).toEqual([]);
    expect(counted.deck.main).toEqual([70828912, 70828912]);
    expect(counted.notes).toContainEqual(expect.objectContaining({ from: 70828913, to: 70828912, line: 2 }));
    const [unknown] = await previewRows([source("#main\n70828914\n89631141", "unknown")]);
    expect(unknown.errors.map((issue: { passcode: number }) => issue.passcode)).toEqual([70828914, 89631141]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it.each([
  { name: "Another card", alias: 0, ot: 3, sourceKnown: false },
  { name: "Premature Burial", alias: 123, ot: 3, sourceKnown: false },
  { name: "Premature Burial", alias: 0, ot: 32, sourceKnown: false },
  { name: "Premature Burial", alias: 0, ot: 3, sourceKnown: true },
])("validates simulator artwork evidence and gives an existing source row priority: %j", async fixture => {
  const directory = mkdtempSync(join(tmpdir(), "deck-import-artwork-evidence-"));
  try {
    const engine = new Database(join(directory, "cards.cdb"));
    engine.exec("create table datas (id integer primary key, ot integer, alias integer, type integer); create table texts (id integer primary key, name text)");
    engine.prepare("insert into datas values (70828912, ?, ?, 2)").run(fixture.ot, fixture.alias);
    engine.prepare("insert into texts values (70828912, ?)").run(fixture.name);
    if (fixture.sourceKnown) engine.exec("insert into datas values (70828913, 3, 0, 17); insert into texts values (70828913, 'Different engine card')");
    engine.close();
    const { normalizeCardCodes } = await import("../../duel-server/src/deck-import.js");
    mocks.callDuelHost.mockImplementation(async (input: { codes: number[] }) => ({ ok: true, data: {
      codes: Object.fromEntries(await normalizeCardCodes(input.codes, directory, db, { preserveArtwork: true,
        fetch: async () => Response.json({ error: "No card matching your query was found" }, { status: 400 }) })),
    } }));
    const [shown] = await previewRows([source("#main\n70828913")]);
    expect(shown.deck.main).toEqual([70828913]);
    expect(shown.notes).toEqual([]);
    expect(shown.errors).toEqual(fixture.sourceKnown ? [] : [expect.objectContaining({ code: "unknown_card", passcode: 70828913 })]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
