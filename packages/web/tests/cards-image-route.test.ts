// packages/web/tests/cards-image-route.test.ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireDuelActor = vi.fn();
const callDuelHost = vi.fn();
vi.mock("@/lib/duel-host", () => ({ requireDuelActor, callDuelHost }));

const IMAGES = "https://images.ygoprodeck.com/images/cards";
const RITUAL_ART = Buffer.from("ritual-art");
let cacheDir = "";
let fetched: string[] = [];

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
});
