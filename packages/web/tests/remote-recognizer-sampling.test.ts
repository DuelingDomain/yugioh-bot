import { expect, it, vi } from "vitest";
import { attachOwnFeed, detachOwnFeed, ownFieldResources } from "../src/components/remote/ui/recognizer";
import { resetSendHealth, setSendHealth, VISION_SLOW_FACTOR } from "../src/lib/remote/send-health-store";

// Keep the real camera buffer; model startup is unrelated to frame ownership.
vi.mock("@yugidraft/vision", async importOriginal => ({
  ...await importOriginal<typeof import("@yugidraft/vision")>(),
  createRecognizer: () => ({ prepare: async () => ({ backend: "wasm" }) }),
}));

it("waits out a slowed sampling gap and gives the watcher a fresh bitmap", async () => {
  vi.useFakeTimers({ now: 1000 });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("related-cards.json")
    ? new Response(null, { status: 404 }) : Response.json({ entries: [] })));
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ close: vi.fn() })));
  const video = { readyState: 2, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;
  try {
    setSendHealth({ visionSlowed: true });
    attachOwnFeed(video);
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(0);
    const resources = await ownFieldResources(() => ({ decklist: [], seen: [] }));
    expect(resources).not.toBeNull();
    const first = await resources!.buffer.sample({ maxAgeMs: 30 });
    const gap = VISION_SLOW_FACTOR * 100;
    await vi.advanceTimersByTimeAsync(100);
    let returned = false;
    const pending = resources!.buffer.sample({ maxAgeMs: 30 }).then(sample => { returned = true; return sample; });
    await vi.advanceTimersByTimeAsync(gap - 101);
    const returnedBeforeGap = returned;
    await vi.advanceTimersByTimeAsync(1);
    const second = await pending;
    expect(second.frame).not.toBe(first.frame);
    expect(returnedBeforeGap).toBe(false);
    expect(second.at).toBeGreaterThan(first.at);
    second.frame.close();
    // Closing this tick must leave a frame kept for a later card read alive.
    expect(first.frame.close).not.toHaveBeenCalled();
    first.frame.close();
  } finally {
    detachOwnFeed(video);
    resetSendHealth();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
