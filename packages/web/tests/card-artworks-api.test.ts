import { readFile } from "node:fs/promises";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";

const { requireDuelActor, callDuelHost, getDb } = vi.hoisted(() => ({ requireDuelActor: vi.fn(), callDuelHost: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/duel-host", () => ({ requireDuelActor, callDuelHost }));
vi.mock("@/lib/db", () => ({ getDb }));
vi.mock("node:fs/promises", async importOriginal => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, readFile: vi.fn(original.readFile) };
});
let db: Database.Database;
let dir: string;
beforeEach(() => {
  vi.clearAllMocks();
  db = new Database(":memory:"); migrate(db); getDb.mockReturnValue(db);
  dir = mkdtempSync(join(tmpdir(), "artworks-api-")); process.env.CARD_IMAGE_CACHE_DIR = dir;
  requireDuelActor.mockResolvedValue({ ok: true, guildId: "g", playerId: 7 });
  callDuelHost.mockResolvedValue({ ok: true, data: { passcode: 10, artworks: [
    { passcode: 10, isMain: true }, { passcode: 11, isMain: false }, { passcode: 12, isMain: false }, { passcode: 13, isMain: false },
  ] } });
  for (const id of [10, 11, 99]) {
    db.prepare("insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (?,'D','Normal Monster','normal','full','small','[]','now')").run(id);
    db.prepare("insert into card_artworks (card_id,artwork_id,image_url,image_url_small,image_url_cropped,is_main) values (10,?,'full','small','crop',?)").run(id, Number(id === 10));
  }
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); delete process.env.CARD_IMAGE_CACHE_DIR; });
async function get(passcode = "11") {
  const { GET } = await import("../app/api/cards/[passcode]/artworks/route");
  return GET(new Request(`http://localhost/api/cards/${passcode}/artworks`), { params: Promise.resolve({ passcode }) });
}
it("offers local full and small routes for uncached engine arts while requiring evidence for crops", async () => {
  writeFileSync(join(dir, "v2-ygoprodeck-12-small.jpg"), await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).jpeg().toBuffer());
  writeFileSync(join(dir, "v2-ygoprodeck-13.jpg"), "broken cache");
  const response = await get();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ passcode: 10, artworks: [
    { passcode: 10, isMain: true, imageUrl: "/api/cards/10/image", smallUrl: "/api/cards/10/image?variant=small", croppedUrl: "/api/cards/10/image?variant=cropped" },
    { passcode: 11, isMain: false, imageUrl: "/api/cards/11/image", smallUrl: "/api/cards/11/image?variant=small", croppedUrl: "/api/cards/11/image?variant=cropped" },
    { passcode: 12, isMain: false, imageUrl: "/api/cards/12/image", smallUrl: "/api/cards/12/image?variant=small", croppedUrl: null },
    { passcode: 13, isMain: false, imageUrl: "/api/cards/13/image", smallUrl: "/api/cards/13/image?variant=small", croppedUrl: null },
  ] });
});
it("loads an uncached engine-art thumbnail through the Ignis fallback", async () => {
  callDuelHost.mockResolvedValue({ ok: true, data: { passcode: 89631139, artworks: [
    { passcode: 89631139, isMain: true }, { passcode: 89631133, isMain: false },
  ] } });
  const image = await sharp({ create: { width: 16, height: 24, channels: 3, background: "red" } }).jpeg().toBuffer();
  const upstream = vi.fn(async (url: string) => url === "https://pics.projectignis.org:2096/pics/89631133.jpg"
    ? new Response(new Uint8Array(image)) : new Response("missing", { status: 404 }));
  vi.stubGlobal("fetch", upstream);
  try {
    const family = await (await get("89631133")).json();
    const thumbnail = family.artworks[1].smallUrl;
    expect(thumbnail).toBe("/api/cards/89631133/image?variant=small");
    const { GET } = await import("../app/api/cards/[passcode]/image/route");
    const response = await GET(new Request(`http://localhost${thumbnail}`), { params: Promise.resolve({ passcode: "89631133" }) });
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(image);
    expect(upstream.mock.calls.map(([url]) => url)).toEqual([
      "https://images.ygoprodeck.com/images/cards_small/89631133.jpg", "https://pics.projectignis.org:2096/pics/89631133.jpg",
    ]);
    expect(callDuelHost).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllGlobals(); }
});
it("does not cache a failed image check, so a freshly downloaded image shows at once", async () => {
  const cropOf = async () => (await (await get()).json()).artworks.find((art: { passcode: number }) => art.passcode === 12).croppedUrl;
  expect(await cropOf()).toBeNull();
  writeFileSync(join(dir, "v2-ygoprodeck-12-cropped.jpg"), await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).jpeg().toBuffer());
  expect(await cropOf()).toBe("/api/cards/12/image?variant=cropped");
});
it("requires the guild actor before asking the host", async () => {
  requireDuelActor.mockResolvedValue({ ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) });
  expect((await get()).status).toBe(403); expect(callDuelHost).not.toHaveBeenCalled();
});
it.each(["0", "-1", "abc", "4294967296"])("rejects invalid passcode %s", async id => {
  expect((await get(id)).status).toBe(400); expect(callDuelHost).not.toHaveBeenCalled();
});
it("propagates unknown engine cards and host downtime", async () => {
  for (const status of [404, 503]) {
    callDuelHost.mockResolvedValue({ ok: false, response: Response.json({ error: "Unavailable" }, { status }) });
    expect((await get()).status).toBe(status);
  }
});
it("rejects malformed families instead of offering unsafe ids", async () => {
  callDuelHost.mockResolvedValue({ ok: true, data: { passcode: 10, artworks: [{ passcode: 99, isMain: false }] } });
  expect((await get()).status).toBe(502);
});

it("reuses a successful image check briefly, then notices a removed image", async () => {
  const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).jpeg().toBuffer();
  for (const id of [12, 13]) for (const suffix of ["", "-small", "-cropped"]) writeFileSync(join(dir, `v2-ygoprodeck-${id}${suffix}.jpg`), jpeg);
  const now = vi.spyOn(Date, "now").mockReturnValue(1000);
  const cropOf = async () => (await (await get()).json()).artworks.find((art: { passcode: number }) => art.passcode === 12).croppedUrl;
  try {
    expect(await cropOf()).toBe("/api/cards/12/image?variant=cropped");
    const reads = vi.mocked(readFile).mock.calls.length;
    expect(reads).toBeGreaterThan(0);
    rmSync(join(dir, "v2-ygoprodeck-12-cropped.jpg"));
    expect(await cropOf()).toBe("/api/cards/12/image?variant=cropped");
    expect(vi.mocked(readFile).mock.calls.length).toBe(reads);
    now.mockReturnValue(32000);
    expect(await cropOf()).toBeNull();
    expect(vi.mocked(readFile).mock.calls.length).toBeGreaterThan(reads);
  } finally { now.mockRestore(); }
});
