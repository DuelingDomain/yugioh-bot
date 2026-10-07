import cron from "node-cron";
import type { createImageCacheCleanup } from "@yugidraft/shared/services";
import { createLoop } from "./loop.js";

export function createImageCleanup({ cache, maximumBytes, expression, timezone }: {
  cache: ReturnType<typeof createImageCacheCleanup>;
  maximumBytes: number;
  expression: string;
  timezone: string;
}) {
  const loop = createLoop(async () => { await cache.removeOldestImages(maximumBytes); });
  let scheduled: ReturnType<typeof cron.schedule> | undefined;
  let closed = false;

  return {
    tick: loop.tick,
    async start() {
      if (closed || scheduled) return;
      scheduled = cron.schedule(expression, () => { void loop.tick(); }, { timezone });
      await loop.tick();
    },
    async stop() {
      closed = true;
      await scheduled?.stop();
      await loop.stop();
      await scheduled?.destroy();
    },
  };
}
