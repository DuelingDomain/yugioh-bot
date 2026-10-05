import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { createDraftImageService } from "../../src/services/card-images.js";

describe("shared card image service", () => {
  it("renders a numbered grid image", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "draft-images-"));
    const jpeg = await sharp({
      create: { width: 120, height: 176, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();

    try {
      const images = createDraftImageService({
        cacheDir: dir,
        fetch: async () => new Response(new Uint8Array(jpeg)),
      });

      const output = await images.renderNumberedGrid([
        { ygoprodeckId: 1, imageUrl: "https://example.com/1.jpg", imageUrlSmall: undefined },
        { ygoprodeckId: 2, imageUrl: "https://example.com/2.jpg", imageUrlSmall: undefined },
        { ygoprodeckId: 3, imageUrl: "https://example.com/3.jpg", imageUrlSmall: undefined },
        { ygoprodeckId: 4, imageUrl: "https://example.com/4.jpg", imageUrlSmall: undefined },
        { ygoprodeckId: 5, imageUrl: "https://example.com/5.jpg", imageUrlSmall: undefined },
        { ygoprodeckId: 6, imageUrl: "https://example.com/6.jpg", imageUrlSmall: undefined },
        { ygoprodeckId: 7, imageUrl: "https://example.com/7.jpg", imageUrlSmall: undefined },
        { ygoprodeckId: 8, imageUrl: "https://example.com/8.jpg", imageUrlSmall: undefined },
      ]);

      const meta = await sharp(output.buffer).metadata();
      expect(meta.format).toBe("png");
      expect(meta.width).toBe(4 * 100);
      expect(meta.height).toBe(2 * 145);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe.each(["network", "timeout", "429", "503", "invalid image"])("draft image %s failures", (failure) => {
  it.each(["grid", "labelled", "pool"])("renders %s cards with a card back and keeps cached images", async (mode) => {
    vi.resetModules();
    const { createDraftImageService: create } = await import("../../src/services/card-images.js");
    const dir = await mkdtemp(path.join(tmpdir(), "failed-images-"));
    const fetch = vi.fn(async () => {
      if (failure === "network") throw new TypeError("offline");
      if (failure === "timeout") throw new DOMException("timeout", "TimeoutError");
      return new Response("bad image", { status: failure === "invalid image" ? 200 : Number(failure), headers: { "Retry-After": "2" } });
    });
    try {
      const cards = Array.from({ length: 8 }, (_, i) => ({ ygoprodeckId: i + 1, label: String(i + 1), imageUrl: `https://images.ygoprodeck.com/images/cards/${i + 1}.jpg` }));
      const service = create({ cacheDir: dir, fetch });
      const result = mode === "grid" ? [await service.renderNumberedGrid(cards)]
        : mode === "labelled" ? await service.renderCardImages(cards) : await service.renderPoolCards(cards);
      for (const item of result) expect((await sharp(item.buffer).metadata()).format).toBe("png");
      const { readdir, writeFile } = await import("node:fs/promises");
      expect(await readdir(dir)).toEqual([]);
      const cached = await sharp({ create: { width: 240, height: 350, channels: 3, background: "white" } }).png().toBuffer();
      await writeFile(path.join(dir, "1-full.png"), cached);
      const calls = fetch.mock.calls.length;
      expect((await service.renderPoolCards([cards[0]]))[0].buffer).toEqual(cached);
      expect(fetch).toHaveBeenCalledTimes(calls);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
