import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { authFile } from "../helpers/players";
import { FLOOR, seedAdminFloor, touchAdminFloor } from "../helpers/admin-floor";

// Admin console (/admin). Needs the stack started with E2E_ADMIN_CONSOLE=1 and E2E_OWNER_USER_IDS=101
// (p1 is the owner). The fetch stub answers Clerk (waitlist), Sentry and PostHog, so nothing leaves the machine.
//   E2E_ADMIN_CONSOLE=1 E2E_OWNER_USER_IDS=101 E2E_SLOT=N E2E_WORKERS=1 npx playwright test admin-console
// E2E_ADMIN_SCREENS_DIR=<dir> also saves a screenshot of every view at four screen sizes.
test.skip(process.env.E2E_ADMIN_CONSOLE !== "1" || process.env.E2E_OWNER_USER_IDS !== "101", "set E2E_ADMIN_CONSOLE=1 and E2E_OWNER_USER_IDS=101");
test.describe.configure({ mode: "serial" });

const VIEWS = ["Overview", "People", "Duels", "Waitlist", "Health", "Insights"] as const;
const menu = (page: Page) => page.getByRole("complementary", { name: "Admin navigation" });
const view = (page: Page, name: string) => page.getByRole("region", { name });

test.beforeAll(() => { seedAdminFloor(); });
test.beforeEach(() => { touchAdminFloor(); });

test("a non-owner gets 404 on the page and every admin API", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authFile("p2") });
  try {
    const page = await context.newPage();
    const response = await page.goto("/admin");
    expect(response?.status()).toBe(404);
    for (const path of ["online", "waitlist", "live", "people/201"]) {
      expect((await context.request.get(`/api/admin/console/${path}`)).status()).toBe(404);
    }
  } finally { await context.close(); }
});

test("Overview: four large numbers, what needs attention, and who is online and playing now", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authFile("p1") });
  try {
    const page = await context.newPage();
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("people online");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("3 duels live");
    const overview = view(page, "Overview");
    for (const label of ["Online now", "Live now", "Duels today", "Sign-ups, 7 days"]) await expect(overview.getByText(label, { exact: true })).toBeVisible();
    // A Sentry issue first seen 5 h ago is new; the stubbed waitlist has two pending people.
    await expect(overview).toContainText("New error: TypeError: cannot read properties of undefined (reading 'seat')");
    await expect(overview).toContainText("2 people wait for approval");
    await expect(overview.getByRole("button", { name: /kaibaCorp/ })).toBeVisible();
    await expect(overview.getByRole("link", { name: "Watch" }).first()).toHaveAttribute("href", /^\/duels\/e2e-adm-/);
    // Every view is in the menu with its live count.
    await expect(menu(page).getByRole("button")).toHaveCount(VIEWS.length + 1);
    await expect(menu(page).getByRole("button", { name: /^Waitlist/ })).toContainText("2");
    await expect(menu(page).getByRole("button", { name: /^Duels/ })).toContainText("3 + 1");
  } finally { await context.close(); }
});

