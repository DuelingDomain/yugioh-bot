import cron from "node-cron";
import type Database from "better-sqlite3";
import type { CardCatalogService } from "@yugidraft/shared/services";
import { createLoop } from "./loop.js";

export function createSetSync({ db, cards, expression, timezone }: {
  db: Database.Database;
  cards: Pick<CardCatalogService, "syncSets">;
  expression: string;
  timezone: string;
}) {
  const loop = createLoop(async () => { await cards.syncSets(); });
  let scheduled: ReturnType<typeof cron.schedule> | undefined;
  let closed = false;

  return {
    tick: loop.tick,
    async start() {
      if (closed || scheduled) return;
      scheduled = cron.schedule(expression, () => { void loop.tick(); }, { timezone });
      const row = db.prepare("select count(*) as n from card_sets").get() as { n: number };
      if (row.n === 0) await loop.tick();
    },
    async stop() {
      closed = true;
      await scheduled?.stop();
      await loop.stop();
      await scheduled?.destroy();
    },
  };
}
