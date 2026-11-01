import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { authenticatePlayer } from "../stack/login-auth.mjs";
import { startTwoPlayerTable } from "./remote-table";

const SHOTS = process.env.E2E_SHOTS ?? "";
// A still picture of two cards on a table, served as the camera. Chrome's fake-file camera is not reliable between tests.
const FRAME = process.env.E2E_FAKE_FRAME ? readFileSync(process.env.E2E_FAKE_FRAME).toString("base64") : "";
async function fakeCamera(page: Page) {
  if (!FRAME) return;
  await page.addInitScript(data => {
    const canvas = document.createElement("canvas"); canvas.width = 1280; canvas.height = 720;
    const context = canvas.getContext("2d")!; let image: ImageBitmap | null = null;
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    void createImageBitmap(new Blob([bytes], { type: "image/jpeg" })).then(bitmap => { image = bitmap; });
    const paint = () => { if (image) context.drawImage(image, 0, 0, 1280, 720); else { context.fillStyle = "#2a3a2e"; context.fillRect(0, 0, 1280, 720); } };
    setInterval(paint, 50);
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (!constraints?.video) throw new DOMException("No video", "NotFoundError");
      paint(); return canvas.captureStream(15);
    };
    navigator.mediaDevices.enumerateDevices = async () => [];
  }, FRAME);
}
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

async function soloTable(api: APIRequestContext, seatCount: 2 | 3 | 4) {
  const created = await api.post("/api/remote", { data: { gameId: "ygo", seatCount, solo: true } });
  expect(created.status()).toBe(201); const room = await created.json();
  const ready = await api.post(`/api/remote/${room.slug}/ready`, { data: { ready: true } });
  const started = await api.post(`/api/remote/${room.slug}/start`, { data: {} });
  expect([ready.status(), started.status()], await started.text()).toEqual([200, 200]);
  return room.slug as string;
}

