import { test, expect, type Page } from "@playwright/test";
import { authFile } from "../helpers/players";

test.use({ storageState: authFile("p1") });

const description = "The card selection stays open after I make a choice";
const expected = "The selection should close after my choice";

async function openReport(page: Page) {
  await page.goto("/decks");
  await page.getByRole("button", { name: "Report bug", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Report a bug" });
  await dialog.getByLabel(/What went wrong/).fill(description);
  await dialog.getByLabel(/What did you expect/).fill(expected);
  return dialog;
}

test("signing in in another tab keeps the report and allows sending it afterwards", async ({ page, context }) => {
  const dialog = await openReport(page);
  await page.request.post("/api/test-auth/sign-out");
  await dialog.getByRole("button", { name: "Send report", exact: true }).click();
  const signIn = dialog.getByRole("link", { name: "Sign in again", exact: true });
  await expect(signIn).toBeVisible();
  // The isolated stack uses signed test cookies, not live Clerk credentials.
  await context.route("**/sign-in?redirect_url=**", route => route.fulfill({ contentType: "text/html", body: "<h1>Sign in again</h1>" }));
  const popup = page.waitForEvent("popup");
  await signIn.click();
  const signInPage = await popup;
  await expect(signInPage).toHaveURL(/\/sign-in\?redirect_url=%2Fdecks$/);
  const restored = await page.request.post("/api/test-auth/session", { data: { userId: 101, secret: process.env.E2E_AUTH_SECRET } });
  expect(restored.ok()).toBe(true);
  await signInPage.close();
  await expect(dialog.getByLabel(/What went wrong/)).toHaveValue(description);
  await expect(dialog.getByLabel(/What did you expect/)).toHaveValue(expected);
  // Clerk may force a navigation when it deactivates a rejected session.
  await page.reload();
  await page.getByRole("button", { name: "Report bug", exact: true }).click();
  await expect(dialog.getByLabel(/What went wrong/)).toHaveValue(description);
  await expect(dialog.getByLabel(/What did you expect/)).toHaveValue(expected);
  await dialog.getByRole("button", { name: "Send report", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Saved");
  expect(await page.evaluate(() => sessionStorage.getItem("bug-report-auth-draft"))).toBeNull();
});

test("a network failure keeps the report and can be retried", async ({ page }) => {
  const dialog = await openReport(page);
  await page.route("**/api/bug-reports", route => route.abort("internetdisconnected"));
  await dialog.getByRole("button", { name: "Send report", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Network error");
  await expect(dialog.getByRole("link", { name: "Sign in again", exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel(/What went wrong/)).toHaveValue(description);
  await page.unroute("**/api/bug-reports");
  await dialog.getByRole("button", { name: "Send report", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Saved");
});

for (const [status, message] of [[403, "permission"], [503, "server"]] as const) {
  test(`HTTP ${status} does not ask the player to sign in`, async ({ page }) => {
    const dialog = await openReport(page);
    await page.route("**/api/bug-reports", route => route.fulfill({ status, json: { error: "test failure" } }));
    await dialog.getByRole("button", { name: "Send report", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(message);
    await expect(dialog.getByRole("link", { name: "Sign in again", exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel(/What went wrong/)).toHaveValue(description);
  });
}

test("an auth handshake redirect does not forward the report to Clerk", async ({ page, context }) => {
  const dialog = await openReport(page);
  const forwarded: string[] = [];
  await context.route("https://clerk.example.test/**", route => {
    forwarded.push(route.request().url());
    return route.fulfill({ json: {} });
  });
  await page.route("**/api/bug-reports", route => route.fulfill({ status: 307, headers: { location: "https://clerk.example.test/v1/client/handshake" } }));
  await dialog.getByRole("button", { name: "Send report", exact: true }).click();
  await expect(dialog.getByRole("link", { name: "Sign in again", exact: true })).toBeVisible();
  expect(forwarded).toEqual([]);
  await expect(dialog.getByLabel(/What went wrong/)).toHaveValue(description);
});
