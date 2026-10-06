// packages/web/tests/cards-image-route.test.ts
import { mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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
function cachePath(passcode: string | number, variant = "full", source = "ygoprodeck") {
  return join(cacheDir, `v2-${source}-${passcode}${variant === "full" ? "" : `-${variant}`}.jpg`);
}

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
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(readdirSync(cacheDir, { recursive: true })).toEqual([]);
  });

  it.each(["403", "503", "network"])("serves Ritual alias art after an Ignis %s failure without caching", async failure => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      fetched.push(url);
      if (url === `${IGNIS}/10000100.jpg`) {
        if (failure === "network") throw new TypeError("offline");
        return new Response("unavailable", { status: Number(failure) });
      }
      return url === `${IMAGES}/5405694.jpg` ? new Response(new Uint8Array(RITUAL_ART)) : new Response("missing", { status: 404 });
    }));
    const response = await getImage("10000100");
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(RITUAL_ART);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetched).toEqual([`${IMAGES}/10000100.jpg`, `${IGNIS}/10000100.jpg`, `${IMAGES}/5405694.jpg`]);
    expect(readdirSync(cacheDir, { recursive: true })).toEqual([]);
  });

  it.each(["full", "small", "cropped"])("bypasses poisoned legacy %s art and recovers its own art after alias fallback", async variant => {
    const suffix = variant === "full" ? "" : `-${variant}`;
    writeFileSync(join(cacheDir, `10000100${suffix}.jpg`), RITUAL_ART);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("5405694.jpg")
      ? new Response(new Uint8Array(RITUAL_ART)) : new Response("missing", { status: 404 })));
    const response = await getImage("10000100", `?variant=${variant}`);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(RITUAL_ART);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(() => readFileSync(cachePath("10000100", variant))).toThrow();
    const ownArt = await jpeg("own alternate art");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === `${IGNIS}/10000100.jpg` || variant === "cropped"
      ? new Response(new Uint8Array(ownArt)) : new Response("missing", { status: 404 })));
    const recovered = await getImage("10000100", `?variant=${variant}`);
    expect(Buffer.from(await recovered.arrayBuffer())).toEqual(ownArt);
    expect(readFileSync(cachePath("10000100", variant, variant === "cropped" ? "ygoprodeck" : "ignis"))).toEqual(ownArt);
  });

  it.each(["full", "small", "cropped"])("migrates legacy API %s art without fetching", async variant => {
    db.exec(`insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
      values (5405694,'Ritual','Ritual Monster','ritual','full','small','[]','now');
      insert into card_artworks (card_id,artwork_id,image_url,image_url_small,is_main,source)
      values (5405694,5405694,'full','small',1,'api');`);
    const legacy = join(cacheDir, `5405694${variant === "full" ? "" : `-${variant}`}.jpg`);
    writeFileSync(legacy, RITUAL_ART);

    const response = await getImage("5405694", `?variant=${variant}`);

    expect(Buffer.from(await response.arrayBuffer())).toEqual(RITUAL_ART);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400, immutable");
    expect(fetched).toEqual([]);
    expect(readFileSync(cachePath("5405694", variant))).toEqual(RITUAL_ART);
    expect(() => readFileSync(legacy)).toThrow();
    expect(callDuelHost).not.toHaveBeenCalled();
  });

  it.each(["engine", "absent"])("fetches instead of migrating legacy art with an %s artwork row", async source => {
    if (source === "engine") {
      db.exec(`insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
        values (5405694,'Ritual','Ritual Monster','ritual','full','small','[]','now');
        insert into card_artworks (card_id,artwork_id,image_url,image_url_small,is_main,source)
        values (5405694,5405694,'full','small',1,'engine');`);
    }
    const legacy = join(cacheDir, "5405694.jpg");
    const poisoned = await jpeg("poisoned legacy art");
    writeFileSync(legacy, poisoned);

    const response = await getImage("5405694");

    expect(Buffer.from(await response.arrayBuffer())).toEqual(RITUAL_ART);
    expect(fetched).toEqual([`${IMAGES}/5405694.jpg`]);
    expect(readFileSync(cachePath("5405694"))).toEqual(RITUAL_ART);
    expect(readFileSync(legacy)).toEqual(poisoned);
  });

  it("upgrades an expired full-size Ignis cache entry to YGOPRODeck art", async () => {
    const ownArt = await jpeg("full resolution art");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith(IGNIS)
      ? new Response(new Uint8Array(RITUAL_ART)) : new Response("missing", { status: 404 })));
    const first = await getImage("89631133");
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=3600");
    const filename = cachePath("89631133", "full", "ignis");
    const expired = new Date(Date.now() - 7 * 24 * 3600 * 1000 - 1);
    utimesSync(filename, expired, expired);
    const upstream = vi.fn(async () => new Response(new Uint8Array(ownArt)));
    vi.stubGlobal("fetch", upstream);
    expect(Buffer.from(await (await getImage("89631133")).arrayBuffer())).toEqual(ownArt);
    expect(readFileSync(cachePath("89631133"))).toEqual(ownArt);
    expect(upstream).toHaveBeenCalledWith(`${IMAGES}/89631133.jpg`, expect.anything());
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it.each(["full", "small"])("keeps six-day-old Ignis %s art without fetching", async variant => {
    const filename = cachePath("89631133", variant, "ignis");
    writeFileSync(filename, RITUAL_ART);
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 3600 * 1000);
    utimesSync(filename, sixDaysAgo, sixDaysAgo);

    const response = await getImage("89631133", `?variant=${variant}`);

    expect(Buffer.from(await response.arrayBuffer())).toEqual(RITUAL_ART);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(fetched).toEqual([]);
    expect(callDuelHost).not.toHaveBeenCalled();
  });

  it.each([
    ["primary", "network"], ["primary", "timeout"], ["primary", "429"], ["primary", "503"],
    ["ignis", "network"], ["ignis", "403"], ["ignis", "503"], ["ignis", "404"],
  ])("serves expired Ignis art after a %s %s refresh failure", async (source, failure) => {
    const ownArt = await jpeg("expired alternate art");
    const filename = cachePath("10000100", "full", "ignis");
    writeFileSync(filename, ownArt);
    writeFileSync(cachePath("5405694"), RITUAL_ART);
    const expired = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    utimesSync(filename, expired, expired);
    const upstream = vi.fn(async (url: string) => {
      fetched.push(url);
      if (source === "ignis" && url.startsWith(IMAGES)) return new Response("missing", { status: 404 });
      if (failure === "network") throw new TypeError("offline");
      if (failure === "timeout") throw new DOMException("timeout", "TimeoutError");
      return new Response("unavailable", { status: Number(failure) });
    });
    vi.stubGlobal("fetch", upstream);

    const response = await getImage("10000100");

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(ownArt);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(readFileSync(filename)).toEqual(ownArt);
    expect(fetched).toEqual(source === "primary" ? [`${IMAGES}/10000100.jpg`]
      : [`${IMAGES}/10000100.jpg`, `${IGNIS}/10000100.jpg`]);
    expect(requireDuelActor).not.toHaveBeenCalled();
    expect(callDuelHost).not.toHaveBeenCalled();
  });

  it("reuses a verified alias and reads its current cache file for ten minutes", async () => {
    writeFileSync(cachePath("5405694"), RITUAL_ART);
    const upstream = vi.fn(async () => new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", upstream);
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now());
    try {
      const first = await getImage("10000100");
      expect(Buffer.from(await first.arrayBuffer())).toEqual(RITUAL_ART);
      const updatedAlias = await jpeg("updated alias image");
      writeFileSync(cachePath("5405694"), updatedAlias);
      now.mockReturnValue(now() + 9 * 60 * 1000);
      const second = await getImage("10000100");
      expect(Buffer.from(await second.arrayBuffer())).toEqual(updatedAlias);
      expect(requireDuelActor).toHaveBeenCalledTimes(1);
      expect(callDuelHost).toHaveBeenCalledTimes(1);
      now.mockReturnValue(now() + 60 * 1000 + 1);
      const third = await getImage("10000100");
      expect(Buffer.from(await third.arrayBuffer())).toEqual(updatedAlias);
      expect(requireDuelActor).toHaveBeenCalledTimes(2);
      expect(callDuelHost).toHaveBeenCalledTimes(2);
      expect(upstream).toHaveBeenCalledTimes(3);
    } finally { now.mockRestore(); }
  });

  it("suppresses repeated two-source misses for ten minutes, separately by variant", async () => {
    callDuelHost.mockResolvedValue({ ok: true, data: { cards: [], missing: [12345678] } });
    expect((await getImage("12345678")).status).toBe(404);
    expect((await getImage("12345678")).status).toBe(404);
    expect(fetched).toHaveLength(2);
    expect(callDuelHost).toHaveBeenCalledTimes(1);
    expect((await getImage("12345678", "?variant=small")).status).toBe(404);
    expect(fetched).toHaveLength(4);
    expect(callDuelHost).toHaveBeenCalledTimes(1);
    const realNow = Date.now.bind(Date);
    const now = vi.spyOn(Date, "now").mockImplementation(() => realNow() + 10 * 60 * 1000 + 1);
    try {
      expect((await getImage("12345678")).status).toBe(404);
      expect(fetched).toHaveLength(6);
      expect(callDuelHost).toHaveBeenCalledTimes(2);
    } finally { now.mockRestore(); }
  });

  it.each([401, 403])("does not negative-cache an unverified alias after actor HTTP %s", async status => {
    requireDuelActor.mockResolvedValueOnce({ ok: false, response: new Response("denied", { status }) });
    expect((await getImage("10000100")).status).toBe(404);
    expect(callDuelHost).not.toHaveBeenCalled();
    const response = await getImage("10000100");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(RITUAL_ART);
    expect(callDuelHost).toHaveBeenCalledTimes(1);
    expect(fetched).toHaveLength(5);
  });

  it("deduplicates concurrent image requests and removes completed work", async () => {
    const upstream = vi.fn(async () => new Response(new Uint8Array(RITUAL_ART)));
    vi.stubGlobal("fetch", upstream);
    const responses = await Promise.all(Array.from({ length: 8 }, () => getImage("5405694")));
    for (const response of responses) expect(Buffer.from(await response.arrayBuffer())).toEqual(RITUAL_ART);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(readdirSync(cacheDir)).toEqual(["v2-ygoprodeck-5405694.jpg"]);
    rmSync(cachePath("5405694"));
    expect((await getImage("5405694")).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("deduplicates a failed load and allows the same filename to recover", async () => {
    const upstream = vi.fn(async () => new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", upstream);
    const responses = await Promise.all(Array.from({ length: 8 }, () => getImage("5405694")));
    for (const response of responses) expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(readdirSync(cacheDir)).toEqual([]);
    upstream.mockImplementation(async () => new Response(new Uint8Array(RITUAL_ART)));
    const recovered = await getImage("5405694");
    expect(Buffer.from(await recovered.arrayBuffer())).toEqual(RITUAL_ART);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(readFileSync(cachePath("5405694"))).toEqual(RITUAL_ART);
  });

  it.each([false, true])("publishes cache files by rename and cleans up when rename fails=%s", async fails => {
    const fs = await import("node:fs/promises");
    const rename = vi.fn(async (from: string, to: string) => {
      expect(readFileSync(from)).toEqual(RITUAL_ART);
      expect(() => readFileSync(to)).toThrow();
      if (fails) throw new Error("disk unavailable");
      await fs.rename(from, to);
    });
    vi.doMock("node:fs/promises", () => ({ ...fs, rename }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(RITUAL_ART))));
    try {
      const response = await getImage("5405694");
      expect(Buffer.from(await response.arrayBuffer())).toEqual(RITUAL_ART);
      expect(rename).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), cachePath("5405694"));
      expect(readdirSync(cacheDir)).toEqual(fails ? [] : ["v2-ygoprodeck-5405694.jpg"]);
    } finally { vi.doUnmock("node:fs/promises"); }
  });

  it.each(["header", "stream"])("rejects an oversized response from its %s without caching", async mode => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(RITUAL_ART));
        if (mode === "stream") controller.enqueue(new Uint8Array(5 * 1024 * 1024));
        controller.enqueue(new Uint8Array([0]));
        controller.close();
      },
      cancel,
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: mode === "header" ? { "Content-Length": String(5 * 1024 * 1024 + 1) } : {} })));
    const response = await getImage("5405694");
    expect(response.status).toBe(502);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(readdirSync(cacheDir, { recursive: true })).toEqual([]);
  });

  it("serves an alias through YGOPRODeck even while Ignis is rate limited", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      fetched.push(url);
      if (url.startsWith(IGNIS)) return new Response("limited", { status: 429, headers: { "Retry-After": "600" } });
      return url.endsWith("10000100.jpg") ? new Response("missing", { status: 404 }) : new Response(new Uint8Array(RITUAL_ART));
    }));
    expect(Buffer.from(await (await getImage("10000100")).arrayBuffer())).toEqual(RITUAL_ART);
    expect(Buffer.from(await (await getImage("5405694")).arrayBuffer())).toEqual(RITUAL_ART);
    expect(fetched).toContain(`${IMAGES}/5405694.jpg`);
    expect(readdirSync(cacheDir)).toEqual(["v2-ygoprodeck-5405694.jpg"]);
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
    expect(readFileSync(cachePath(id, variant, "ignis"))).toEqual(RITUAL_ART);
    expect(callDuelHost).not.toHaveBeenCalled();
    expect((await getImage(String(id), query)).status).toBe(200);
    expect(fetched).toHaveLength(2);
  });

  it("retries a previous two-source miss after the negative cache expires", async () => {
    const id = "89631133";
    callDuelHost.mockResolvedValue({ ok: true, data: { cards: [], missing: [Number(id)] } });
    expect((await getImage(id)).status).toBe(404);
    expect(() => readFileSync(cachePath(id))).toThrow();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === `${IGNIS}/${id}.jpg`
      ? new Response(new Uint8Array(RITUAL_ART)) : new Response("missing", { status: 404 })));
    const realNow = Date.now.bind(Date);
    const now = vi.spyOn(Date, "now").mockImplementation(() => realNow() + 10 * 60 * 1000 + 1);
    try {
      expect(Buffer.from(await (await getImage(id)).arrayBuffer())).toEqual(RITUAL_ART);
      expect(readFileSync(cachePath(id, "full", "ignis"))).toEqual(RITUAL_ART);
    } finally { now.mockRestore(); }
  });

  it("rejects invalid Ignis image bytes without caching them", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith(IGNIS)
      ? new Response("invalid image") : new Response("missing", { status: 404 })));
    const response = await getImage("89631133");
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Invalid card image" });
    expect(() => readFileSync(cachePath("89631133"))).toThrow();
  });

  it("keeps an Ignis 503 temporary and retries successfully", async () => {
    const upstream = vi.fn().mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", upstream);
    const response = await getImage("89631133");
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=30");
    expect(() => readFileSync(cachePath("89631133"))).toThrow();
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
    expect(() => readFileSync(cachePath("10000100"))).toThrow();
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
    expect(() => readFileSync(cachePath("89631139"))).toThrow();
  });

  it("reports an internal error instead of returning a card back", async () => {
    getDb.mockImplementation(() => { throw new Error("database unavailable"); });
    expect((await getImage("89631139")).status).toBe(500);
  });

  it("rejects invalid image bytes instead of returning a card back", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("invalid image")));
    expect((await getImage("89631139")).status).toBe(502);
    expect(() => readFileSync(cachePath("89631139"))).toThrow();
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
        expect(readFileSync(join(cacheDir, `v2-ygoprodeck-${filename}`))).toEqual(await jpeg(`art:https://images.ygoprodeck.com/${kind}/${id}.jpg`));
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
    expect(() => readFileSync(cachePath("89631139"))).toThrow();
    if (failure === "429") {
      await getImage("46986414");
      expect(upstream).toHaveBeenCalledTimes(1);
    }
  });

  it.each(["network", "timeout", "429"])("uses a cached alias image during a %s failure", async (failure) => {
    writeFileSync(cachePath("5405694"), RITUAL_ART);
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
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(() => readFileSync(cachePath("10000100"))).toThrow();
    vi.resetModules();
    const recovered = await jpeg("recovered alternate");
    upstream.mockResolvedValue(new Response(new Uint8Array(recovered)));
    const retry = await getImage("10000100");
    expect(Buffer.from(await retry.arrayBuffer())).toEqual(recovered);
    expect(readFileSync(cachePath("10000100"))).toEqual(recovered);
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