test.describe("remote duels screen, solo", () => {
  test.beforeEach(async ({ context }) => { await authenticatePlayer(context.request, { userId: 101 }, process.env.E2E_AUTH_SECRET!, "http://localhost:3310"); });

  test("1v1 table: phase rail, LP, undo, drawers", async ({ page, context }) => {
    const slug = await soloTable(context.request, 2);
    await page.goto(`/duels/remote/${slug}`);
    await expect(page.getByTestId("remote-table")).toBeVisible();
    await expect(page.getByTestId("remote-table")).toHaveAttribute("data-mode", "1v1");
    await shot(page, "1v1-1920-initial");
    await page.getByTestId("phase-main1").click();
    await expect(page.getByTestId("phase-main1")).toHaveAttribute("aria-current", "step");
    await expect(page.getByTestId("banner")).toBeVisible();
    const lp = page.getByTestId("lp-value-0"); const before = Number((await lp.textContent())?.replace(/\D/g, ""));
    await page.getByRole("button", { name: "E2E Alice minus 500" }).click();
    await expect(lp).toContainText(String(before - 500));
    await expect(page.getByTestId("undo")).toBeEnabled();
    await page.keyboard.press("Control+z");
    await expect(lp).toContainText(String(before));
    await page.getByTestId("log-button").click();
    await expect(page.getByTestId("log-drawer")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("card-button").click();
    await expect(page.getByTestId("inspector")).toBeVisible();
    await page.keyboard.press("Escape");
    await shot(page, "1v1-1920-played");
  });

  test("3-way and 4-way layouts", async ({ page, context }) => {
    for (const [count, mode] of [[3, "3"], [4, "4"]] as const) {
      const slug = await soloTable(context.request, count);
      await page.goto(`/duels/remote/${slug}`);
      await expect(page.getByTestId("remote-table")).toHaveAttribute("data-mode", mode);
      for (let seat = 0; seat < count; seat++) await expect(page.getByTestId(`seat-${seat}`)).toBeVisible();
      await shot(page, `${mode}way-1920`);
    }
  });

  test("click on the live feed opens the card popup, Esc closes it", async ({ page, context }) => {
    test.setTimeout(240_000);
    const slug = await soloTable(context.request, 2);
    await fakeCamera(page);
    await page.goto(`/duels/remote/${slug}`);
    await page.getByTestId("camera-on-feed").click();
    const video = page.locator('[data-testid="feed-0"] video');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    // Click on the first card of the fake camera frame (card centre at 26% x 49% of the picture).
    const at = async (fx: number, fy: number) => video.evaluate((v: HTMLVideoElement, [x, y]) => {
      const r = v.getBoundingClientRect(); const s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
      const w = v.videoWidth * s; const h = v.videoHeight * s;
      return { x: r.left + (r.width - w) / 2 + x * w, y: r.top + (r.height - h) / 2 + y * h };
    }, [fx, fy]);
    await page.getByTestId("feed-0").hover();
    await page.waitForTimeout(500);
    const p = await at(0.338, 0.486); 
    await page.mouse.click(p.x, p.y);
    // The popup is there at once, with the skeleton.
    const popup = page.locator('[data-layer="tray"], [data-layer="card"]').first();
    await expect(popup).toBeVisible({ timeout: 2_000 });
    await shot(page, "live-click-reading");
    await expect(page.getByTestId("card-popover")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("big-art")).toBeVisible();
    await expect(page.getByTestId("popover-name")).toHaveText("Dark Magician");
    await expect(page.getByTestId("pin-inspector")).toBeVisible();
    // The art comes from the card image route. Without a cached file it is fetched from the card site, so give it time and do not fail on it.
    await expect.poll(() => page.getByTestId("big-art").evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 20_000 }).toBeGreaterThan(0).catch(() => undefined);
    const box = await popup.boundingBox(); const view = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(view.width);
    expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(view.height);
    await shot(page, "live-click-popup");
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-layer="tray"], [data-layer="card"]')).toHaveCount(0);
    // A second click, then a press outside the feed closes it too.
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('[data-layer="tray"], [data-layer="card"]').first()).toBeVisible({ timeout: 2_000 });
    await page.getByTestId("remote-table").click({ position: { x: 4, y: 4 } });
    await expect(page.locator('[data-layer="tray"], [data-layer="card"]')).toHaveCount(0);
  });

  test("F freezes the frame and outlines the cards", async ({ page, context }) => {
    test.setTimeout(240_000);
    const slug = await soloTable(context.request, 2);
    await fakeCamera(page);
    await page.goto(`/duels/remote/${slug}`);
    await page.getByTestId("camera-on-feed").click();
    const video = page.locator('[data-testid="feed-0"] video');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    await page.getByTestId("feed-box-0").focus();
    await page.keyboard.press("f");
    await expect(page.getByTestId("quad").first()).toBeVisible({ timeout: 90_000 });
    expect(await page.getByTestId("quad").count()).toBeGreaterThanOrEqual(1);
    await shot(page, "freeze-outlines");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("frozen-frame")).toHaveCount(0);
  });

  for (const [width, height, label] of [[1366, 768, "1366"], [390, 844, "390"]] as const) {
    test(`card popup stays inside the window at ${label}`, async ({ page, context }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width, height });
      const slug = await soloTable(context.request, 2);
      await fakeCamera(page);
      await page.goto(`/duels/remote/${slug}`);
      await page.getByTestId("camera-on-feed").click();
      const video = page.locator('[data-testid="feed-0"] video');
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
      const p = await video.evaluate((v: HTMLVideoElement) => {
        const r = v.getBoundingClientRect(); const s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
        const w = v.videoWidth * s; const h = v.videoHeight * s;
        return { x: r.left + (r.width - w) / 2 + 0.338 * w, y: r.top + (r.height - h) / 2 + 0.486 * h };
      });
      await page.mouse.move(p.x, p.y); await page.waitForTimeout(500);
      await page.mouse.click(p.x, p.y);
      await expect(page.getByTestId("card-popover")).toBeVisible({ timeout: 90_000 });
      await expect.poll(() => page.getByTestId("big-art").evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 20_000 }).toBeGreaterThan(0).catch(() => undefined);
      const box = await page.getByTestId("card-popover").boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
      await shot(page, `live-click-popup-${label}`);
      await page.keyboard.press("Escape");
    });
  }
});

