import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { openDatabase } from "@yugidraft/shared/db";
import { createDraftService, createPlayerService } from "@yugidraft/shared/services";
import { test, expect } from "../helpers/fixtures";
import { FILLER, withFiller } from "../helpers/decks";
import { startTable } from "../helpers/board";
import { dbPath, guildId } from "../stack/env.mjs";

// Admin live watch on REAL games: p2 hosts tables with practice bots, p1 (owner) opens each one from /admin and
// switches point of view. Needs the stack started with E2E_ADMIN_CONSOLE=1 and E2E_OWNER_USER_IDS=101.
//   E2E_ADMIN_CONSOLE=1 E2E_OWNER_USER_IDS=101 E2E_SLOT=N E2E_WORKERS=1 npx playwright test admin-spectate
// E2E_SPECTATE_SHOTS=<dir> saves screenshots at four screen sizes.
test.skip(process.env.E2E_ADMIN_CONSOLE !== "1" || process.env.E2E_OWNER_USER_IDS !== "101", "set E2E_ADMIN_CONSOLE=1 and E2E_OWNER_USER_IDS=101");
test.describe.configure({ mode: "serial" });

const SHOTS = process.env.E2E_SPECTATE_SHOTS ?? "";
const SIZES = [
  { name: "1080p", width: 1920, height: 1080 },
  { name: "1440p", width: 2560, height: 1440 },
  { name: "1366", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 },
];

