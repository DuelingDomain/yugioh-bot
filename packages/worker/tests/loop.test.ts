import { afterEach, expect, it, vi } from "vitest";
import { createLoop } from "../src/loop.js";
afterEach(() => vi.useRealTimers());
it("coalesces slow ticks and drains before stop resolves", async () => {
  vi.useFakeTimers();
  let release!:()=>void;
  const run=vi.fn(()=>new Promise<void>(resolve=>{release=resolve;}));
  const loop=createLoop(run,1000);
  const started=loop.start();
  await Promise.resolve();
  const again=loop.tick();
  await vi.advanceTimersByTimeAsync(3000);
  expect(run).toHaveBeenCalledTimes(1);
  let stopped=false;
  const stop=loop.stop().then(()=>{stopped=true;});
  await Promise.resolve(); expect(stopped).toBe(false);
  release(); await Promise.all([started,again,stop]);
  await vi.advanceTimersByTimeAsync(5000);
  await loop.tick(); expect(run).toHaveBeenCalledTimes(1);
});
it("continues after a failed tick",async()=>{
  vi.useFakeTimers();
  const run=vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  const loop=createLoop(run,1000);
  await loop.start(); await vi.advanceTimersByTimeAsync(1000);
  expect(run).toHaveBeenCalledTimes(2); await loop.stop();
});