test.describe("remote duels screen, two players on LiveKit", () => {
  test("Bob reads Alice's feed, both see it, and the other player can undo", async ({ browser }) => {
    test.setTimeout(300_000);
    const alice = await browser.newContext(); const bob = await browser.newContext();
    try {
      for (const [context, userId] of [[alice, 101], [bob, 102]] as const) await authenticatePlayer(context.request, { userId }, process.env.E2E_AUTH_SECRET!, "http://localhost:3310");
      const slug = await startTwoPlayerTable(alice.request, bob.request);
      const a = await alice.newPage(); const b = await bob.newPage();
      // Only Alice's camera shows cards. Bob's page needs a camera to join the table, nothing more.
      await fakeCamera(a); await fakeCamera(b);
      await Promise.all([a.goto(`/duels/remote/${slug}`), b.goto(`/duels/remote/${slug}`)]);
      for (const page of [a, b]) { await expect(page.getByTestId("remote-table")).toBeVisible(); await page.getByTestId("camera-on-feed").click(); }
      const video = b.locator('[data-testid="feed-0"] video');
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 40_000 }).toBeGreaterThan(0);
      await shot(b, "two-players-bob");
      await b.getByTestId("feed-0").hover(); await b.waitForTimeout(500);
      const p = await video.evaluate((v: HTMLVideoElement) => {
        const r = v.getBoundingClientRect(); const sc = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
        const w = v.videoWidth * sc; const h = v.videoHeight * sc;
        return { x: r.left + (r.width - w) / 2 + 0.338 * w, y: r.top + (r.height - h) / 2 + 0.486 * h };
      });
      await b.mouse.click(p.x, p.y);
      await expect(b.getByTestId("card-popover")).toBeVisible({ timeout: 90_000 });
      await expect(b.getByTestId("popover-name")).toHaveText("Dark Magician");
      await b.keyboard.press("Escape");
      // Alice sees the result in her log: the identification travelled through the table, not only Bob's screen.
      await a.getByTestId("log-button").click();
      await expect(a.getByTestId("log-list")).toContainText("Dark Magician identified on E2E Alice", { timeout: 20_000 });
      await a.keyboard.press("Escape");
      await shot(a, "two-players-alice-log");
      // Alice changes her LP. Bob undoes it from his own screen.
      const lp = (page: Page) => page.getByTestId("lp-value-0");
      const before = Number((await lp(b).textContent())?.replace(/\D/g, ""));
      await a.getByRole("button", { name: "E2E Alice minus 500" }).click();
      await expect(lp(a)).toContainText(String(before - 500));
      await expect(lp(b)).toContainText(String(before - 500));
      await expect(b.getByTestId("undo")).toBeEnabled();
      await b.getByTestId("undo").click();
      await expect(lp(a)).toContainText(String(before));
      await expect(lp(b)).toContainText(String(before));
      await shot(b, "two-players-undo");
    } finally { await Promise.allSettled([alice.close(), bob.close()]); }
  });

  test("two-player table fits every screen size, with the health chip in reach", async ({ browser }) => {
    test.setTimeout(240_000);
    const alice = await browser.newContext(); const bob = await browser.newContext();
    try {
      for (const [context, userId] of [[alice, 101], [bob, 102]] as const) await authenticatePlayer(context.request, { userId }, process.env.E2E_AUTH_SECRET!, "http://localhost:3310");
      const slug = await startTwoPlayerTable(alice.request, bob.request);
      const a = await alice.newPage(); const b = await bob.newPage();
      await fakeCamera(a); await fakeCamera(b);
      await Promise.all([a.goto(`/duels/remote/${slug}`), b.goto(`/duels/remote/${slug}`)]);
      for (const page of [a, b]) { await expect(page.getByTestId("remote-table")).toBeVisible(); await page.getByTestId("camera-on-feed").click(); }
      await expect.poll(() => b.locator('[data-testid="feed-0"] video').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 40_000 }).toBeGreaterThan(0);
      for (const [w, h] of [[1920, 1080], [2560, 1440], [1366, 768], [390, 844]] as const) {
        await b.setViewportSize({ width: w, height: h }); await b.waitForTimeout(600);
        await expect(b.getByTestId("health-chip")).toBeVisible();
        const box = await b.getByTestId("health-chip").boundingBox();
        expect(box && box.height >= 24 && box.x >= 0 && box.x + box.width <= w).toBe(true);
        expect(await b.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await shot(b, `two-players-${w}x${h}`);
        if (w === 390) { await b.getByTestId("health-chip").click(); await expect(b.getByTestId("health-popover")).toBeVisible(); await shot(b, "two-players-390-health"); await b.keyboard.press("Escape"); }
      }
    } finally { await Promise.allSettled([alice.close(), bob.close()]); }
  });
});
