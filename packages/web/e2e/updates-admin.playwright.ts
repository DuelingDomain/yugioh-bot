import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildProofPage } from "./proof-build.js";

// Walks the admin Updates view on the real console: list, draft editor, publish, the email box in each state. The release
// routes are answered by an in-memory server (updates-admin-browser.tsx). Saves screenshots at four screen sizes.
// Run: node --import tsx packages/web/e2e/updates-admin.playwright.ts
// Environment: UPDATES_ADMIN_OUT (default /tmp/yugioh-updates-admin), CHROMIUM_PATH, PLAYWRIGHT_MODULE.
const out = resolve(process.env.UPDATES_ADMIN_OUT ?? "/tmp/yugioh-updates-admin");
await mkdir(out, { recursive: true });
const html = await buildProofPage(out, "updates-admin-browser.tsx", "Admin updates", {}, { viewportMeta: true });
const require = createRequire(import.meta.url);
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE ?? require.resolve("playwright")).href);
const chromium = playwright.chromium ?? playwright.default.chromium;
const browser = await chromium.launch({
  headless: true, executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--allow-file-access-from-files"],
});

const sizes = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "2560x1440", width: 2560, height: 1440 },
  { name: "1366x768", width: 1366, height: 768 },
  { name: "390x844", width: 390, height: 844, phone: true },
];
const results: string[] = [];

async function open(size: (typeof sizes)[number], query = "") {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, hasTouch: !!size.phone, isMobile: !!size.phone,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  await page.goto(`${pathToFileURL(html).href}${query ? `?${query}` : ""}#updates`);
  await page.getByRole("table", { name: "Releases" }).waitFor({ state: "visible" });
  return { page, context, errors };
}