async function shots(page: Page, name: string, sizes = SIZES): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  for (const size of sizes) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.waitForTimeout(700);
    await page.screenshot({ path: resolve(SHOTS, `${name}-${size.name}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

/** Everything the watcher's page sends to the app while it watches: only reads may appear. */
function writes(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "GET" || request.method() === "HEAD") return;
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/duels") || url.pathname.startsWith("/api/drafts") || url.pathname.startsWith("/api/admin/duels") || url.pathname.startsWith("/api/admin/drafts")) {
      seen.push(`${request.method()} ${url.pathname}`);
    }
  });
  return seen;
}


/** The Watch button of a live row opens the watch page in a new tab. Returns that tab and what it sends. */
async function openWatch(console: Page, tableName: "Live duels" | "Live drafts", rowText: string): Promise<{ watch: Page; sent: string[]; consoleSent: string[] }> {
  const consoleSent = writes(console);
  await console.goto("/admin#duels");
  const row = console.getByRole("region", { name: "Duels" }).getByRole("table", { name: tableName }).getByRole("row").filter({ hasText: rowText });
  const link = row.getByRole("link", { name: "Watch" });
  await expect(link).toBeVisible();
  const popup = console.waitForEvent("popup");
  await link.click();
  const watch = await popup;
  const sent = writes(watch);
  return { watch, sent, consoleSent };
}

const FORMATS = [
  { format: "1v1" as const, bots: [1], visibility: "public" as const, seats: 2 },
  { format: "ffa3" as const, bots: [1, 2], visibility: "private" as const, seats: 3 },
  { format: "ffa4" as const, bots: [1, 2, 3], visibility: "public" as const, seats: 4 },
  { format: "tag" as const, bots: [1, 2, 3], visibility: "private" as const, seats: 4 },
];

// A host who is still in a live table cannot open the table form, so every format has its own host.
const HOSTS = ["p2", "p3", "p4", "p5"] as const;
// First in the file: p2 is still in a live table after the duel tests, and a live player is sent to that table when opening a draft.
test("admin watches a live draft, switches point of view and sees picks arrive", async ({ player }) => {
  test.setTimeout(180_000);
  const host = await player("p2");
  const admin = await player("p1");
  const db = openDatabase(dbPath);
  const ids = Array.from({ length: 72 }, (_, i) => 91010000 + i);
  const players = createPlayerService(db);
  const drafts = createDraftService(db, { seedSource: () => 7 });
  const insert = db.prepare(`INSERT OR IGNORE INTO card_catalog(ygoprodeck_id,name,type,frame_type,archetype,image_url,image_url_small,card_sets_json,cached_at)
    VALUES(?,?,'Effect Monster','effect','Watch family',?,?,'[]',CURRENT_TIMESTAMP)`);
  for (const id of ids) insert.run(id, `Watch card ${id}`, `https://images.ygoprodeck.com/images/cards/${id}.jpg`, `https://images.ygoprodeck.com/images/cards_small/${id}.jpg`);
  const human = players.findOrCreate(guildId, 102, "E2E Bob");
  const draft = drafts.create(guildId, null, "Watch draft", { cubeCardIds: ids, packSize: 5, packsPerPlayer: 3, cardsPerPlayer: 15, pickSeconds: 600 }, 102, human.id);
  for (const n of [1, 2]) {
    const user = db.prepare("INSERT INTO users(username,display_name) VALUES(?,?)").run(`watch_bot_${n}`, `Bot ${n}`);
    const bot = players.findOrCreate(guildId, Number(user.lastInsertRowid), `Bot ${n}`);
    db.prepare("UPDATE players SET discord_user_id=? WHERE id=?").run(`bot_player_dev_${n}`, bot.id);
    drafts.join(draft.id, bot.id);
  }
  drafts.start(draft.id);
  const slug = draft.webSlug!;

  const { watch, sent } = await openWatch(admin.page, "Live drafts", "Watch draft");
  await watch.waitForURL(new RegExp(`/admin/watch/draft/${slug}`));
  await expect(watch.getByTestId("admin-watch-bar")).toContainText("Read-only");
  const chips = watch.getByRole("radiogroup", { name: "Point of view" }).getByRole("radio");
  await expect(chips).toHaveCount(3);
  await expect(watch.locator(".dr .tcard:not([aria-hidden='true'])").first()).toBeVisible();
  await shots(watch, "draft-pov0");

  // The host picks a card; the watcher's view moves on without any reload.
  await host.page.goto(`/draft/${slug}`);
  const hostCard = host.page.locator(".dr .tcard:not([aria-hidden='true'])").first();
  await expect(hostCard).toBeVisible();
  await hostCard.click();
  await hostCard.click();
  for (let i = 1; i < 3; i += 1) {
    await chips.nth(i).click();
    await expect(chips.nth(i)).toHaveAttribute("aria-checked", "true");
    await expect(watch.locator(".dr .tcard:not([aria-hidden='true'])").first()).toBeVisible();
    await shots(watch, `draft-pov${i}`, SIZES.slice(0, 1));
  }
  await chips.nth(0).click();
  await expect(chips.nth(0)).toHaveAttribute("aria-checked", "true");
  await shots(watch, "draft-pov0-after-pick");
  // Clicking a pack card as the watcher picks nothing.
  await watch.locator(".dr .tcard:not([aria-hidden='true'])").first().click({ force: true }).catch(() => undefined);
  expect(sent.filter((entry) => entry.includes("/pick") || entry.includes("/talk"))).toEqual([]);
  db.close();
});

for (const [index, { format, bots, visibility, seats }] of FORMATS.entries()) {
  test(`admin watches a live ${format} table (${visibility}) and switches point of view`, async ({ player }) => {
    test.setTimeout(240_000);
    const host = await player(HOSTS[index]);
    const admin = await player("p1");
    const { slug, table } = await startTable([host], `watch ${format}`, [{ main: withFiller([FILLER], 40) }],
      { ordered: true, looseDecks: true, noBanlist: true, format, bots, visibility });

    // The console lists the table, private ones too, with a Watch button on its row.
    await admin.page.goto("/admin#duels");
    if (visibility === "private") await expect(admin.page.getByRole("region", { name: "Duels" }).getByRole("table", { name: "Live duels" }).getByRole("row").filter({ hasText: table })).toContainText("Private");
    await shots(admin.page, `console-${format}`, SIZES.slice(0, 1));
    const { watch, sent } = await openWatch(admin.page, "Live duels", table);
    await watch.waitForURL(new RegExp(`/admin/watch/duel/${slug}`));

    const bar = watch.getByTestId("admin-watch-bar");
    await expect(bar).toContainText("Watching as admin");
    await expect(bar).toContainText("Read-only");
    await expect(watch.getByTestId("watch-pov-neutral")).toBeVisible();
    for (let seat = 0; seat < seats; seat += 1) await expect(watch.getByTestId(`watch-pov-${seat}`)).toBeVisible();

    // Neutral first, then every seat. The room under the bar is the real board of that seat.
    await watch.getByTestId("watch-pov-neutral").click();
    await expect(watch.locator("[data-table-shell], [data-hand-seat]").first()).toBeVisible();
    await shots(watch, `duel-${format}-neutral`);
    for (let seat = 0; seat < seats; seat += 1) {
      await watch.getByTestId(`watch-pov-${seat}`).click();
      await expect(watch.getByTestId(`watch-pov-${seat}`)).toHaveAttribute("aria-checked", "true");
      await expect(watch).toHaveURL(new RegExp(`seat=${seat}`));
      await expect(watch.locator("[data-table-shell], [data-hand-seat]").first()).toBeVisible();
      await shots(watch, `duel-${format}-seat${seat}`, seat === 0 ? SIZES : SIZES.slice(0, 1));
    }
    // The host's own screen at the same size: the reference that seat 0 of the watch has to match.
    await shots(host.page, `player-${format}-host`, SIZES.slice(0, 1));
    // Nothing the watcher can press sends an answer: no write ever left this page.
    expect(sent).toEqual([]);
  });
}
