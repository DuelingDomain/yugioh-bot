import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";

const { requireDuelActor, callDuelHost, room, getDb } = vi.hoisted(() => ({
  requireDuelActor: vi.fn(), callDuelHost: vi.fn(), room: vi.fn(), getDb: vi.fn(),
}));
vi.mock("@/lib/duel-host", () => ({
  requireDuelActor, callDuelHost,
  duelErrorResponse: () => NextResponse.json({ error: "Not found" }, { status: 404 }),
}));
vi.mock("@/lib/db", () => ({ getDb }));

const fixture = JSON.parse(readFileSync(new URL("../../duel-server/tests/support/fixtures/red-eyes-exceed-cards.json", import.meta.url), "utf8")) as {
  datas: number[][]; texts: Array<[number, string, string, ...string[]]>;
};
let directory: string;
let db: Database.Database;
beforeEach(() => {
  vi.resetAllMocks();
  directory = mkdtempSync(join(tmpdir(), "web-card-info-"));
  vi.stubEnv("DUEL_DATA_DIR", directory);
  const cdb = new Database(join(directory, "cards.cdb"));
  cdb.exec(`create table datas (id integer primary key, ot integer, alias integer, setcode integer, type integer,
    atk integer, def integer, level integer, race integer, attribute integer, category integer);
    create table texts (id integer primary key, name text, desc text);`);
  for (const row of fixture.datas) cdb.prepare("insert into datas values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(...row);
  for (const row of fixture.texts) cdb.prepare("insert into texts values (?, ?, ?)").run(...row.slice(0, 3));
  cdb.close();
  db = new Database(":memory:"); migrate(db); getDb.mockReturnValue(db);
  requireDuelActor.mockResolvedValue({ ok: true, guildId: "guild-1", playerId: 7, duels: { room } });
  // Reproduce an older/restarting host that cannot find the new passcodes.
  callDuelHost.mockResolvedValue({ ok: true, data: { cards: [], missing: [17242022, 40235813] } });
});
afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); });

const post = (codes: unknown) => new Request("http://localhost/api/duels/cards", {
  method: "POST", body: JSON.stringify({ codes }),
});

it("serves both new cards with full CDB text through the exact lookup used by both deck editors", async () => {
  const { POST } = await import("../app/api/duels/cards/route");
  const response = await POST(post([17242022, 40235813, 17242022]));
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.missing).toEqual([]);
  expect(result.cards).toHaveLength(2);
  for (const [code, name, description] of fixture.texts) {
    expect(result.cards.find((card: { code: number }) => card.code === code)).toMatchObject({ code, name, description });
  }
  expect(callDuelHost).not.toHaveBeenCalled();
});

it("also fills numeric GET lookups for card pickers without relying on name search", async () => {
  const { GET } = await import("../app/api/duels/cards/route");
  const response = await GET(new NextRequest("http://localhost/api/duels/cards?q=40235813"));
  expect(await response.json()).toMatchObject({ cards: [{ name: "Dark Time Wizard", description: fixture.texts[1][2] }] });
  expect(callDuelHost).toHaveBeenCalledWith({ op: "cards", slug: undefined, guildId: "guild-1", playerId: 7, query: "40235813" });
});

it("preserves other numeric search matches when the exact passcode is found locally", async () => {
  const { GET } = await import("../app/api/duels/cards/route");
  callDuelHost.mockResolvedValue({ ok: true, data: { cards: [{ code: 17, name: "17242022 in the name" }] } });
  const response = await GET(new NextRequest("http://localhost/api/duels/cards?q=17242022"));
  expect((await response.json()).cards.map((card: { code: number }) => card.code)).toEqual([17242022, 17]);
});

it("uses local exact text while the search host is unavailable", async () => {
  const { GET } = await import("../app/api/duels/cards/route");
  callDuelHost.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Restarting" }, { status: 503 }) });
  expect(await (await GET(new NextRequest("http://localhost/api/duels/cards?q=17242022"))).json())
    .toMatchObject({ cards: [{ code: 17242022, description: fixture.texts[0][2] }] });
});

it("retains host metadata for a passcode absent from a stale web bundle", async () => {
  const { POST } = await import("../app/api/duels/cards/route");
  const hostCard = { code: 99, name: "New host card", description: "Full host text" };
  callDuelHost.mockResolvedValue({ ok: true, data: { cards: [hostCard], missing: [100] } });
  const result = await (await POST(post([17242022, 99, 100]))).json();
  expect(result.cards.map((card: { code: number }) => card.code)).toEqual([17242022, 99]);
  expect(result.missing).toEqual([100]);
  expect(callDuelHost).toHaveBeenCalledWith({ op: "card-details", guildId: "guild-1", playerId: 7, codes: [99, 100] });
});

