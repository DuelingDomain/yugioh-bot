import type { Page } from "@playwright/test";
import Database from "better-sqlite3";
import { createDuelService } from "@yugidraft/shared/services";
import { dbPath, guildId } from "../stack/env.mjs";

/** Keep card-specific browser fixtures in lobby order while exercising the real 3-second opening. */
export function seedOrderedDiceOpening(db: Database.Database, slug: string, guild: string, at = Date.now()): void {
  let seat = 0;
  const service = createDuelService(db, { rollDie: () => 6 - seat++ });
  const session = service.get(slug, guild);
  if (session.format !== "ffa3" && session.format !== "ffa4") return;
  service.startOpening(slug, guild, session.organizerPlayerId, at);
}

/** The path belongs to the isolated Playwright stack; this helper never opens the application database. */
export function prepareOrderedDiceOpening(slug: string): void {
  const db = new Database(dbPath, { fileMustExist: true });
  try { seedOrderedDiceOpening(db, slug, guildId); }
  finally { db.close(); }
}
/** Seed only when the browser sends Start, so lobby polling cannot open the overlay before the click. */
export async function installOrderedDiceOpening(page: Page, slug: string): Promise<void> {
  await page.route(`**/api/duels/${slug}/start`, async (route) => {
    prepareOrderedDiceOpening(slug);
    await route.continue();
  }, { times: 1 });
}
