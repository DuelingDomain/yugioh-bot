// packages/web/tests/cards-image-route.test.ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";

const requireDuelActor = vi.fn();
const callDuelHost = vi.fn();
vi.mock("@/lib/duel-host", () => ({ requireDuelActor, callDuelHost }));
const getDb = vi.fn();
vi.mock("@/lib/db", () => ({ getDb }));

const IMAGES = "https://images.ygoprodeck.com/images/cards";
const RITUAL_ART = Buffer.from("ritual-art");
let cacheDir = "";
let fetched: string[] = [];
let db: Database.Database;

async function getImage(passcode: string, query = "") {
  const { GET } = await import("../app/api/cards/[passcode]/image/route");
  return GET(new Request(`http://localhost/api/cards/${passcode}/image${query}`), { params: Promise.resolve({ passcode }) });
}

describe("GET /api/cards/[passcode]/image", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    cacheDir = mkdtempSync(join(tmpdir(), "yugioh-card-images-"));
    process.env.CARD_IMAGE_CACHE_DIR = cacheDir;
    fetched = [];
    db = new Database(":memory:"); migrate(db); getDb.mockReturnValue(db);
    requireDuelActor.mockResolvedValue({ ok: true, guildId: "guild-1", playerId: 7 });
    callDuelHost.mockResolvedValue({ ok: true, data: { cards: [{ code: 10000100, alias: 5405694 }], missing: [] } });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      fetched.push(url);
      if (url === `${IMAGES}/5405694.jpg`) return new Response(RITUAL_ART);
      return new Response("Not Found", { status: 404 });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CARD_IMAGE_CACHE_DIR;
    rmSync(cacheDir, { recursive: true, force: true });
    db.close();
  });

  it("uses the alias image when YGOPRODeck has no image for the passcode", async () => {
    const response = await getImage("10000100");

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(RITUAL_ART);
    expect(fetched).toEqual([`${IMAGES}/10000100.jpg`, `${IMAGES}/5405694.jpg`]);
    expect(callDuelHost).toHaveBeenCalledWith(expect.objectContaining({ op: "card-details", codes: [10000100] }));
    // The alias image is cached under the requested passcode, so the next request reads the disk.
    expect(readFileSync(join(cacheDir, "10000100.jpg"))).toEqual(RITUAL_ART);
  });

  it("answers 404 when neither the passcode nor an alias has an image", async () => {
    callDuelHost.mockResolvedValue({ ok: true, data: { cards: [{ code: 12345678, alias: 0 }], missing: [] } });

    const response = await getImage("12345678", "?size=small");

    expect(response.status).toBe(404);
    expect(fetched).toEqual(["https://images.ygoprodeck.com/images/cards_small/12345678.jpg"]);
  });

  it("does not ask the duel engine when the passcode has its own image", async () => {
    const response = await getImage("5405694");

    expect(response.status).toBe(200);
    expect(callDuelHost).not.toHaveBeenCalled();
  });

  it("rejects a passcode that is not a number", async () => {
    const response = await getImage("..%2Fsecrets");

    expect(response.status).toBe(400);
    expect(fetched).toEqual([]);
  });

  it("serves the requested main or alternate metadata URL and isolates each variant", async () => {
    const insert = db.prepare(`insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
      values (?, 'Barrel Dragon','Effect Monster','effect',? ,?, '[]', 'now')`);
    for (const id of [81480460, 81480461]) {
      insert.run(id, `https://example.com/full/${id}.jpg`, `https://example.com/small/${id}.jpg`);
      db.prepare("insert into card_artworks (card_id,artwork_id,image_url,image_url_small,image_url_cropped,is_main) values (81480460, ?, ?, ?, ?, ?)")
        .run(id, `https://example.com/full/${id}.jpg`, `https://example.com/small/${id}.jpg`, `https://example.com/crop/${id}.jpg`, Number(id === 81480460));
    }
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { fetched.push(url); return new Response(`art:${url}`); }));
    for (const id of [81480460, 81480461]) {
      for (const [query, kind, filename] of [["", "full", `${id}.jpg`], ["?size=small", "small", `${id}-small.jpg`], ["?variant=cropped", "crop", `${id}-cropped.jpg`]]) {
        const res = await getImage(String(id), query);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe(`art:https://example.com/${kind}/${id}.jpg`);
        expect(readFileSync(join(cacheDir, filename), "utf8")).toBe(`art:https://example.com/${kind}/${id}.jpg`);
      }
    }
    expect(fetched).toHaveLength(6);
    getDb.mockImplementation(() => { throw new Error("Cache hits must not need metadata"); });
    const cached = await getImage("81480461", "?variant=cropped");
    expect(await cached.text()).toBe("art:https://example.com/crop/81480461.jpg");
    expect(fetched).toHaveLength(6);
    expect(callDuelHost).not.toHaveBeenCalled();
  });

  it.each([89631139, 46986414])("serves the coin-toss crop for %s without metadata", async (id) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { fetched.push(url); return new Response("crop"); }));
    const res = await getImage(String(id), "?variant=cropped");
    expect(res.status).toBe(200);
    expect(fetched).toEqual([`https://images.ygoprodeck.com/images/cards_cropped/${id}.jpg`]);
  });

  it("does not substitute a full card when its crop is missing", async () => {
    const res = await getImage("5405694", "?variant=cropped");
    expect(res.status).toBe(404);
    expect(fetched).toEqual(["https://images.ygoprodeck.com/images/cards_cropped/5405694.jpg"]);
  });

  it("rejects an unsupported variant before fetching", async () => {
    expect((await getImage("81480460", "?variant=unknown")).status).toBe(400);
    expect(fetched).toEqual([]);
  });

  it("uses the mapped main crop when an alternate crop is unavailable", async () => {
    for (const id of [81480460, 81480461]) {
      db.prepare(`insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
        values (?,'Barrel Dragon','Effect Monster','effect','full','small','[]','now')`).run(id);
      db.prepare("insert into card_artworks (card_id,artwork_id,image_url,image_url_small,image_url_cropped,is_main) values (81480460, ?, 'full', 'small', ?, ?)")
        .run(id, `https://example.com/crop/${id}.jpg`, Number(id === 81480460));
    }
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      fetched.push(url); return url.endsWith("81480460.jpg") ? new Response("main crop") : new Response("missing", { status: 404 });
    }));
    expect(await (await getImage("81480461", "?variant=cropped")).text()).toBe("main crop");
    expect(fetched).toEqual(["https://example.com/crop/81480461.jpg", "https://example.com/crop/81480460.jpg"]);
    expect(callDuelHost).not.toHaveBeenCalled();
  });

  it("does not cache a transient upstream failure", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const upstream = vi.fn().mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("recovered crop"));
    vi.stubGlobal("fetch", upstream);
    try {
      expect((await getImage("89631139", "?variant=cropped")).status).toBe(500);
      expect(await (await getImage("89631139", "?variant=cropped")).text()).toBe("recovered crop");
      expect(upstream).toHaveBeenCalledTimes(2);
      expect(callDuelHost).not.toHaveBeenCalled();
    } finally { errorLog.mockRestore(); }
  });
});
