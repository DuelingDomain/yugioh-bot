import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { stackDir } from "../stack/env.mjs";

/** Raw PNG output of a screenshot run: packages/e2e/.stack-N/screenshots (or .stack without a slot). */
export function shotDir(name: string): string {
  const dir = resolve(process.env.SHOT_DIR ?? resolve(stackDir, "screenshots"));
  mkdirSync(dir, { recursive: true });
  return resolve(dir, name);
}

/** Display names for the seeded players and the practice bots in the shots. */
export const SHOT_NAMES = { player: "Yugi M.", bots: ["Kaiba Fan", "Mai V.", "Rex R."] };

/** Gives the seeded test players plain display names (the e2e names carry an "E2E" prefix). Idempotent. */
export async function cleanNames(): Promise<void> {
  const { openDatabase } = await import("@yugidraft/shared/db");
  const { dbPath } = await import("../stack/env.mjs");
  const db = openDatabase(dbPath);
  try {
    const names: Array<[number, string]> = [[101, SHOT_NAMES.player], [102, "Kaiba Fan"], [103, "Mai V."], [104, "Rex R."], [105, "Joey W."]];
    for (const [userId, name] of names) {
      db.prepare("UPDATE users SET display_name=?, username=? WHERE id=?").run(name, name.toLowerCase().replace(/\W+/g, "_"), userId);
      db.prepare("UPDATE players SET display_name=? WHERE user_id=?").run(name, userId);
    }
  } finally {
    db.close();
  }
}

/** Hides dev-only controls (bug report, cancel draft, update pill) so a shot shows only the product. */
export async function hideDebug(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("[aria-label^='Updates,']")) (el as HTMLElement).style.visibility = "hidden";
    for (const el of document.querySelectorAll("button, a, [role=button], [class*=pill], [class*=Pill]")) {
      if (/^(Report bug|Cancel draft|Updates\s*v[\d.]+)$/.test(el.textContent?.trim() ?? "")) (el as HTMLElement).style.visibility = "hidden";
    }
  });
}
