import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Checks the pinned card drawer of the shells without the HUD (3D mode and the phone layout) on the REAL room, /dev/table-preview/classic/room:
//  - Esc closes the pin and does NOT answer the chain response behind it; the next Esc answers (so the check can fail);
//  - a new prompt for you lets the pin go;
//  - the board sync: new stats show in the drawer, and a card that leaves its zone or turns face-down lets the pin go;
//  - a tap outside the drawer closes the pin on a phone.
// Playwright is external to the repo. Set PLAYWRIGHT_MODULE to an installed index.mjs (without it, `playwright` is resolved from node_modules).
// Start the page first:  cd packages/web && DUEL_FX_LAB=1 npx next dev -p 3616 --webpack
// Run: PREVIEW_URL=http://localhost:3616 node --import tsx packages/web/e2e/drawer-pin.playwright.ts
// Environment: PREVIEW_URL, DRAWER_PIN_OUT (default /tmp/yugioh-drawer-pin), CHROMIUM_PATH.
const base = (process.env.PREVIEW_URL ?? "http://localhost:3616").replace(/\/$/, "");
const out = resolve(process.env.DRAWER_PIN_OUT ?? "/tmp/yugioh-drawer-pin");
await mkdir(out, { recursive: true });
const require = createRequire(import.meta.url);
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE ?? require.resolve("playwright")).href);
const chromium = playwright.chromium ?? playwright.default.chromium;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});

type Page = Awaited<ReturnType<typeof browser.newPage>>;
const results: Record<string, unknown> = {};

/** The room on a fixture, in the shell without the HUD: 3D mode on a wide screen, or the phone layout. */
async function open(kind: "3d" | "phone", state = "chain") {
  const phone = kind === "phone";
  const context = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1920, height: 1080 },
    hasTouch: phone, isMobile: phone, deviceScaleFactor: phone ? 2 : 1, reducedMotion: "reduce",
  });
  await context.addInitScript(`window.__name = (fn) => fn; try { localStorage.setItem("yugidraft.duelBoardView.v1", JSON.stringify({ v: 1, mode: "3d", tilt: 0.5 })); } catch {}`);
  const page = await context.newPage();
  /** What the room sent to the duel API (the preview records it): an answer to the prompt shows here. */
  const writes = () => page.evaluate(() => (window as unknown as { __previewWrites?: string[] }).__previewWrites ?? []);
  const errors: string[] = [];
  page.on("pageerror", (error: Error) => { errors.push(error.message); });
  await page.goto(`${base}/dev/table-preview/classic/room?state=${state}${phone ? "" : "&view=3d"}`, { timeout: 180_000 });
  await page.locator("[data-zones]").first().waitFor({ state: "visible", timeout: 120_000 });
  await page.waitForTimeout(1500);
  return { context, page, writes, errors };
}

const drawer = (page: Page) => page.evaluate(() => {
  const aside = document.querySelector<HTMLElement>('[data-testid="hover-preview"]');
  return aside ? { open: aside.dataset.open === "true", pinned: aside.dataset.pinned === "true", text: aside.textContent ?? "", name: aside.querySelector("h3")?.textContent ?? "" } : null;
});

/** A face-up card of the field that a click on pins. 3D: your own lowest monster (the chain prompt offers it no action, so no menu opens). Phone: the prompt panel covers your rows, so any face-up zone card that nothing covers. */
async function ownMonster(page: Page, phone: boolean) {
  const points = await page.evaluate((onPhone: boolean) => [...document.querySelectorAll<HTMLElement>('[data-zones][data-occupied="true"] button')]
    .filter((node) => {
      const label = node.getAttribute("aria-label") ?? "";
      if (node.closest("[data-hand-card]") || node.closest("[data-zones]")?.querySelector("[data-card-art]") == null) return false;
      return onPhone ? /(monster|spell and trap) zone/i.test(label) : /monster zone/i.test(label) && !/^opponent/i.test(label);
    })
    .map((node) => {
      const box = node.getBoundingClientRect();
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, w: box.width, free: hit != null && node.contains(hit) };
    })
    .filter((point) => point.w > 20 && (!onPhone || point.free)), phone);
  assert.ok(points.length > 0, "a face-up card on the field that nothing covers");
  // 3D: your own row is the lower one on the board. Phone: the first free card.
  return phone ? points[0] : points.reduce((low, point) => (point.y > low.y ? point : low));
}

