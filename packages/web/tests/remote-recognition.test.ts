import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { recognizeLocalCard } from "../src/components/remote/recognize-card";

const ocr = { text: "Dark Magician\n46986414", terminate: vi.fn(), post: vi.fn(), fail: false };
const canvas = { toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["local frame"])) } as HTMLCanvasElement;
beforeEach(() => {
  ocr.fail = false; ocr.text = "Dark Magician\n46986414";
  vi.stubGlobal("Worker", class {
    onmessage: ((event: { data: unknown }) => void) | null = null; onerror: (() => void) | null = null;
    terminate = ocr.terminate;
    postMessage(value: unknown) { ocr.post(value); queueMicrotask(() => { if (ocr.fail) this.onerror?.(); else this.onmessage?.({ data: { text: ocr.text } }); }); }
  });
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

it("reads a local frame and sends only the public passcode to the existing catalog", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ cards: [{ id: 46986414, name: "Dark Magician" }] })); vi.stubGlobal("fetch", fetcher);
  expect(await recognizeLocalCard(canvas, new AbortController().signal)).toEqual([{ id: 46986414, name: "Dark Magician" }]);
  expect(ocr.post).toHaveBeenCalledWith({ image: expect.any(Blob) });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ customCardIds: [46986414] });
  expect(ocr.terminate).toHaveBeenCalledOnce();
});

it("falls back to a read name and always terminates OCR after lookup failure", async () => {
  ocr.text = "Blue Eyes White Dragon";
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "Catalog offline" }, { status: 503 })); vi.stubGlobal("fetch", fetcher);
  await expect(recognizeLocalCard(canvas, new AbortController().signal)).rejects.toThrow("Catalog offline");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ fuzzyName: "Blue Eyes White Dragon", includeExtra: true });
  expect(ocr.terminate).toHaveBeenCalledOnce();
});

it("reports no match without a catalog request for a blank frame", async () => {
  ocr.text = ""; const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect(await recognizeLocalCard(canvas, new AbortController().signal)).toEqual([]);
  expect(fetcher).not.toHaveBeenCalled(); expect(ocr.terminate).toHaveBeenCalledOnce();
});

it("cancels an in-flight scan and terminates the worker", async () => {
  const abort = new AbortController(); ocr.post.mockImplementationOnce(() => abort.abort());
  await expect(recognizeLocalCard(canvas, abort.signal)).rejects.toThrow(/cancelled/i);
  expect(ocr.terminate).toHaveBeenCalledOnce();
});

it("terminates its host even if startup fails before any OCR result", async () => {
  ocr.fail = true;
  await expect(recognizeLocalCard(canvas, new AbortController().signal)).rejects.toThrow(/could not start/i);
  expect(ocr.terminate).toHaveBeenCalledOnce();
});

it("releases child workers on a language-load error before Tesseract initialization resolves", async () => {
  const terminated = vi.fn(); const postMessage = vi.fn(); const close = vi.fn();
  const scope = { Worker: class { terminate = terminated; }, postMessage, close, addEventListener: vi.fn(), onmessage: null as null | ((event: unknown) => Promise<void>) };
  runInNewContext(readFileSync(new URL("../public/remote-ocr-worker.js", import.meta.url), "utf8"), {
    self: scope, importScripts: () => {}, Tesseract: { createWorker: async (_lang: string, _mode: number, options: { errorHandler: () => void }) => {
      new scope.Worker(); options.errorHandler(); return new Promise(() => {});
    } },
  });
  void scope.onmessage!({ data: { image: "frame" } });
  expect(terminated).toHaveBeenCalledOnce(); expect(postMessage).toHaveBeenCalledWith({ error: expect.any(String) }); expect(close).toHaveBeenCalledOnce();
});
