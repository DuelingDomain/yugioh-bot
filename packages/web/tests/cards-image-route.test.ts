// packages/web/tests/cards-image-route.test.ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { migrate } from "@yugidraft/shared/db";

const requireDuelActor = vi.fn();
const callDuelHost = vi.fn();
vi.mock("@/lib/duel-host", () => ({ requireDuelActor, callDuelHost }));
const getDb = vi.fn();
vi.mock("@/lib/db", () => ({ getDb }));

const IMAGES = "https://images.ygoprodeck.com/images/cards";
async function jpeg(label: string): Promise<Buffer> {
  const hash = createHash("sha256").update(label).digest();
  return sharp({ create: { width: 16, height: 24, channels: 3, background: { r: hash[0], g: hash[1], b: hash[2] } } }).jpeg().toBuffer();
}
const RITUAL_ART = await jpeg("ritual-art");
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
      if (url === `${IMAGES}/5405694.jpg`) return new Response(new Uint8Array(RITUAL_ART));
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

  it("returns a short-lived card back when neither the passcode nor an alias has an image", async () => {
    callDuelHost.mockResolvedValue({ ok: true, data: { cards: [{ code: 12345678, alias: 0 }], missing: [] } });

    const response = await getImage("12345678", "?size=small");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=30");
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
      insert.run(id, `https://images.ygoprodeck.com/full/${id}.jpg`, `https://images.ygoprodeck.com/small/${id}.jpg`);
      db.prepare("insert into card_artworks (card_id,artwork_id,image_url,image_url_small,image_url_cropped,is_main) values (81480460, ?, ?, ?, ?, ?)")
        .run(id, `https://images.ygoprodeck.com/full/${id}.jpg`, `https://images.ygoprodeck.com/small/${id}.jpg`, `https://images.ygoprodeck.com/crop/${id}.jpg`, Number(id === 81480460));
    }
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { fetched.push(url); return new Response(new Uint8Array(await jpeg(`art:${url}`))); }));
    for (const id of [81480460, 81480461]) {
      for (const [query, kind, filename] of [["", "full", `${id}.jpg`], ["?size=small", "small", `${id}-small.jpg`], ["?variant=cropped", "crop", `${id}-cropped.jpg`]]) {
        const res = await getImage(String(id), query);
        expect(res.status).toBe(200);
        expect(Buffer.from(await res.arrayBuffer())).toEqual(await jpeg(`art:https://images.ygoprodeck.com/${kind}/${id}.jpg`));
        expect(readFileSync(join(cacheDir, filename))).toEqual(await jpeg(`art:https://images.ygoprodeck.com/${kind}/${id}.jpg`));
      }
    }
    expect(fetched).toHaveLength(6);
    getDb.mockImplementation(() => { throw new Error("Cache hits must not need metadata"); });
    const cached = await getImage("81480461", "?variant=cropped");
    expect(Buffer.from(await cached.arrayBuffer())).toEqual(await jpeg("art:https://images.ygoprodeck.com/crop/81480461.jpg"));
    expect(fetched).toHaveLength(6);
    expect(callDuelHost).not.toHaveBeenCalled();
  });

  it.each([89631139, 46986414])("serves the coin-toss crop for %s without metadata", async (id) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { fetched.push(url); return new Response(new Uint8Array(await jpeg("crop"))); }));
    const res = await getImage(String(id), "?variant=cropped");
    expect(res.status).toBe(200);
    expect(fetched).toEqual([`https://images.ygoprodeck.com/images/cards_cropped/${id}.jpg`]);
  });

  it("does not substitute a full card when its crop is missing", async () => {
    const res = await getImage("5405694", "?variant=cropped");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(fetched).toEqual(["https://images.ygoprodeck.com/images/cards_cropped/5405694.jpg"]);
  });

  it.each(["network", "timeout", "429", "503", "invalid image"])("returns a card back for %s without poisoning the cache", async (failure) => {
    const upstream = vi.fn(async () => {
      if (failure === "network") throw new TypeError("fetch failed");
      if (failure === "timeout") throw new DOMException("timeout", "TimeoutError");
      return new Response("unavailable", { status: failure === "invalid image" ? 200 : Number(failure), headers: { "Retry-After": "2" } });
    });
    vi.stubGlobal("fetch", upstream);
    const response = await getImage("89631139");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=30");
    expect(await response.text()).toContain("<svg");
    expect(() => readFileSync(join(cacheDir, "89631139.jpg"))).toThrow();
    if (failure === "429") {
      await getImage("46986414");
      expect(upstream).toHaveBeenCalledTimes(1);
    }
  });

  it.each(["network", "timeout", "429"])("uses a cached alias image during a %s failure", async (failure) => {
    writeFileSync(join(cacheDir, "5405694.jpg"), RITUAL_ART);
    const upstream = vi.fn(async () => {
      if (failure === "network") throw new Error("offline");
      if (failure === "timeout") throw new DOMException("timeout", "TimeoutError");
      return new Response("", { status: 429, headers: { "Retry-After": "2" } });
    });
    vi.stubGlobal("fetch", upstream);
    const response = await getImage("10000100");
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(RITUAL_ART);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=30");
    expect(() => readFileSync(join(cacheDir, "10000100.jpg"))).toThrow();
    vi.resetModules();
    const recovered = await jpeg("recovered alternate");
    upstream.mockResolvedValue(new Response(new Uint8Array(recovered)));
    const retry = await getImage("10000100");
    expect(Buffer.from(await retry.arrayBuffer())).toEqual(recovered);
    expect(readFileSync(join(cacheDir, "10000100.jpg"))).toEqual(recovered);
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
        .run(id, `https://images.ygoprodeck.com/crop/${id}.jpg`, Number(id === 81480460));
    }
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      fetched.push(url); return url.endsWith("81480460.jpg") ? new Response(new Uint8Array(await jpeg("main crop"))) : new Response("missing", { status: 404 });
    }));
    expect(Buffer.from(await (await getImage("81480461", "?variant=cropped")).arrayBuffer())).toEqual(await jpeg("main crop"));
    expect(fetched).toEqual(["https://images.ygoprodeck.com/crop/81480461.jpg", "https://images.ygoprodeck.com/crop/81480460.jpg"]);
    expect(callDuelHost).not.toHaveBeenCalled();
  });

  it("does not cache a transient upstream failure", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const upstream = vi.fn().mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(new Uint8Array(await jpeg("recovered crop"))));
    vi.stubGlobal("fetch", upstream);
    try {
      expect((await getImage("89631139", "?variant=cropped")).headers.get("Content-Type")).toBe("image/svg+xml");
      expect(Buffer.from(await (await getImage("89631139", "?variant=cropped")).arrayBuffer())).toEqual(await jpeg("recovered crop"));
      expect(upstream).toHaveBeenCalledTimes(2);
      expect(callDuelHost).toHaveBeenCalledTimes(1);
    } finally { errorLog.mockRestore(); }
  });
});