test("keys 1 to 6 switch views, / filters people, and each view has its own link", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authFile("p1") });
  try {
    const page = await context.newPage();
    await page.goto("/admin");
    await expect(view(page, "Overview")).toBeVisible();
    await page.keyboard.press("2");
    await expect(page).toHaveURL(/#people$/);
    await expect(view(page, "People")).toBeVisible();
    await page.keyboard.press("5");
    await expect(page).toHaveURL(/#health$/);
    await page.keyboard.press("/");
    await expect(page).toHaveURL(/#people$/);
    await expect(page.getByRole("textbox", { name: "Filter people" })).toBeFocused();
    await page.keyboard.type("lynx");
    await expect(view(page, "People").getByRole("row", { name: /ruby\.lynx/ })).toBeVisible();
    await expect(view(page, "People").getByRole("row", { name: /kaibaCorp/ })).toHaveCount(0);
    await page.goto("/admin#insights");
    await expect(view(page, "Insights")).toBeVisible();
    await menu(page).getByRole("button", { name: /^Duels/ }).click();
    await expect(page).toHaveURL(/#duels$/);
  } finally { await context.close(); }
});

test("People: filter by activity, open a person, see the current duel with Watch and recent activity", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authFile("p1") });
  try {
    const page = await context.newPage();
    await page.goto("/admin#people");
    const people = view(page, "People");
    await people.getByRole("button", { name: /^Drafting/ }).click();
    await expect(people.getByRole("table", { name: "Online people" }).getByRole("row").filter({ hasText: "@" })).toHaveCount(2);
    await people.getByRole("button", { name: /^All/ }).click();
    await people.getByRole("row", { name: /kaibaCorp/ }).click();
    const detail = people.getByRole("complementary", { name: "Details for kaibaCorp" });
    await expect(detail.getByRole("heading", { name: "kaibaCorp" })).toBeVisible();
    await expect(detail).toContainText("4-way duel · Friday Fours");
    await expect(detail).toContainText("Turn 9 · Ranked");
    await expect(detail.getByRole("link", { name: "Watch duel" })).toHaveAttribute("href", `/duels/${FLOOR.fours}`);
    await expect(detail).toContainText("Recent activity");
    await expect(detail.getByRole("link", { name: /Won 3-way duel · Three way/ })).toHaveAttribute("href", "/duels/e2e-adm-end-2/replay");
  } finally { await context.close(); }
});

test("People lists a signed-in player with the page they are on", async ({ browser }) => {
  const carol = await browser.newContext({ storageState: authFile("p3") });
  const alice = await browser.newContext({ storageState: authFile("p1") });
  try {
    // A signed-in page sends the heartbeat on mount (the server accepts one per user every 30 s, so use a player not seen yet).
    await (await carol.newPage()).goto("/decks/new");
    const page = await alice.newPage();
    await page.goto("/admin#people");
    const row = view(page, "People").getByRole("row", { name: /E2E Carol/ });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText("Deck builder");
  } finally { await carol.close(); await alice.close(); }
});

/**
 * A browser time zone where it is about noon now, so every floor duel (started in the last few hours) is "today"
 * whatever the clock of the machine says. Etc/GMT-5 is UTC+5.
 */
function noonZone(): string {
  const offset = 12 - new Date().getUTCHours();
  return offset === 0 ? "Etc/UTC" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
}

test("Duels: live tables with seats and turns, the draft with progress, and a seat opens the person", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authFile("p1") });
  try {
    const page = await context.newPage();
    await page.goto("/admin#duels");
    const duels = view(page, "Duels").getByRole("table", { name: "Live duels" });
    const fours = duels.getByRole("row").filter({ hasText: "Friday Fours" });
    await expect(fours).toContainText("T9");
    for (const name of ["kaibaCorp", "ruby.lynx", "neo_spacian", "valon_x"]) await expect(fours).toContainText(name);
    await expect(fours.getByRole("link", { name: "Watch" })).toHaveAttribute("href", `/duels/${FLOOR.fours}`);
    await expect(duels.getByRole("row").filter({ hasText: "joey's table" })).toContainText("Practice Bot");
    const draft = view(page, "Duels").getByRole("table", { name: "Live drafts" }).getByRole("row").filter({ hasText: "Sunday Cube" });
    await expect(draft).toContainText("Round 2, pick 6");
    await expect(draft).toContainText("21 of 45 picks");
    await expect(draft.getByRole("link", { name: "Open" })).toHaveAttribute("href", `/draft/${FLOOR.draft}`);
    // A seat opens that person.
    await fours.getByRole("button", { name: /ruby\.lynx/ }).click();
    await expect(page).toHaveURL(/#people$/);
    await expect(view(page, "People").getByRole("heading", { name: "ruby.lynx" })).toBeVisible();
  } finally { await context.close(); }
});

