import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildProofPage } from "./proof-build.js";

// Checks the Updates chip, the one-time reveal and the two panels on the real components, with the releases API answered
// from a fixture, at four screen sizes, and saves screenshots. Playwright is external to the repo: set PLAYWRIGHT_MODULE to
// an installed index.mjs (without it, `playwright` is resolved from node_modules).
// Run: node --import tsx packages/web/e2e/updates-board.playwright.ts
// Environment: UPDATES_BOARD_OUT (default /tmp/yugioh-updates-board), CHROMIUM_PATH, PLAYWRIGHT_MODULE.
const out = resolve(process.env.UPDATES_BOARD_OUT ?? "/tmp/yugioh-updates-board");
await mkdir(out, { recursive: true });
const html = await buildProofPage(out, "updates-board-browser.tsx", "Updates board", {}, { viewportMeta: true });
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
const url = (query: string) => `${pathToFileURL(html).href}?${query}`;
const results: string[] = [];
const ok = (message: string) => results.push(`ok  ${message}`);

async function open(size: (typeof sizes)[number], query: string, reducedMotion: "reduce" | "no-preference" = "no-preference") {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1,
    hasTouch: !!size.phone, isMobile: !!size.phone, reducedMotion,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  await page.goto(url(query));
  return { page, context, errors };
}

for (const size of sizes) {
  // First visit after a new release: the card flies in by itself and the ping clears.
  const { page, context, errors } = await open(size, "");
  const reveal = page.getByRole("dialog", { name: /Dueling Domain v0.2.2/ });
  await reveal.waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: resolve(out, `reveal-${size.name}.png`) });
  assert.deepEqual(await page.evaluate(() => window.__seenPosts), ["0.2.2"], "the reveal marks the release seen once");
  const launcher = page.locator("[data-updates-launcher]");
  assert.equal(await launcher.getAttribute("data-unseen"), "false", "the ping clears when the card shows");
  const box = await reveal.boundingBox();
  assert(box && box.y >= 68, `${size.name}: the card stays below the 68px page bar (top ${box?.y})`);

  // Later: the card flies into the chip.
  await page.getByRole("button", { name: "Later" }).click();
  await reveal.waitFor({ state: "detached", timeout: 3000 });
  await page.screenshot({ path: resolve(out, `dock-${size.name}.png`) });

  // The chip opens the summary, the summary opens all notes, a tab jumps to an older version.
  await launcher.click();
  const compact = page.getByRole("dialog", { name: "Updates" });
  await compact.waitFor({ state: "visible" });
  await page.waitForTimeout(350);
  await page.screenshot({ path: resolve(out, `compact-${size.name}.png`) });
  await page.getByRole("button", { name: "All notes", exact: true }).click();
  await page.getByRole("button", { name: "Shrink to summary" }).waitFor({ state: "visible" });
  await page.waitForTimeout(350);
  await page.screenshot({ path: resolve(out, `expanded-${size.name}.png`) });
  await page.getByRole("button", { name: "v0.2.0" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(out, `expanded-older-${size.name}.png`) });
  assert.equal(await page.locator("details[open]").count() >= 1, true, "a tab opens its older release");
  await page.keyboard.press("Escape"); // expanded -> summary
  await page.getByRole("button", { name: "Shrink to summary" }).waitFor({ state: "detached" });
  await page.keyboard.press("Escape"); // summary -> chip
  await compact.waitFor({ state: "detached" });
  assert.deepEqual(errors, [], `${size.name}: no page errors`);
  ok(`${size.name}: reveal, dock, summary, notes, tabs, Escape`);
  await context.close();
}

{
  // Seen already: no card, no ping. A failed API: no chip at all, the Report bug button stays.
  const size = sizes[0];
  let r = await open(size, "seen=0.2.2");
  await r.page.waitForTimeout(1800);
  assert.equal(await r.page.getByRole("dialog", { name: /Dueling Domain/ }).count(), 0, "no reveal when seen");
  assert.equal(await r.page.locator("[data-updates-launcher]").getAttribute("data-unseen"), "false");
  assert.deepEqual(await r.page.evaluate(() => window.__seenPosts), [], "nothing is posted when it was already seen");
  await r.context.close();
  r = await open(size, "api=fail");
  await r.page.waitForTimeout(1500);
  assert.equal(await r.page.locator("[data-updates-launcher]").count(), 0, "no chip when the API fails");
  assert.equal(await r.page.locator("[data-bug-fab]").count(), 1, "the Report bug button stays");
  await r.context.close();
  // Another dialog is open: the card does not pop up, the ping shows.
  r = await open(size, "modal=1");
  await r.page.waitForTimeout(2000);
  assert.equal(await r.page.getByRole("dialog", { name: /Dueling Domain/ }).count(), 0, "no reveal over a modal");
  assert.equal(await r.page.locator("[data-updates-launcher]").getAttribute("data-unseen"), "true", "the ping shows");
  await r.context.close();
  // A sticky bottom bar lifts the chip with the Report bug button.
  r = await open(size, "seen=0.2.2&bar=1");
  await r.page.waitForTimeout(500);
  const chip = await r.page.locator("[data-updates-launcher]").boundingBox();
  const bar = await r.page.locator("div[style*='height: 64px']").boundingBox();
  assert(chip && bar && chip.y + chip.height <= bar.y, "the chip sits above the bottom bar");
  await r.page.screenshot({ path: resolve(out, "lifted-1920x1080.png") });
  await r.context.close();
  // Reduced motion: the card still shows, with no running animation of the card.
  r = await open(size, "", "reduce");
  await r.page.getByRole("dialog", { name: /Dueling Domain v0.2.2/ }).waitFor({ state: "visible", timeout: 5000 });
  await r.page.waitForTimeout(400);
  const running = await r.page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && (a.effect as KeyframeEffect | null)?.pseudoElement == null).length);
  assert.equal(running, 0, "reduced motion: nothing animates on the card");
  await r.context.close();
  ok("seen, API failure, modal, lifted dock, reduced motion");
}

await browser.close();
console.log(results.join("\n"));
console.log(`screenshots: ${out}`);