const pin = async (page: Page, phone: boolean) => {
  const card = await ownMonster(page, phone);
  if (phone) await page.touchscreen.tap(card.x, card.y);
  else { await page.mouse.move(card.x, card.y, { steps: 3 }); await page.mouse.click(card.x, card.y); }
  await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-testid="hover-preview"]')?.dataset.pinned === "true", undefined, { timeout: 10_000 });
  if (!phone) await page.mouse.move(960, 500, { steps: 1 });
  await page.waitForTimeout(500);
  return card;
};
const closed = (page: Page) => page.waitForFunction(() => {
  const aside = document.querySelector<HTMLElement>('[data-testid="hover-preview"]');
  return aside == null || aside.dataset.open !== "true" || aside.dataset.pinned !== "true";
}, undefined, { timeout: 5000 });
const edit = (page: Page, body: string) => page.evaluate((source: string) => (window as unknown as { __previewEditRoom(fn: unknown): void }).__previewEditRoom(new Function("room", source)), body);
/** Edit the pinned card's own entry in your monster row, found by its name. */
const editPinned = (page: Page, name: string, change: string) => edit(page, `
  const row = room.engine.seats[0].monsters;
  const index = row.findIndex((card) => card && card.name === ${JSON.stringify(name)});
  if (index < 0) throw new Error("pinned card not found");
  const card = row[index];
  ${change}
`);

try {
  // 1. Esc: the pin closes, the chain response stays unanswered; with no pin the next Esc answers it.
  {
    const { context, page, writes, errors } = await open("3d");
    await pin(page, false);
    const before = await drawer(page);
    assert.ok(before?.pinned && before.open, "the card is pinned");
    await page.keyboard.press("Escape");
    await closed(page);
    await page.waitForTimeout(600);
    assert.deepEqual(await writes(), [], "Esc with a pin only closes the drawer: no answer was sent");
    assert.ok(await page.getByText("Respond to the chain?").count() > 0, "the chain response prompt is still on screen");
    await page.screenshot({ path: resolve(out, "1-esc-keeps-prompt.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
    const sent = await writes();
    assert.ok(sent.length > 0, "with no pin, Esc answers the prompt (the check is sensitive)");
    assert.deepEqual(errors, []);
    results.esc = { writesAfterFirstEsc: 0, writesAfterSecondEsc: sent };
    await context.close();
  }
  // 2. A new prompt for you lets the pin go.
  {
    const { context, page, errors } = await open("3d");
    await pin(page, false);
    await edit(page, `room.engine.prompt = { ...room.engine.prompt, id: "preview-chain-next" };`);
    await closed(page);
    assert.deepEqual(errors, []);
    results.newPrompt = "pin cleared";
    await context.close();
  }
  // 3. The board sync: new stats show; a card that leaves, or turns face-down, lets the pin go.
  {
    const { context, page, errors } = await open("3d");
    await pin(page, false);
    const name = (await drawer(page))!.name;
    await editPinned(page, name, `card.attack = 4321;`);
    await page.waitForFunction(() => /4321/.test(document.querySelector('[data-testid="hover-preview"]')?.textContent ?? ""), undefined, { timeout: 5000 });
    assert.equal((await drawer(page))?.pinned, true, "a card that stays keeps its pin and takes the new ATK");
    await editPinned(page, name, `row[index] = { ...card, code: null, name: null, description: null };`);
    await closed(page);
    results.syncStats = "4321 shown";
    results.syncFaceDown = "pin cleared";
    await page.reload();
    await page.locator("[data-zones]").first().waitFor({ state: "visible" });
    await page.waitForTimeout(1500);
    await pin(page, false);
    const again = (await drawer(page))!.name;
    await editPinned(page, again, `row[index] = null;`);
    await closed(page);
    results.syncLeft = "pin cleared";
    assert.deepEqual(errors, []);
    await context.close();
  }
  // 4. A phone: a tap outside the drawer closes the pin; the new prompt clears it there too.
  {
    const { context, page, errors } = await open("phone");
    await pin(page, true);
    await page.screenshot({ path: resolve(out, "4-phone-pinned.png") });
    await edit(page, `room.engine.prompt = { ...room.engine.prompt, id: "preview-chain-next" };`);
    await closed(page);
    results.phoneNewPrompt = "pin cleared";
    await pin(page, true);
    // Outside the drawer: the strip to its right (the drawer is 88% of the width) or, failing that, the header row.
    const gap = await page.evaluate(() => {
      const box = document.querySelector('[data-testid="hover-preview"]')!.getBoundingClientRect();
      for (const y of [window.innerHeight * 0.5, window.innerHeight * 0.3, window.innerHeight * 0.7]) {
        const x = (box.right + window.innerWidth) / 2;
        const hit = document.elementFromPoint(x, y);
        if (hit && !hit.closest("[data-zones], [data-hud-keep], [role='dialog'], [role='menu']")) return { x, y };
      }
      return null;
    });
    assert.ok(gap, "a spot outside the drawer that is not a card");
    await page.touchscreen.tap(gap.x, gap.y);
    await closed(page);
    results.phoneOutsideTap = "pin cleared";
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