test("Duels today: every duel of the local day with result per player, replay or watch, filters, and the Overview link", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authFile("p1"), timezoneId: noonZone() });
  try {
    const page = await context.newPage();
    await page.goto("/admin");
    // The Overview number links to the list.
    await view(page, "Overview").getByRole("link", { name: /Duels today/ }).click();
    await expect(page).toHaveURL(/#duels-today$/);
    const list = view(page, "Duels").getByRole("table", { name: "Duels today" });
    await expect(list).toBeInViewport({ ratio: 0.05 });
    await expect(view(page, "Duels")).toContainText(/Since 00:00 UTC[+\u2212]?\d*/);
    const row = (slug: string) => list.getByRole("row").filter({ has: page.locator(`a[href^="/duels/${slug}"]`) });

    // Tag: partners win together.
    const tag = row(FLOOR.tag);
    await expect(tag).toContainText("Tag");
    await expect(tag).toContainText("ruby.lynx & valon_x won");
    await expect(tag.getByRole("button", { name: /ruby\.lynx/ })).toContainText("Won");
    await expect(tag.getByRole("button", { name: /kaibaCorp/ })).toContainText("Lost");
    await expect(tag).toContainText("17 turns");
    await expect(tag.getByRole("link", { name: "Replay" })).toHaveAttribute("href", `/duels/${FLOOR.tag}/replay`);
    await expect(row("e2e-adm-end-1")).toContainText("mai_v won");
    await expect(row(FLOOR.cut)).toContainText("Interrupted");
    await expect(row(FLOOR.draw)).toContainText("Draw");
    await expect(row(FLOOR.draw).getByRole("button", { name: /joeyw/ })).toContainText("Draw");
    // A duel that still runs is in the list with Watch, not Replay.
    const live = row(FLOOR.fours);
    await expect(live).toContainText("Live");
    await expect(live.getByRole("link", { name: "Watch" })).toHaveAttribute("href", `/duels/${FLOOR.fours}`);
    await expect(live.getByRole("link", { name: "Replay" })).toHaveCount(0);

    // Filters: Multi hides the 1v1 duels, Ranked keeps only ranked ones.
    const filters = view(page, "Duels").getByRole("group", { name: "Filter duels of today" });
    await filters.getByRole("button", { name: /^Multi/ }).click();
    await expect(row(FLOOR.tag)).toBeVisible();
    await expect(row(FLOOR.draw)).toHaveCount(0);
    await filters.getByRole("button", { name: /^Ranked/ }).click();
    await expect(row(FLOOR.fours)).toBeVisible();
    await expect(row(FLOOR.tag)).toHaveCount(0);
    await filters.getByRole("button", { name: /^All/ }).click();

    // A player opens the person panel.
    await tag.getByRole("button", { name: /valon_x/ }).click();
    await expect(page).toHaveURL(/#people$/);
    await expect(view(page, "People").getByRole("heading", { name: "valon_x" })).toBeVisible();
  } finally { await context.close(); }
});

test("Health and Insights: services, disk, version, trends, Sentry errors and PostHog pages", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authFile("p1") });
  try {
    const page = await context.newPage();
    await page.goto("/admin#health");
    const health = view(page, "Health");
    await expect(health.getByRole("table", { name: "Services" })).toContainText("Web");
    await expect(health).toContainText("Disk");
    await expect(health).toContainText("e2e0000");
    await page.goto("/admin#insights");
    const insights = view(page, "Insights");
    await expect(insights).toContainText("Active users");
    await expect(insights.getByRole("link", { name: "Error: websocket closed before ready" })).toBeVisible();
    await expect(insights).toContainText("/duels/[slug]");
    await expect(insights).toContainText("1,840");
  } finally { await context.close(); }
});

const SIZES = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "2560x1440", width: 2560, height: 1440 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "390x844", width: 390, height: 844 },
] as const;

