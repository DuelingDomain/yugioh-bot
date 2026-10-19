import { test, expect } from "@playwright/test";
import { authFile } from "../helpers/players";

// Admin console (/admin). Needs the stack started with E2E_ADMIN_CONSOLE=1 and E2E_OWNER_USER_IDS=101
// (p1 is the owner). The fetch stub answers Clerk (waitlist), Sentry and PostHog, so nothing leaves the machine.
//   E2E_ADMIN_CONSOLE=1 E2E_OWNER_USER_IDS=101 E2E_SLOT=N E2E_WORKERS=1 npx playwright test admin-console
test.skip(process.env.E2E_ADMIN_CONSOLE !== "1" || process.env.E2E_OWNER_USER_IDS !== "101", "set E2E_ADMIN_CONSOLE=1 and E2E_OWNER_USER_IDS=101");
test.describe.configure({ mode: "serial" });

test("a non-owner gets 404 on the page and the section APIs", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authFile("p2") });
  try {
    const page = await context.newPage();
    const response = await page.goto("/admin");
    expect(response?.status()).toBe(404);
    expect((await context.request.get("/api/admin/console/online")).status()).toBe(404);
    expect((await context.request.get("/api/admin/console/waitlist")).status()).toBe(404);
  } finally { await context.close(); }
});

test("the owner sees the console: summary strip, section nav, every panel", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authFile("p1") });
  try {
    const page = await context.newPage();
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Admin console", level: 1 })).toBeVisible();
    const strip = page.getByRole("list", { name: "Key numbers" });
    await expect(strip.getByRole("link")).toHaveCount(6);
    for (const title of ["Online now", "Waitlist", "Live duels and drafts", "Stats", "Errors", "Usage", "System"]) {
      await expect(page.getByRole("heading", { name: title, level: 2 })).toBeVisible();
    }
    // The strip links to its section, and a deep link scrolls to the panel.
    await strip.getByRole("link", { name: /Pending waitlist/ }).click();
    await expect(page).toHaveURL(/#waitlist$/);
    await page.goto("/admin#system");
    await expect(page.locator("#system")).toBeInViewport();
    // Stubbed Sentry and PostHog answers show up.
    await expect(page.locator("#errors")).toContainText("websocket closed before ready");
    await expect(page.locator("#usage")).toContainText("/duels/[slug]");
    // The system panel shows the version and a live worker heartbeat.
    await expect(page.locator("#system")).toContainText("e2e0000");
    await expect(page.locator("#system")).toContainText(/Alive/);
  } finally { await context.close(); }
});

test("Online now lists a signed-in player with the page they are on", async ({ browser }) => {
  const carol = await browser.newContext({ storageState: authFile("p3") });
  const alice = await browser.newContext({ storageState: authFile("p1") });
  try {
    // A signed-in page sends the heartbeat on mount (the server accepts one per user every 30 s, so use a player not seen yet).
    await (await carol.newPage()).goto("/decks/new");
    const page = await alice.newPage();
    await page.goto("/admin");
    const online = page.locator("#online");
    await expect(online.getByRole("list", { name: "People online" })).toContainText("E2E Carol", { timeout: 30_000 });
    await expect(online).toContainText("Deck builder");
    await expect(online).toContainText("E2E Alice");
  } finally { await carol.close(); await alice.close(); }
});

test("Waitlist: approve and reject ask first, then update the list", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authFile("p1") });
  try {
    const page = await context.newPage();
    await page.goto("/admin");
    const waitlist = page.locator("#waitlist");
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
    await expect(page.getByRole("list", { name: "Key numbers" })).toContainText("1");

    await waitlist.getByRole("button", { name: "Reject grace@example.test" }).click();
    await waitlist.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(waitlist.getByText("Nobody is waiting.")).toBeVisible({ timeout: 15_000 });
  } finally { await context.close(); }
});
