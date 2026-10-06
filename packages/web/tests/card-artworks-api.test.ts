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
it("merges only engine arts with metadata and valid cache, using local nullable URLs", async () => {
  writeFileSync(join(dir, "12-small.jpg"), await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).jpeg().toBuffer());
  writeFileSync(join(dir, "13.jpg"), "broken cache");
  const response = await get();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ passcode: 10, artworks: [
    { passcode: 10, isMain: true, imageUrl: "/api/cards/10/image", smallUrl: "/api/cards/10/image?variant=small", croppedUrl: "/api/cards/10/image?variant=cropped" },
    { passcode: 11, isMain: false, imageUrl: "/api/cards/11/image", smallUrl: "/api/cards/11/image?variant=small", croppedUrl: "/api/cards/11/image?variant=cropped" },
    { passcode: 12, isMain: false, imageUrl: null, smallUrl: "/api/cards/12/image?variant=small", croppedUrl: null },
    { passcode: 13, isMain: false, imageUrl: null, smallUrl: null, croppedUrl: null },
  ] });
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

it("reuses cached image validation briefly, then discovers newly cached images", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1000);
  try {
    await get();
    const reads = vi.mocked(readFile).mock.calls.length;
    expect(reads).toBeGreaterThan(0);
    await get();
    expect(vi.mocked(readFile).mock.calls.length).toBe(reads);
    writeFileSync(join(dir, "12-small.jpg"), await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).jpeg().toBuffer());
    now.mockReturnValue(32000);
    const response = await get();
    expect((await response.json()).artworks.find((art: { passcode: number }) => art.passcode === 12).smallUrl).toBe("/api/cards/12/image?variant=small");
    expect(vi.mocked(readFile).mock.calls.length).toBeGreaterThan(reads);
  } finally { now.mockRestore(); }
});
