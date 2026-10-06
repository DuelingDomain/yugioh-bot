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
const IGNIS = "https://pics.projectignis.org:2096/pics";
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
    expect(fetched).toEqual([`${IMAGES}/10000100.jpg`, `${IGNIS}/10000100.jpg`, `${IMAGES}/5405694.jpg`]);
    expect(callDuelHost).toHaveBeenCalledWith(expect.objectContaining({ op: "card-details", codes: [10000100] }));
    // The alias image is cached under the requested passcode, so the next request reads the disk.
    expect(readFileSync(join(cacheDir, "10000100.jpg"))).toEqual(RITUAL_ART);
  });

  it("returns 404 when neither the passcode nor an alias has an image", async () => {
    callDuelHost.mockResolvedValue({ ok: true, data: { cards: [{ code: 12345678, alias: 0 }], missing: [] } });

    const response = await getImage("12345678", "?size=small");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Card image not found" });
    expect(fetched).toEqual(["https://images.ygoprodeck.com/images/cards_small/12345678.jpg", `${IGNIS}/12345678.jpg`]);
  });

  it.each(["full", "small"])("fetches and caches the requested Ignis %s art before consulting its alias", async variant => {
    const id = 89631133;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      fetched.push(url);
      return url === `${IGNIS}/${id}.jpg` ? new Response(new Uint8Array(RITUAL_ART)) : new Response("missing", { status: 404 });
    }));
    const query = variant === "small" ? "?variant=small" : "";
    const response = await getImage(String(id), query);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(RITUAL_ART);
    expect(fetched).toEqual([`https://images.ygoprodeck.com/images/${variant === "small" ? "cards_small" : "cards"}/${id}.jpg`, `${IGNIS}/${id}.jpg`]);
    expect(readFileSync(join(cacheDir, `${id}${variant === "small" ? "-small" : ""}.jpg`))).toEqual(RITUAL_ART);
    expect(callDuelHost).not.toHaveBeenCalled();
    expect((await getImage(String(id), query)).status).toBe(200);
    expect(fetched).toHaveLength(2);
  });

  it("retries a previous two-source miss when Ignis gains an image", async () => {
    const id = "89631133";
    callDuelHost.mockResolvedValue({ ok: true, data: { cards: [], missing: [Number(id)] } });
    expect((await getImage(id)).status).toBe(404);
    expect(() => readFileSync(join(cacheDir, `${id}.jpg`))).toThrow();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === `${IGNIS}/${id}.jpg`
      ? new Response(new Uint8Array(RITUAL_ART)) : new Response("missing", { status: 404 })));
    expect(Buffer.from(await (await getImage(id)).arrayBuffer())).toEqual(RITUAL_ART);
    expect(readFileSync(join(cacheDir, `${id}.jpg`))).toEqual(RITUAL_ART);
  });

  it("rejects invalid Ignis image bytes without caching them", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith(IGNIS)
      ? new Response("invalid image") : new Response("missing", { status: 404 })));
    const response = await getImage("89631133");
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Invalid card image" });
    expect(() => readFileSync(join(cacheDir, "89631133.jpg"))).toThrow();
  });

  it("keeps an Ignis 503 temporary and retries successfully", async () => {
    const upstream = vi.fn().mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", upstream);
    const response = await getImage("89631133");
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=30");
    expect(() => readFileSync(join(cacheDir, "89631133.jpg"))).toThrow();
    upstream.mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(new Response(new Uint8Array(RITUAL_ART)));
    expect(Buffer.from(await (await getImage("89631133")).arrayBuffer())).toEqual(RITUAL_ART);
    expect(upstream).toHaveBeenCalledTimes(4);
  });

  it("returns 404 for a passcode absent from the engine", async () => {
    callDuelHost.mockResolvedValue({ ok: true, data: { cards: [], missing: [99999999] } });
    expect((await getImage("99999999")).status).toBe(404);
  });

  it("returns 404 when the requested image and its alias are both missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", { status: 404 })));
    expect((await getImage("10000100")).status).toBe(404);
  });

  it.each([429, 503])("returns a temporary card back when the alias lookup fails with HTTP %s", async (status) => {
    callDuelHost.mockResolvedValueOnce({ ok: false, response: new Response("unavailable", { status }) });
    const response = await getImage("10000100");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(() => readFileSync(join(cacheDir, "10000100.jpg"))).toThrow();
    expect(Buffer.from(await (await getImage("10000100")).arrayBuffer())).toEqual(RITUAL_ART);
  });

  it("returns a temporary card back when actor verification is unavailable", async () => {
    requireDuelActor.mockResolvedValue({ ok: false, response: new Response("unavailable", { status: 503 }) });
    const response = await getImage("10000100");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(callDuelHost).not.toHaveBeenCalled();
  });

  it("keeps a transient alias lookup rejection out of the 404 path", async () => {
    const { CardFetchError } = await import("@yugidraft/shared/services");
    callDuelHost.mockRejectedValue(new CardFetchError());
    const response = await getImage("10000100");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
  });

  it.each([400, 403])("reports a permanent alias lookup HTTP %s error", async (status) => {
    callDuelHost.mockResolvedValue({ ok: false, response: new Response("error", { status }) });
    expect((await getImage("10000100")).status).toBe(502);
  });

  it.each([302, 400, 401, 403])("does not return a card back for upstream HTTP %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("error", { status })));
    const response = await getImage("89631139");
    expect(response.status).toBe(502);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(() => readFileSync(join(cacheDir, "89631139.jpg"))).toThrow();
  });

  it("reports an internal error instead of returning a card back", async () => {
    getDb.mockImplementation(() => { throw new Error("database unavailable"); });
    expect((await getImage("89631139")).status).toBe(500);
  });

  it("rejects invalid image bytes instead of returning a card back", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("invalid image")));
    expect((await getImage("89631139")).status).toBe(502);
    expect(() => readFileSync(join(cacheDir, "89631139.jpg"))).toThrow();
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
    expect(res.status).toBe(404);
    expect(fetched).toEqual(["https://images.ygoprodeck.com/images/cards_cropped/5405694.jpg"]);
  });

  it.each(["network", "timeout", "429", "503"])("returns a card back for %s without poisoning the cache", async (failure) => {
    const upstream = vi.fn(async (url: string) => {
      fetched.push(url);
      if (failure === "network") throw new TypeError("fetch failed");
      if (failure === "timeout") throw new DOMException("timeout", "TimeoutError");
      return new Response("unavailable", { status: Number(failure), headers: { "Retry-After": "2" } });
    });
    vi.stubGlobal("fetch", upstream);
    const response = await getImage("89631139");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=30");
    expect(await response.text()).toContain("<svg");
    expect(fetched).toEqual([`${IMAGES}/89631139.jpg`]);
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