for (const size of sizes) {
  const { page, context, errors } = await open(size);
  const shot = (name: string) => page.screenshot({ path: resolve(out, `${name}-${size.name}.png`) });
  await page.waitForTimeout(300);
  await shot("list");
  // The header row is hidden on a phone, so count the release rows by their version.
  assert.equal(await page.getByRole("row", { name: /v0\.2\.\d/ }).count(), 3, "three releases");

  // A minor draft: the email choice is off and disabled, with a hint.
  await page.getByRole("row", { name: /v0\.2\.3/ }).click();
  const sheet = page.getByRole("dialog", { name: "Release v0.2.3" });
  await sheet.waitFor({ state: "visible" });
  await page.waitForTimeout(400);
  await shot("draft");
  const auto = sheet.getByLabel("Email it automatically");
  assert.equal(await auto.isChecked(), false, "a minor release does not email by itself");
  assert.equal(await auto.isDisabled(), true, "the email choice is locked for a minor release");
  assert.match(await sheet.innerText(), /Off for a minor update/);
  // A major draft: on by default. Publish needs the draft saved first.
  await sheet.getByLabel("Major update").check();
  assert.equal(await auto.isChecked(), true, "a major release emails by default");
  assert.equal(await sheet.getByRole("button", { name: "Publish v0.2.3" }).isDisabled(), true, "unsaved edits block Publish");
  await sheet.getByRole("button", { name: "Save draft" }).click();
  await page.getByText("Draft saved.").waitFor({ state: "visible" });
  await sheet.getByRole("button", { name: "Publish v0.2.3" }).scrollIntoViewIfNeeded();
  await shot("draft-publish");
  await sheet.getByRole("button", { name: "Publish v0.2.3" }).click();
  const confirmPublish = page.getByRole("alertdialog", { name: "Publish v0.2.3 now?" });
  await confirmPublish.waitFor({ state: "visible" });
  await page.waitForTimeout(350);
  await shot("confirm-publish");
  await page.keyboard.press("Escape");
  await confirmPublish.waitFor({ state: "detached" });
  assert.equal(await sheet.isVisible(), true, "Escape closes only the confirm dialog");
  await sheet.getByRole("button", { name: "Close" }).click();
  await sheet.waitFor({ state: "detached" });

  // A published release with no email yet: preview, confirm, progress, locked.
  await page.getByRole("row", { name: /v0\.2\.2/ }).click();
  const notes = page.getByRole("dialog", { name: "Release v0.2.2" });
  await notes.waitFor({ state: "visible" });
  await page.waitForTimeout(400);
  await notes.getByRole("button", { name: "Preview" }).scrollIntoViewIfNeeded();
  await shot("email-start");
  await notes.getByRole("button", { name: "Preview" }).click();
  await notes.getByText("people get this email").waitFor({ state: "visible" });
  await notes.getByRole("button", { name: "Send email" }).scrollIntoViewIfNeeded();
  await shot("email-preview");
  await notes.getByRole("button", { name: "Send email" }).click();
  const confirmSend = page.getByRole("alertdialog", { name: "Email v0.2.2 once to 1,240 people" });
  await confirmSend.waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Cancel", "focus starts on Cancel");
  await page.waitForTimeout(350);
  await shot("confirm-send");
  await confirmSend.getByRole("button", { name: "Send to 1,240" }).click();
  await notes.getByText("Queued").waitFor({ state: "visible" });
  assert.equal(await notes.getByRole("button", { name: "Send email" }).count(), 0, "no second send while it runs");
  await notes.getByText("Sending", { exact: true }).waitFor({ state: "visible", timeout: 7000 });
  await shot("email-sending");
  await notes.getByText(/Sent on /).waitFor({ state: "visible", timeout: 7000 });
  assert.equal(await notes.getByRole("button", { name: /Send email|Preview/ }).count(), 0, "a sent release has no send button");
  await shot("email-done");
  await page.keyboard.press("Escape");
  await notes.waitFor({ state: "detached" });

  // An older release that was sent already stays locked.
  await page.getByRole("row", { name: /v0\.2\.1/ }).click();
  const old = page.getByRole("dialog", { name: "Release v0.2.1" });
  await old.waitFor({ state: "visible" });
  await old.getByText(/Sent on 24 October 2026/).waitFor({ state: "visible" });
  assert.equal(await old.getByRole("button", { name: /Send email|Preview/ }).count(), 0);
  await page.waitForTimeout(300);
  await shot("email-locked");

  // A new release: the form checks the version and the highlights.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "New release" }).click();
  const fresh = page.getByRole("dialog", { name: "New release" });
  await fresh.waitFor({ state: "visible" });
  await fresh.getByRole("button", { name: "Make draft" }).click();
  await fresh.getByText("Use three numbers with dots").waitFor({ state: "visible" });
  await fresh.getByLabel("Version").fill("0.2.4");
  assert.equal(await fresh.getByLabel("Title").inputValue(), "Dueling Domain v0.2.4", "the title follows the version");
  await page.waitForTimeout(300);
  await shot("new-errors");
  assert.deepEqual(errors, [], `${size.name}: no page errors`);
  await context.close();
  results.push(`ok  ${size.name}: list, editor, publish, preview, send, progress, locked`);
}

// Email not set up: the list says so, and the sheet names the missing settings.
{
  const size = sizes[0];
  const { page, context } = await open(size, "notconf=1");
  await page.getByText("Email is not set up").first().waitFor({ state: "visible" });
  await page.getByRole("row", { name: /v0\.2\.2/ }).click();
  const sheet = page.getByRole("dialog", { name: "Release v0.2.2" });
  await sheet.getByText("MAIL_HOST").waitFor({ state: "visible" });
  assert.equal(await sheet.getByRole("button", { name: /Send email|Preview/ }).count(), 0, "nothing can be sent");
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(out, `not-configured-${size.name}.png`) });
  await context.close();
  results.push("ok  email not set up");
}

await browser.close();
console.log(results.join("\n"));
console.log(`screenshots: ${out}`);
