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
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ lookupIds: [46986414] });
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

// Media transport uses the same browser-safe recognition contract as the WS relay.
it("marks missing frames frozen at three seconds and recovers on the next frame", async () => {
  const { FrameHealth } = await import("../src/lib/remote/video-protocol");
  const health = new FrameHealth(100);
  expect(health.frozen(3099)).toBe(false);
  expect(health.frozen(3100)).toBe(true);
  health.frame(3200);
  expect(health.frozen(3201)).toBe(false);
});

it("binds media to authenticated seat metadata rather than names or track labels", async () => {
  const { participantSeat } = await import("../src/lib/remote/video-protocol");
  const members = [{ seat: 1, userId: 12 }];
  const metadata = JSON.stringify({ guildId: "g", tableId: "t", userId: 12, seat: 1 });
  expect(participantSeat("remote-user-12", metadata, "g", "t", members)).toBe(1);
  expect(participantSeat("forged", metadata, "g", "t", members)).toBeUndefined();
  expect(participantSeat("remote-user-12", metadata, "other", "t", members)).toBeUndefined();
  expect(participantSeat("remote-user-12", metadata, "g", "t", [])).toBeUndefined();
});

it("routes requests only to the raw feed owner and accepts one correlated bounded result", async () => {
  const { RecognitionChannel } = await import("../src/lib/remote/video-protocol");
  const sends: { message: unknown; destination?: number }[] = [];
  const result = vi.fn(); const recognize = vi.fn(async () => ({ candidates: [{ cardId: 1, name: "Card", score: 0.9 }], tier: "sure" as const, faceDown: false, covered: false }));
  let now = 0;
  const channel = new RecognitionChannel(1, async (message, destination) => { sends.push({ message, destination }); }, recognize, result, () => now);
  const request = { type: "recognition.request", requestId: "one", feedOwnerSeat: 1, x: 0.4, y: 0.5 } as const;
  await channel.receive(0, request);
  expect(recognize).toHaveBeenCalledWith(request);
  expect(sends[0]).toEqual({ message: { type: "recognition.result", requestId: "one", candidates: [{ cardId: 1, name: "Card", score: 0.9 }], tier: "sure", faceDown: false, covered: false }, destination: undefined });
  await channel.receive(1, sends[0].message);
  expect(result).toHaveBeenCalledTimes(1);
  now = 101; await channel.receive(1, sends[0].message);
  expect(result).toHaveBeenCalledTimes(1);
  await channel.receive(0, { ...request, requestId: "bad", x: 2 });
  expect(recognize).toHaveBeenCalledTimes(1);
  now = 202; await channel.request(0, 0.2, 0.3, "outgoing");
  expect(sends.at(-1)?.destination).toBe(0);
  await channel.receive(2, { type: "recognition.result", requestId: "outgoing", candidates: [], tier: "sure", faceDown: false, covered: false });
  expect(result).toHaveBeenCalledTimes(1);
  now = 10_203; await channel.receive(0, { type: "recognition.result", requestId: "outgoing", candidates: [], tier: "sure", faceDown: false, covered: false });
  expect(result).toHaveBeenCalledTimes(1);
  channel.close();
});

it("announces only correlation metadata, targets the owner, and broadcasts suggestions to every seat", async () => {
  const { RecognitionChannel } = await import("../src/lib/remote/video-protocol");
  const results = [vi.fn(), vi.fn(), vi.fn()]; const recognizers = [vi.fn(async () => ({ candidates: [], tier: "low match" as const, faceDown: false, covered: false })), vi.fn(async () => ({ candidates: [{ cardId: 2, name: "Card two", score: 1 }], tier: "sure" as const, faceDown: false, covered: false })), vi.fn(async () => ({ candidates: [], tier: "low match" as const, faceDown: false, covered: false }))];
  const queue: (() => Promise<void>)[] = [];
  const channels: InstanceType<typeof RecognitionChannel>[] = [];
  for (let seat = 0; seat < 3; seat++) channels.push(new RecognitionChannel(seat, async (message, destination, announcement) => {
    for (let receiver = 0; receiver < 3; receiver++) {
      if (receiver === seat || (destination !== undefined && receiver !== destination)) continue;
      queue.push(async () => {
        if (announcement && message.type === "recognition.request") channels[receiver].announce(seat, message.requestId, message.feedOwnerSeat);
        else await channels[receiver].receive(seat, message);
      });
    }
  }, recognizers[seat], results[seat]));
  await channels[0].request(1, 0.2, 0.8, "shared");
  while (queue.length) await queue.shift()!();
  expect(recognizers[0]).not.toHaveBeenCalled(); expect(recognizers[2]).not.toHaveBeenCalled();
  expect(recognizers[1]).toHaveBeenCalledOnce();
  for (const result of results) expect(result).toHaveBeenCalledWith({ type: "recognition.result", requestId: "shared", candidates: [{ cardId: 2, name: "Card two", score: 1 }], tier: "sure", faceDown: false, covered: false }, 1);
  channels.forEach(channel => channel.close());
});

it("parses activation with a named source and activation after identifying a card", async()=>{
  const {interpret}=await import("../src/components/remote/ui/grammar");
  const {ygoModule}=await import("@yugidraft/shared/remote");
  const state=ygoModule.initialState({seatCount:2}); state.identified={seat:0,cardId:70825459,name:"Trap Tracks",source:"voice",addErrors:[]};
  const ctx={state,players:[{seat:0,displayName:"Alice"}],me:0,trayOpen:false};
  expect(interpret("I activate Trap Tracks",ctx)).toMatchObject({kind:"effect",proposal:{type:"effect.activated",source:{name:"Trap Tracks"}}});
  expect(interpret("activate",ctx)).toMatchObject({kind:"effect",proposal:{source:{cardId:70825459}}});
});