it.each(["http://images.ygoprodeck.com/1.jpg", "https://images.ygoprodeck.com.evil.test/1.jpg", "https://evil.test/1.jpg", "https://images.ygoprodeck.com:444/1.jpg", "https://user:pass@images.ygoprodeck.com/1.jpg"])("rejects stored image URL %s", async (stored) => {
  // Use the suite fixture explicitly for this standalone case.
  vi.resetModules();
  const dir = mkdtempSync(join(tmpdir(), "card-url-"));
  process.env.CARD_IMAGE_CACHE_DIR = dir;
  const database = new Database(":memory:"); migrate(database); getDb.mockReturnValue(database);
  database.exec("insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (1,'Test','Spell','spell','url','url','[]','now')");
  database.prepare("insert into card_artworks (card_id,artwork_id,image_url,image_url_small,is_main) values (1,1,?,?,1)").run(stored, stored);
  const upstream = vi.fn(async () => new Response(new Uint8Array(await jpeg("image")))); vi.stubGlobal("fetch", upstream);
  try {
    expect((await getImage("1")).status).toBe(200);
    expect(upstream).toHaveBeenCalledWith(`${IMAGES}/1.jpg`, expect.objectContaining({ signal: expect.any(AbortSignal), redirect: "error" }));
  } finally { database.close(); rmSync(dir, { recursive: true, force: true }); delete process.env.CARD_IMAGE_CACHE_DIR; vi.unstubAllGlobals(); }
});