it("keeps partial numeric queries on the existing search path", async () => {
  const { GET } = await import("../app/api/duels/cards/route");
  callDuelHost.mockResolvedValue({ ok: true, data: { cards: [{ code: 40235813, name: "Dark Time Wizard" }] } });
  const response = await GET(new NextRequest("http://localhost/api/duels/cards?q=402"));
  expect(await response.json()).toMatchObject({ cards: [{ code: 40235813 }] });
  expect(callDuelHost).toHaveBeenCalledWith({ op: "cards", slug: undefined, guildId: "guild-1", playerId: 7, query: "402" });
});

it("prefers catalog text when it exists", async () => {
  db.prepare(`insert into card_catalog
    (ygoprodeck_id,name,type,frame_type,effect_text,image_url,image_url_small,card_sets_json,cached_at)
    values (17242022,'Catalog name','Fusion Monster','fusion','Catalog text','','','[]','now')`).run();
  const { POST } = await import("../app/api/duels/cards/route");
  const result = await (await POST(post([17242022]))).json();
  expect(result.cards[0]).toMatchObject({ name: "Catalog name", description: "Catalog text", type: 97 });
});

it.each([401, 403, 503])("preserves the actor guard's %i before reading any local card data", async status => {
  requireDuelActor.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Denied" }, { status }) });
  const { POST, GET } = await import("../app/api/duels/cards/route");
  expect((await POST(post([17242022]))).status).toBe(status);
  expect((await GET(new NextRequest("http://localhost/api/duels/cards?q=17242022"))).status).toBe(status);
  expect(getDb).not.toHaveBeenCalled();
  expect(callDuelHost).not.toHaveBeenCalled();
});

it("checks room access with the actor's guild before slug-bound lookups", async () => {
  room.mockImplementation(() => { throw new Error("Room belongs to another guild"); });
  const { GET } = await import("../app/api/duels/cards/route");
  expect((await GET(new NextRequest("http://localhost/api/duels/cards?q=17242022&slug=other"))).status).toBe(404);
  expect(room).toHaveBeenCalledWith("other", "guild-1", 7);
  expect(callDuelHost).not.toHaveBeenCalled();
  expect(getDb).not.toHaveBeenCalled();
});

it("keeps slug-bound numeric searches on the host's announcement permission path", async () => {
  const { GET } = await import("../app/api/duels/cards/route");
  await GET(new NextRequest("http://localhost/api/duels/cards?q=17242022&slug=room"));
  expect(callDuelHost).toHaveBeenCalledWith({ op: "cards", slug: "room", guildId: "guild-1", playerId: 7, query: "17242022" });
  expect(getDb).not.toHaveBeenCalled();
});

it("retains the signed host fallback when web has no mounted bundle", async () => {
  rmSync(join(directory, "cards.cdb"));
  const { POST } = await import("../app/api/duels/cards/route");
  const data = { cards: [{ code: 17242022, name: fixture.texts[0][1], description: fixture.texts[0][2] }], missing: [] };
  callDuelHost.mockResolvedValue({ ok: true, data });
  expect(await (await POST(post([17242022]))).json()).toEqual(data);
  expect(callDuelHost).toHaveBeenCalledWith({ op: "card-details", guildId: "guild-1", playerId: 7, codes: [17242022] });
});

it("uses cached catalog text to fill the host fallback when web has no mounted bundle", async () => {
  rmSync(join(directory, "cards.cdb"));
  db.prepare(`insert into card_catalog
    (ygoprodeck_id,name,type,frame_type,effect_text,image_url,image_url_small,card_sets_json,cached_at)
    values (17242022,'Catalog name','Fusion Monster','fusion','Catalog full text','','','[]','now')`).run();
  callDuelHost.mockResolvedValue({ ok: true, data: {
    cards: [{ code: 17242022, name: "Card 17242022", description: "", attack: 5100 }], missing: [],
  } });
  const { POST } = await import("../app/api/duels/cards/route");
  expect((await (await POST(post([17242022]))).json()).cards[0]).toMatchObject({
    code: 17242022, name: "Catalog name", description: "Catalog full text", attack: 5100,
  });
});

it.each([
  { label: "zero", codes: [0] }, { label: "negative", codes: [-1] },
  { label: "fraction", codes: [1.5] }, { label: "overflow", codes: [0x100000000] },
  { label: "string", codes: ["17242022"] }, { label: "too many", codes: Array(1001).fill(1) },
])("validates $label passcodes before local reads", async ({ codes }) => {
  const { POST } = await import("../app/api/duels/cards/route");
  expect((await POST(post(codes))).status).toBe(400);
  expect(getDb).not.toHaveBeenCalled();
});