test("every view fits 1920, 2560, 1366 and 390 wide: menu, icon rail or phone tab bar, no sideways scroll", async ({ browser }) => {
  test.setTimeout(240_000);
  const shots = process.env.E2E_ADMIN_SCREENS_DIR;
  if (shots) mkdirSync(shots, { recursive: true });
  for (const size of SIZES) {
    const phone = size.width <= 760;
    const context = await browser.newContext({ storageState: authFile("p1"), viewport: { width: size.width, height: size.height }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1, timezoneId: noonZone() });
    try {
      const page = await context.newPage();
      touchAdminFloor();
      await page.goto("/admin");
      await expect(page.getByRole("heading", { level: 1 })).toContainText("people online");
      await expect(menu(page)).toBeVisible({ visible: !phone });
      await expect(page.getByRole("navigation", { name: "Admin views" })).toBeVisible({ visible: phone });
      for (const name of VIEWS) {
        if (phone) await page.getByRole("navigation", { name: "Admin views" }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
        else await menu(page).getByRole("button", { name: new RegExp(`^${name}`) }).click();
        await expect(view(page, name)).toBeVisible();
        await page.waitForTimeout(450);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${name} at ${size.name} scrolls sideways`).toBeLessThanOrEqual(0);
        if (shots) await page.screenshot({ path: resolve(shots, `${size.name}-${name.toLowerCase()}.png`) });
        if (name === "Duels") {
          // The Today list under the live tables.
          await page.locator("#duels-today").evaluate((el) => el.scrollIntoView({ block: "start" }));
          await page.waitForTimeout(300);
          const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect(wide, `Duels today at ${size.name} scrolls sideways`).toBeLessThanOrEqual(0);
          if (shots) await page.screenshot({ path: resolve(shots, `${size.name}-duels-today.png`) });
        }
      }
      if (phone) {
        // A person opens in a bottom sheet with a close button.
        await page.getByRole("navigation", { name: "Admin views" }).getByRole("button", { name: /^People/ }).click();
        await view(page, "People").getByRole("row", { name: /kaibaCorp/ }).click();
        const sheet = view(page, "People").getByRole("complementary", { name: "Details for kaibaCorp" });
        await expect(sheet.getByRole("link", { name: "Watch duel" })).toBeInViewport();
        await page.waitForTimeout(400);
        if (shots) await page.screenshot({ path: resolve(shots, `${size.name}-people-sheet.png`) });
        // Focus moves into the sheet, and back to the row when the sheet closes.
        await expect(sheet.getByRole("button", { name: "Close" })).toBeFocused();
        await sheet.getByRole("button", { name: "Close" }).click();
        await expect(sheet.getByRole("link", { name: "Watch duel" })).not.toBeInViewport();
        await expect(view(page, "People").getByRole("row", { name: /kaibaCorp/ })).toBeFocused();
      } else if (size.width < 1240) {
        // Icon-only rail: labels are hidden, counts stay.
        await expect(menu(page).getByText("Overview", { exact: true })).toBeHidden();
      } else {
        await expect(menu(page).getByText("Overview", { exact: true })).toBeVisible();
      }
    } finally { await context.close(); }
  }
});

test("Waitlist: approve and reject ask first, then update the list and the recent decisions", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authFile("p1") });
  try {
    const page = await context.newPage();
    await page.goto("/admin#waitlist");
    const waitlist = view(page, "Waitlist");
    const list = waitlist.getByRole("list", { name: "Pending waitlist" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    // Emails are masked until the owner asks to see them.
    await expect(list).not.toContainText("ada@example.test");
    await waitlist.getByRole("button", { name: "Show emails" }).click();
    await expect(list).toContainText("ada@example.test");

    await waitlist.getByRole("button", { name: "Approve ada@example.test" }).click();
    await expect(waitlist.getByRole("status").filter({ hasText: "Approve ada@example.test?" })).toBeVisible();
    await waitlist.getByRole("button", { name: "Cancel" }).click();
    await expect(list.getByRole("listitem")).toHaveCount(2);

    await waitlist.getByRole("button", { name: "Approve ada@example.test" }).click();
    await waitlist.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(list.getByRole("listitem")).toHaveCount(1, { timeout: 15_000 });
    await expect(menu(page).getByRole("button", { name: /^Waitlist/ })).toContainText("1");
    await expect(waitlist).toContainText("ada@example.test · Invited");

    await waitlist.getByRole("button", { name: "Reject grace@example.test" }).click();
    await waitlist.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(waitlist.getByText(/Nobody is waiting/)).toBeVisible({ timeout: 15_000 });
  } finally { await context.close(); }
});
