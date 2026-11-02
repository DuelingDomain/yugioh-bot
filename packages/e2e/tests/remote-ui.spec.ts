import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { authenticatePlayer } from "../stack/login-auth.mjs";
import { startTwoPlayerTable } from "./remote-table";

const SHOTS = process.env.E2E_SHOTS ?? "";
// A still picture of two cards on a table, served as the camera. Chrome's fake-file camera is not reliable between tests.
const FRAME = process.env.E2E_FAKE_FRAME ? readFileSync(process.env.E2E_FAKE_FRAME).toString("base64") : "";
async function fakeCamera(page: Page, shape: "16:9" | "4:3" | "" = "") {
  if (!FRAME && !shape) return;
  await page.addInitScript(([data, size]) => {
    const canvas = document.createElement("canvas"); canvas.width = size[0]; canvas.height = size[1];
    const context = canvas.getContext("2d")!; let image: ImageBitmap | null = null;
    if (data) { const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      void createImageBitmap(new Blob([bytes], { type: "image/jpeg" })).then(bitmap => { image = bitmap; }); }
    const paint = () => { if (image) context.drawImage(image, 0, 0, size[0], size[1]); else { context.fillStyle = "#2a3a2e"; context.fillRect(0, 0, size[0], size[1]); } };
    setInterval(paint, 50);
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (!constraints?.video) throw new DOMException("No video", "NotFoundError");
      paint(); return canvas.captureStream(15);
    };
    navigator.mediaDevices.enumerateDevices = async () => [];
  }, [FRAME, shape === "4:3" ? [960, 720] : [1280, 720]] as [string, number[]]);
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
  test.beforeEach(async ({ context }) => { await authenticatePlayer(context.request, { userId: 101 }, process.env.E2E_AUTH_SECRET!, (process.env.E2E_REMOTE_UI_URL ?? "http://localhost:3310")); });

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
    // One outline for the card, never two.
    expect(await page.getByTestId("lock").count()).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-layer="tray"], [data-layer="card"]')).toHaveCount(0);
    // The outline goes with the popup.
    await expect(page.getByTestId("lock")).toHaveCount(0);
    await expect(page.getByTestId("reticle")).toHaveCount(0);
    // A second click, then a press outside the feed closes it too.
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('[data-layer="tray"], [data-layer="card"]').first()).toBeVisible({ timeout: 2_000 });
    await page.getByTestId("remote-table").click({ position: { x: 4, y: 4 } });
    await expect(page.locator('[data-layer="tray"], [data-layer="card"]')).toHaveCount(0);
    await expect(page.getByTestId("lock")).toHaveCount(0);
    // A third read, then the camera goes off: no outline stays on the empty feed.
    await page.mouse.click(p.x, p.y);
    await expect(page.getByTestId("card-popover")).toBeVisible({ timeout: 90_000 });
    // The popup covers the row, so press the button through the page.
    await page.getByTestId("camera-row").getByRole("button", { name: /Camera off/ }).evaluate((b: HTMLElement) => b.click());
    await expect(page.getByTestId("lock")).toHaveCount(0);
    await expect(page.getByTestId("reticle")).toHaveCount(0);
  });

  test("the card popup stays open while the card is read, in the camera-first layout", async ({ page, context }) => {
    test.setTimeout(240_000);
    const slug = await soloTable(context.request, 2);
    await fakeCamera(page);
    await page.goto(`/duels/remote/${slug}`);
    await expect(async () => {
      if (await page.getByTestId("camera-on-feed").count()) await page.getByTestId("camera-on-feed").click();
      await expect(page.locator('[data-testid="feed-0"] video')).toBeVisible({ timeout: 4_000 });
    }).toPass({ timeout: 40_000 });
    const video = page.locator('[data-testid="feed-0"] video');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    // Record every time a popup layer leaves the page, so a self-closing popup is caught even between two polls.
    await page.evaluate(() => {
      const w = window as unknown as { __layerLog: string[] }; w.__layerLog = []; let was = false;
      new MutationObserver(() => { const now = !!document.querySelector('[data-layer="tray"], [data-layer="card"]'); if (was && !now) w.__layerLog.push(`closed at ${Math.round(performance.now())}`); was = now; })
        .observe(document.body, { childList: true, subtree: true });
    });
    await page.getByTestId("feed-0").hover();
    await page.waitForTimeout(500);
    const p = await video.evaluate((v: HTMLVideoElement) => {
      const r = v.getBoundingClientRect(); const s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
      const w = v.videoWidth * s; const h = v.videoHeight * s;
      return { x: r.left + (r.width - w) / 2 + 0.338 * w, y: r.top + (r.height - h) / 2 + 0.486 * h };
    });
    await page.mouse.click(p.x, p.y);
    const popup = page.locator('[data-layer="tray"], [data-layer="card"]').first();
    await expect(popup).toBeVisible({ timeout: 2_000 });
    // It stays open for at least 3 s, even with nothing else happening.
    for (let i = 0; i < 6; i++) { await page.waitForTimeout(500); await expect(popup).toBeVisible(); }
    expect(await page.evaluate(() => (window as unknown as { __layerLog: string[] }).__layerLog)).toEqual([]);
    // And it still ends on the card.
    await expect(page.getByTestId("card-popover")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("popover-name")).toHaveText("Dark Magician");
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("card-popover")).toBeVisible();
  });

  test("a click on the feed of a closed table says so and opens no popup that vanishes", async ({ page, context }) => {
    test.setTimeout(180_000);
    const slug = await soloTable(context.request, 2);
    await fakeCamera(page);
    await page.goto(`/duels/remote/${slug}`);
    await expect(async () => {
      if (await page.getByTestId("camera-on-feed").count()) await page.getByTestId("camera-on-feed").click();
      await expect(page.locator('[data-testid="feed-0"] video')).toBeVisible({ timeout: 4_000 });
    }).toPass({ timeout: 40_000 });
    const video = page.locator('[data-testid="feed-0"] video');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    // The table closes while the page stays open.
    const room = await (await context.request.get(`/api/remote/${slug}`)).json();
    const ended = await context.request.post(`/api/remote/${slug}/actions`, { data: { baseSeq: room.lastSeq, action: { type: "player.concede", actorSeat: 0, idempotencyKey: crypto.randomUUID() } } });
    expect(ended.status(), await ended.text()).toBe(200);
    await expect(page.getByTestId("table-ended")).toContainText("This table has ended.", { timeout: 15_000 });
    await expect(page.getByTestId("new-table")).toHaveAttribute("href", "/duels/remote");
    await page.getByTestId("feed-0").hover();
    await page.waitForTimeout(500);
    const p = await video.evaluate((v: HTMLVideoElement) => {
      const r = v.getBoundingClientRect(); const s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
      const w = v.videoWidth * s; const h = v.videoHeight * s;
      return { x: r.left + (r.width - w) / 2 + 0.338 * w, y: r.top + (r.height - h) / 2 + 0.486 * h };
    });
    await page.mouse.click(p.x, p.y);
    await expect(page.getByText("Cards cannot be read here.")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-layer="tray"], [data-layer="card"]')).toHaveCount(0);
  });

  test("the activity ping keeps a table open and is refused once the table has ended", async ({ context }) => {
    const slug = await soloTable(context.request, 2);
    const ok = await context.request.post(`/api/remote/${slug}/activity`, { data: {} });
    expect(ok.status(), await ok.text()).toBe(200);
    const before = await (await context.request.get(`/api/remote/${slug}`)).json();
    expect(before.lastEventAt).toBe((await ok.json()).lastEventAt);
    await context.request.post(`/api/remote/${slug}/actions`, { data: { baseSeq: before.lastSeq, action: { type: "player.concede", actorSeat: 0, idempotencyKey: crypto.randomUUID() } } });
    const refused = await context.request.post(`/api/remote/${slug}/activity`, { data: {} });
    expect(refused.status()).toBe(409);
  });

  // Camera / field swap: per viewer and per seat, animated, remembered, keyboard reachable, and cards keep their own click.
  for (const [count, mode] of [[2, "1v1"], [3, "3"]] as const) {
    test(`the field and the camera swap places, per seat, and the choice is remembered: ${mode}`, async ({ page, context }) => {
      test.setTimeout(120_000);
      const slug = await soloTable(context.request, count);
      const path = `/api/remote/${slug}`;
      const room = await (await context.request.get(path)).json();
      const placed = await context.request.post(`${path}/actions`, { data: { baseSeq: room.lastSeq, action: { type: "twin.place", actorSeat: 0, seat: 0, zone: "monster", idempotencyKey: crypto.randomUUID(),
        card: { ref: "dm", cardId: 46986414, name: "Dark Magician", slot: 1, faceUp: true, position: "attack" } } } });
      expect(placed.status(), await placed.text()).toBe(200);
      await page.route("**/api/cards/*/image**", route => route.fulfill({ status: 204 }));
      await page.goto(`/duels/remote/${slug}`);
      const seat0 = page.getByTestId("seat-0"); const seat1 = page.getByTestId("seat-1");
      const area = (id: string) => page.getByTestId(id).evaluate(el => { const r = el.getBoundingClientRect(); return r.width * r.height; });
      await expect(seat0).toHaveAttribute("data-view", "camera");
      const camBefore = await area("feed-box-0"); const fieldBefore = await area("fwrap-0");
      await shot(page, `swap-${mode}-camera`);
      // A click on a card keeps its own meaning: the card inspector opens and the view does not change.
      await page.getByTestId("field-0").locator('[data-zone="m1"]').click();
      await expect(page.getByTestId("inspector-body")).toBeVisible();
      await expect(seat0).toHaveAttribute("data-view", "camera");
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("inspector-body")).toBeHidden();
      // A click on the empty frame enlarges the field and shrinks the camera.
      await page.getByTestId("fwrap-0").click({ position: { x: 4, y: 4 } });
      await expect(seat0).toHaveAttribute("data-view", "field");
      await expect(seat1).toHaveAttribute("data-view", "camera");
      await expect.poll(() => area("feed-box-0"), { timeout: 3_000 }).toBeLessThan(camBefore * 0.7);
      await expect.poll(() => area("fwrap-0"), { timeout: 3_000 }).toBeGreaterThanOrEqual(fieldBefore - 1);
      if (mode === "3") await expect.poll(() => area("fwrap-0"), { timeout: 3_000 }).toBeGreaterThan(fieldBefore * 1.15);
      await shot(page, `swap-${mode}-field`);
      // Cards still answer clicks in the field view.
      await page.getByTestId("field-0").locator('[data-zone="m1"]').click();
      await expect(page.getByTestId("inspector-body")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(seat0).toHaveAttribute("data-view", "field");
      // The choice is remembered for this viewer and seat only.
      await page.reload();
      await expect(page.getByTestId("seat-0")).toHaveAttribute("data-view", "field");
      await expect(page.getByTestId("seat-1")).toHaveAttribute("data-view", "camera");
      // The small camera brings the camera view back.
      await page.getByTestId("swap-cam-0").click();
      await expect(page.getByTestId("seat-0")).toHaveAttribute("data-view", "camera");
      await expect.poll(() => area("feed-box-0"), { timeout: 3_000 }).toBeGreaterThan(camBefore * 0.93);
      // The toggle works with the keyboard.
      const toggle = page.getByTestId("view-toggle-0");
      await expect(toggle).toHaveText("Enlarge field");
      await toggle.focus(); await page.keyboard.press("Enter");
      await expect(page.getByTestId("seat-0")).toHaveAttribute("data-view", "field");
      await expect(toggle).toHaveText("Camera view");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("seat-0")).toHaveAttribute("data-view", "camera");
    });
  }

  test("with reduced motion the swap is instant", async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const slug = await soloTable(context.request, 2);
    await page.goto(`/duels/remote/${slug}`);
    const before = await page.getByTestId("feed-box-0").evaluate(el => el.getBoundingClientRect().width);
    await page.getByTestId("view-toggle-0").click();
    await expect(page.getByTestId("seat-0")).toHaveAttribute("data-view", "field");
    await page.waitForTimeout(60);
    expect(await page.getByTestId("feed-box-0").evaluate(el => el.getBoundingClientRect().width)).toBeLessThan(before * 0.8);
  });

  for (const [width, height, label] of [[1920, 1080, "1080p"], [2560, 1440, "1440p"], [1366, 768, "1366"], [390, 844, "390"]] as const) {
    for (const [count, mode] of [[2, "1v1"], [3, "3"], [4, "4"]] as const) {
      test(`enlarged field fits the window and keeps the camera reachable: ${label} ${mode}`, async ({ page, context }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width, height });
        const slug = await soloTable(context.request, count);
        await page.goto(`/duels/remote/${slug}`);
        await expect(page.getByTestId("feed-box-0")).toBeVisible();
        const box = (id: string) => page.getByTestId(id).evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
        const camBefore = await box("feed-box-0"); const fieldBefore = await box("fwrap-0");
        await page.getByTestId("view-toggle-0").click();
        await expect(page.getByTestId("seat-0")).toHaveAttribute("data-view", "field");
        await page.waitForTimeout(600);
        const cam = await box("feed-box-0"); const field = await box("fwrap-0");
        if (process.env.E2E_MEASURE) console.log(`SWAP ${label} ${mode} field ${Math.round(fieldBefore.w)}x${Math.round(fieldBefore.h)} -> ${Math.round(field.w)}x${Math.round(field.h)}, camera ${Math.round(camBefore.w)}x${Math.round(camBefore.h)} -> ${Math.round(cam.w)}x${Math.round(cam.h)}`);
        expect(cam.w * cam.h).toBeLessThan(camBefore.w * camBefore.h * 0.8);
        expect(field.w * field.h).toBeGreaterThanOrEqual(fieldBefore.w * fieldBefore.h - 1);
        expect(field.x).toBeGreaterThanOrEqual(-1); expect(field.x + field.w).toBeLessThanOrEqual(width + 1);
        // The field stays inside its seat: no spill over the LP row or the next seat.
        const seat = await box("seat-0");
        expect(field.y + field.h).toBeLessThanOrEqual(seat.y + seat.h + 1);
        await shot(page, `swap-${label}-${mode}`);
        await page.getByTestId("swap-cam-0").click();
        await expect(page.getByTestId("seat-0")).toHaveAttribute("data-view", "camera");
      });
    }
  }

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
    expect(await page.getByTestId("lock").count()).toBeLessThanOrEqual(1);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("frozen-frame")).toHaveCount(0);
    // Unfreezing clears every outline and label.
    await expect(page.getByTestId("quad")).toHaveCount(0);
    await expect(page.getByTestId("lock")).toHaveCount(0);
    await expect(page.getByTestId("reticle")).toHaveCount(0);
  });

  // Master Rule 5 field: two Extra Monster Zones above the main row, shared with the facing seat. Genesys has none.
  test("virtual field shows Extra Monster Zones and Pendulum labels, and hides them for Genesys", async ({ page, context }) => {
    const slug = await soloTable(context.request, 2);
    const path = `/api/remote/${slug}`;
    const act = async (action: Record<string, unknown>) => {
      const room = await (await context.request.get(path)).json();
      const response = await context.request.post(`${path}/actions`, { data: { baseSeq: room.lastSeq, action: { idempotencyKey: crypto.randomUUID(), ...action } } });
      expect(response.status(), await response.text()).toBe(200);
    };
    await act({ type: "twin.place", actorSeat: 0, seat: 0, zone: "extra-monster", card: { ref: "link0", cardId: 5318639, name: "Mystical Space Typhoon", slot: 1, faceUp: true, position: "attack" } });
    await act({ type: "twin.place", actorSeat: 1, seat: 1, zone: "extra-monster", card: { ref: "link1", cardId: 73628505, name: "Terraforming", slot: 1, faceUp: true, position: "attack" } });
    await act({ type: "twin.place", actorSeat: 0, seat: 0, zone: "pendulum", card: { ref: "scale", cardId: 47355498, name: "Necrovalley", slot: 2, faceUp: true, position: "attack" } });
    await page.goto(`/duels/remote/${slug}`);
    const field = page.getByTestId("field-0");
    const e1 = field.locator('[data-zone="e1"]'); const e2 = field.locator('[data-zone="e2"]'); const m2 = field.locator('[data-zone="m2"]');
    await expect(e1).toBeVisible(); await expect(e2).toBeVisible();
    const [b1, b2, bm] = await Promise.all([e1.boundingBox(), e2.boundingBox(), m2.boundingBox()]);
    expect(b1!.y + b1!.height).toBeLessThanOrEqual(bm!.y + 2);
    expect(b2!.x).toBeGreaterThan(b1!.x);
    await expect(e1).toHaveAttribute("aria-label", /Mystical Space Typhoon/);
    // Seat 1's zone 1 is seat 0's zone 2: it shows as taken there, and as a card on the other seat.
    await expect(e2).toHaveAttribute("aria-label", /taken by their monster/);
    await expect(page.getByTestId("field-1").locator('[data-zone="e1"]')).toHaveAttribute("aria-label", /Terraforming/);
    await expect(field.locator('[data-zone="s5"]')).toHaveAttribute("aria-label", /Necrovalley/);
    await expect(field.locator('[data-zone="s1"]')).toContainText("PZ");
    await expect(field.locator('[data-zone="ex"]')).toContainText(/EXTRA/);
    await shot(page, "field-emz-1v1");
    // Genesys: no Extra Monster Zones and no Pendulum label.
    const created = await context.request.post("/api/remote", { data: { gameId: "ygo", seatCount: 2, solo: true, format: "genesys" } });
    expect(created.status()).toBe(201); const genesys = await created.json();
    await context.request.post(`/api/remote/${genesys.slug}/ready`, { data: { ready: true } });
    expect((await context.request.post(`/api/remote/${genesys.slug}/start`, { data: {} })).status()).toBe(200);
    await page.goto(`/duels/remote/${genesys.slug}`);
    await expect(page.getByTestId("field-0")).toBeVisible();
    await expect(page.getByTestId("field-0").locator('[data-zone="e1"]')).toHaveCount(0);
    await expect(page.getByTestId("field-0").locator('[data-zone="s1"]')).not.toContainText("PZ");
  });

  // The feed box takes the camera's real shape, the camera row sits under it, and the virtual field is smaller.
  for (const [width, height, label] of [[1920, 1080, "1080p"], [2560, 1440, "1440p"], [1366, 768, "1366"], [390, 844, "390"]] as const) {
    for (const [count, mode] of [[2, "1v1"], [3, "3"], [4, "4"]] as const) {
      for (const shape of ["16:9", "4:3"] as const) {
        test(`video box matches the camera and controls fit: ${label} ${mode} ${shape}`, async ({ page, context }) => {
          test.setTimeout(120_000);
          await page.setViewportSize({ width, height });
          const slug = await soloTable(context.request, count);
          await fakeCamera(page, shape);
          await page.goto(`/duels/remote/${slug}`);
          // Camera off: the empty feed fills the same box as a live one will.
          await expect(page.getByTestId("feed-box-0")).toBeVisible();
          const measure = () => page.evaluate(() => {
            const r = (el: Element | null | undefined) => { const b = el?.getBoundingClientRect(); return b ? { x: b.left, y: b.top, w: b.width, h: b.height } : null; };
            const field = document.querySelector('[data-testid="field-0"]');
            const holo = field?.closest('[class*="holo"]');
            return { seat: r(document.querySelector('[data-testid="seat-0"]')), box: r(document.querySelector('[data-testid="feed-box-0"]')), holo: r(holo), lp: r(document.querySelector('[data-testid="lp-0"]')),
              lpFont: parseFloat(getComputedStyle(document.querySelector('[data-testid="lp-value-0"]')!).fontSize), win: { w: innerWidth, h: innerHeight } };
          });
          const off = await measure();
          const share = (x: typeof off) => (x.box!.w * x.box!.h) / (x.seat!.w * x.seat!.h);
          const video = page.locator('[data-testid="feed-0"] video');
          // The first click can land before the page is interactive on a cold start, so click again until the video shows.
          await expect(async () => {
            if (await page.getByTestId("camera-on-feed").count()) await page.getByTestId("camera-on-feed").click();
            await expect(video).toBeVisible({ timeout: 4_000 });
          }).toPass({ timeout: 40_000 });
          await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
          await page.waitForTimeout(500);
          const on = await measure();
          if (process.env.E2E_MEASURE) (await import("node:fs")).appendFileSync(process.env.E2E_MEASURE, JSON.stringify({ label, mode, shape, offShare: +share(off).toFixed(3), onShare: +share(on).toFixed(3), box: on.box && { w: Math.round(on.box.w), h: Math.round(on.box.h) }, offBox: off.box && { w: Math.round(off.box.w), h: Math.round(off.box.h) }, seat: { w: Math.round(on.seat!.w), h: Math.round(on.seat!.h) }, holo: on.holo && { w: Math.round(on.holo.w), h: Math.round(on.holo.h) }, lpH: Math.round(on.lp!.h), lpFont: on.lpFont }) + "\n");
          const m = await page.evaluate(() => {
            const rect = (id: string) => { const r = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect(); return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; };
            const v = document.querySelector('[data-testid="feed-0"] video') as HTMLVideoElement;
            return { box: rect("feed-box-0"), row: rect("camera-row"), field: rect("field-0"), vw: v.videoWidth, vh: v.videoHeight };
          });
          expect(m.box && m.row).toBeTruthy();
          // The empty feed filled the same box as the live one.
          // (A 4:3 camera changes the box shape once it is on, so this is checked for 16:9.)
          if (shape === "16:9") { expect(Math.abs(off.box!.w - on.box!.w)).toBeLessThanOrEqual(2); expect(Math.abs(off.box!.h - on.box!.h)).toBeLessThanOrEqual(2); }
          if (width >= 1366 && shape === "16:9") {
            // The camera comes first: a large share of the seat. The field frame hugs its zones and is a strip. LP is one small row.
            expect(share(on)).toBeGreaterThan(mode === "3" ? 0.3 : 0.33);
            expect(on.holo!.w).toBeLessThan(on.seat!.w * (mode === "3" ? 1.01 : 0.7));
            if (mode !== "4") expect(on.holo!.h).toBeLessThan(on.seat!.h * (mode === "3" ? 0.5 : 0.36));
            expect(on.lpFont).toBeLessThanOrEqual(42);
            if (mode === "1v1") expect(on.lp!.h).toBeLessThanOrEqual(60);
          }
          // No bars: the box has the video's shape (2% tolerance for rounding).
          expect(Math.abs(m.box!.w / m.box!.h - m.vw / m.vh) / (m.vw / m.vh)).toBeLessThan(0.02);
          // Controls: one row under the video, inside the window, not over the box.
          expect(m.row!.y).toBeGreaterThanOrEqual(m.box!.y + m.box!.h - 1);
          expect(m.row!.x).toBeGreaterThanOrEqual(-1); expect(m.row!.x + m.row!.w).toBeLessThanOrEqual(width + 1);
          expect(m.row!.y + m.row!.h).toBeLessThanOrEqual(height + 1);
          const clipped = await page.getByTestId("camera-row").evaluate(row => [...row.querySelectorAll("button,select")].some(b => { const r = b.getBoundingClientRect(); const o = row.getBoundingClientRect(); return r.right > o.right + 1 || r.left < o.left - 1; }));
          expect(clipped).toBe(false);
          await shot(page, `feed-${label}-${mode}-${shape.replace(":", "x")}`);
        });
      }
    }
  }

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

const BASE_URL = process.env.E2E_REMOTE_UI_URL ?? "http://localhost:3310";
const remoteRadio = (page: Page) => page.locator("label", { has: page.getByRole("radio", { name: "Remote Duel" }) });
const onlineRadio = (page: Page) => page.locator("label", { has: page.getByRole("radio", { name: "Online" }) });

test.describe("Remote Duel on the Duels screens (flag on)", () => {
  test.skip(process.env.E2E_REMOTE_OFF === "1", "the stack runs with REMOTE_DUELS off");
  test.beforeEach(async ({ context }) => { await authenticatePlayer(context.request, { userId: 101 }, process.env.E2E_AUTH_SECRET!, BASE_URL); });

  test("Duels → New → Remote Duel → Create room lands on the table", async ({ page }) => {
    await page.goto("/duels");
    await expect(page.getByTestId("remote-tables-panel")).toBeVisible();
    for (const [w, h] of [[1920, 1080], [2560, 1440], [1366, 768], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto("/duels");
      await expect(page.getByRole("heading", { name: "Remote Duels" })).toBeVisible();
      await expect(page.getByRole("link", { name: "New Remote Duel" })).toBeVisible();
      await shot(page, `duels-${w}x${h}`);
      await page.goto("/duels/new");
      await expect(page.getByRole("heading", { name: "Play" })).toBeVisible();
      await shot(page, `new-online-${w}x${h}`);
      await remoteRadio(page).click();
      await expect(page.getByTestId("remote-setup")).toBeVisible();
      await expect(page.getByRole("button", { name: "Create room" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shot(page, `new-remote-${w}x${h}`);
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/duels");
    await page.getByRole("link", { name: "Create game" }).click();
    await remoteRadio(page).click();
    // The address follows the Play mode: a reload keeps Remote Duel, and Online drops the type.
    await expect(page).toHaveURL(/\/duels\/new\?type=remote$/);
    await page.reload();
    await expect(page.getByRole("radio", { name: "Remote Duel" })).toBeChecked();
    await expect(page.getByTestId("remote-setup")).toBeVisible();
    // The same duel type and Genesys controls as Online, and the rule on by default.
    await expect(page.getByRole("radiogroup", { name: "Duel type" })).toBeVisible();
    await expect(page.getByTestId("genesys-toggle")).toBeVisible();
    await expect(page.getByTestId("create-show-set")).toBeChecked();
    await onlineRadio(page).click();
    await expect(page).toHaveURL(/\/duels\/new$/);
    await expect(page.getByTestId("remote-setup")).toHaveCount(0);
    await remoteRadio(page).click();
    await page.getByTestId("create-solo").check();
    await page.getByTestId("create-room").click();
    await expect(page).toHaveURL(/\/duels\/remote\/[^/]+$/);
    await expect(page.getByTestId("remote-lobby-room")).toBeVisible();
    await shot(page, "created-room-1920");
    // The new table is listed on the Duels page. It is yours and solo, so it is still being set up, not open to join.
    await page.goto("/duels");
    const panel = page.getByTestId("remote-tables-panel");
    await expect(panel.getByText("Your table")).toBeVisible();
    await expect(panel.getByText("Setting up").first()).toBeVisible();
    await shot(page, "duels-with-table-1920");
  });

  test("Genesys Domain chosen on the create screen reaches the room", async ({ page }) => {
    await page.goto("/duels/new?type=remote");
    await page.getByTestId("genesys-toggle").check();
    await page.locator("label", { has: page.getByRole("radio", { name: "Domain" }) }).click();
    await page.getByTestId("create-solo").check();
    const created = page.waitForResponse(response => response.url().endsWith("/api/remote") && response.request().method() === "POST");
    await page.getByTestId("create-room").click();
    const body = (await created).request().postDataJSON();
    expect(body).toMatchObject({ format: "genesys-domain", solo: true, showCardsSetFromDeck: true });
    await expect(page.getByTestId("remote-lobby-room")).toBeVisible();
    await expect(page.getByTestId("room-format")).toHaveValue("genesys-domain");
  });

  test("Online create is unchanged with the flag on: Remote, back to Online, Create game sends the usual request", async ({ page }) => {
    await page.goto("/duels/new");
    await remoteRadio(page).click();
    await onlineRadio(page).click();
    let request: { body: Record<string, unknown>; key: string | undefined } | undefined;
    await page.route("**/api/duels", async route => {
      if (route.request().method() !== "POST") return route.continue();
      request = { body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] };
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "stubbed" }) });
    });
    await page.getByRole("button", { name: "Create game" }).click();
    await expect.poll(() => request).toBeTruthy();
    expect(Object.keys(request!.body).sort()).toEqual(["bestOf", "masterRule", "mode", "name", "ranked", "settings"]);
    // No `format` for 1v1 and no `opponentPlayerId` without a challenge: the body the server has always read.
    expect(request!.body).toMatchObject({ mode: "normal", masterRule: 5, bestOf: 1, ranked: false });
    expect(request!.key).toBeTruthy();
    // The online error stays in Online; Remote shows none of it.
    await expect(page.getByRole("alert").filter({ hasText: "stubbed" })).toBeVisible();
    await remoteRadio(page).click();
    await expect(page.getByRole("alert").filter({ hasText: "stubbed" })).toHaveCount(0);
  });
});

// Run with E2E_REMOTE_OFF=1: the stack then starts without REMOTE_DUELS.
test.describe("Remote Duel with the flag off leaves no trace", () => {
  test.skip(process.env.E2E_REMOTE_OFF !== "1", "needs a stack with REMOTE_DUELS off (E2E_REMOTE_OFF=1)");
  test("no Play mode, no Remote Duels panel, no remote or deck requests", async ({ page, context }) => {
    await authenticatePlayer(context.request, { userId: 101 }, process.env.E2E_AUTH_SECRET!, BASE_URL);
    const seen: string[] = [];
    page.on("request", request => { const path = new URL(request.url()).pathname; if (path.startsWith("/api/remote") || path === "/api/decks") seen.push(path); });
    await page.goto("/duels/new?type=remote");
    await expect(page.getByRole("heading", { name: "Custom game creator" })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Play mode" })).toHaveCount(0);
    await expect(page.getByTestId("remote-setup")).toHaveCount(0);
    await page.goto("/duels");
    await expect(page.getByRole("heading", { name: "Duels", exact: true })).toBeVisible();
    await expect(page.getByTestId("remote-tables-panel")).toHaveCount(0);
    await page.waitForTimeout(6000);
    expect(seen).toEqual([]);
  });
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

test("private Set candidate pick, public reveal and a soft mismatch note",async({page,context})=>{
  await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,(process.env.E2E_REMOTE_UI_URL ?? "http://localhost:3310"));
  const decks=await (await context.request.get("/api/decks")).json();
  const deck=decks.decks.find((d:{name:string})=>d.name==="Remote origin fixture");
  const created=await context.request.post("/api/remote",{data:{gameId:"ygo",seatCount:2,solo:true,showCardsSetFromDeck:false}});
  let room=await created.json(); const slug=room.slug;
  const selected=await context.request.post(`/api/remote/${slug}/deck`,{data:{savedDeckId:deck.id}}); expect(selected.status(),await selected.text()).toBe(200);
  await context.request.post(`/api/remote/${slug}/ready`,{data:{ready:true}});
  const started=await context.request.post(`/api/remote/${slug}/start`,{data:{}}); expect(started.status(),await started.text()).toBe(200); room=await started.json();
  const source=await context.request.post(`/api/remote/${slug}/actions`,{data:{baseSeq:room.lastSeq,action:{type:"twin.place",actorSeat:0,seat:0,zone:"spell-trap",card:{ref:"tracks",cardId:70825459,name:"Trap Tracks",slot:1,faceUp:true},idempotencyKey:crypto.randomUUID()}}});
  expect(source.status(),await source.text()).toBe(200);
  // Keep image loading offline; the behavior under test is the owned card state.
  await page.route("**/api/cards/*/image**",route=>route.fulfill({status:204}));
  await page.goto(`/duels/remote/${slug}`);
  await page.getByTestId("field-0").locator('[data-zone="s1"]').click();
  await page.getByRole("button",{name:"Activate",exact:true}).click();
  await page.getByRole("button",{name:"Set face-down",exact:true}).click();
  const set=page.getByTestId("field-0").locator('[data-zone="s2"]');
  await expect(set).toHaveAttribute("aria-label",/Face-down · Set by Trap Tracks/);
  await set.click();
  await expect(page.getByTestId("effect-picker")).toBeVisible();
  await page.getByRole("button",{name:/Torrential Tribute ×1/}).click();
  await expect(set).toHaveAttribute("aria-label",/Torrential Tribute/);
  await set.click(); await page.getByRole("button",{name:"Reveal chosen card"}).click();
  await expect(set).toHaveAttribute("aria-label",/Torrential Tribute/);
  await expect(set).not.toHaveAttribute("aria-label",/Face-down/);
  // A later camera correction is assistive: the action succeeds and everyone gets a dismissible note.
  room=await (await context.request.get(`/api/remote/${slug}`)).json();
  const ref=room.state.seats[0].twin.find((c:{ref:string})=>c.ref!=="tracks").ref;
  const corrected=await context.request.post(`/api/remote/${slug}/actions`,{data:{baseSeq:room.lastSeq,action:{type:"card.identified",actorSeat:0,seat:0,cardRef:ref,cardId:5318639,source:"auto",idempotencyKey:crypto.randomUUID()}}});
  expect(corrected.status()).toBe(200);
  await expect(page.getByText("Mystical Space Typhoon could not be Set by Trap Tracks",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Dismiss note"}).click();
  await expect(page.getByText("Mystical Space Typhoon could not be Set by Trap Tracks",{exact:true})).toHaveCount(0);
});

for (const showCardsSetFromDeck of [true,false]) test(`two browsers honor Deck publicity ${showCardsSetFromDeck}`,async({page,context,browser})=>{
  const url=process.env.E2E_REMOTE_UI_URL ?? "http://localhost:3310";
  await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,url);
  const bob=await browser.newContext();
  try {
    await authenticatePlayer(bob.request,{userId:102},process.env.E2E_AUTH_SECRET!,url);
    const aliceDeck=(await (await context.request.get("/api/decks")).json()).decks.find((d:{name:string})=>d.name==="Remote origin fixture");
    const bobDeck=(await (await bob.request.get(`${url}/api/decks`)).json()).decks.find((d:{name:string})=>d.name==="Remote origin fixture");
    let room=await (await context.request.post("/api/remote",{data:{gameId:"ygo",seatCount:2,...(showCardsSetFromDeck ? {} : {showCardsSetFromDeck:false})}})).json();const path=`/api/remote/${room.slug}`;
    expect((await context.request.post(`${path}/deck`,{data:{savedDeckId:aliceDeck.id}})).status()).toBe(200);
    expect((await bob.request.post(`${url}${path}/seat`,{data:{seat:1}})).status()).toBe(200);
    expect((await bob.request.post(`${url}${path}/deck`,{data:{savedDeckId:bobDeck.id}})).status()).toBe(200);
    await context.request.post(`${path}/ready`,{data:{ready:true}});await bob.request.post(`${url}${path}/ready`,{data:{ready:true}});
    const start=await context.request.post(`${path}/start`,{data:{}});expect(start.status(),await start.text()).toBe(200);room=await start.json();
    const act=async(action:Record<string,unknown>)=>{
      room=await (await context.request.get(path)).json();
      const response=await context.request.post(`${path}/actions`,{data:{baseSeq:room.lastSeq,action:{actorSeat:0,idempotencyKey:crypto.randomUUID(),...action}}});
      expect(response.status(),await response.text()).toBe(200);room=await response.json();
    };
    await act({type:"effect.activated",source:{cardId:70825459}});
    await act({type:"twin.place",seat:0,zone:"spell-trap",card:{ref:"private",slot:1,faceUp:false}});
    const observer=await bob.newPage();
    await Promise.all([page,observer].map(p=>p.route("**/api/cards/*/image**",route=>route.fulfill({status:204}))));
    await Promise.all([page.goto(`/duels/remote/${room.slug}`),observer.goto(`${url}/duels/remote/${room.slug}`)]);
    await page.getByTestId("field-0").locator('[data-zone="s1"]').click();
    await page.getByRole("button",{name:/Torrential Tribute ×1/}).click();
    const otherSet=observer.getByTestId("field-0").locator('[data-zone="s1"]');
    await expect(otherSet).toHaveAttribute("aria-label",showCardsSetFromDeck ? /Face-down · Set from Deck by Trap Tracks: Torrential Tribute/ : /Face-down · Set by Trap Tracks/);
    if(!showCardsSetFromDeck) await expect(otherSet).not.toHaveAttribute("aria-label",/Torrential/);
    await otherSet.click();await expect(observer.getByTestId("effect-picker")).toHaveCount(0);
    const privateView=await (await bob.request.get(`${url}${path}`)).json();
    expect(privateView.seats[0].deck).toBeUndefined();expect(privateView.state.effectTracking.origins[0].candidates).toBeUndefined();
    expect(privateView.state.seats[0].twin[0].cardId).toBe(showCardsSetFromDeck ? 53582587 : undefined);
    expect(privateView.state.seats[0].twin[0].faceUp).toBe(false);
    for(const key of ['"pool"','"candidates"','"eligibleIds"','"chosenCardId"']) expect(JSON.stringify(privateView)).not.toContain(key);
    if(showCardsSetFromDeck) await observer.keyboard.press("Escape");
    await act({type:"twin.flip",seat:0,cardRef:"private",faceUp:true});
    await expect(otherSet).toHaveAttribute("aria-label",/Torrential Tribute/);
    await act({type:"effect.activated",source:{cardId:73628505}});
    await page.getByRole("button",{name:"Choose searched card · from Terraforming"}).click();
    await page.getByRole("button",{name:/Necrovalley ×1/}).click();
    if(!showCardsSetFromDeck) await expect(observer.getByText("Necrovalley added to hand by Terraforming",{exact:true})).toHaveCount(0);
    const handView=await (await bob.request.get(`${url}${path}`)).json();
    expect(handView.state.effectTracking.origins.find((o:{destination:string})=>o.destination==="hand").chosenCardId).toBeUndefined();
    expect(handView.state.effectTracking.origins.find((o:{destination:string})=>o.destination==="hand").candidates).toBeUndefined();
    if(!showCardsSetFromDeck) await page.getByRole("button",{name:"Announce searched card"}).click();
    else await expect(page.getByRole("button",{name:"Announce searched card"})).toHaveCount(0);
    await expect(observer.getByText("Necrovalley added to hand by Terraforming",{exact:true})).toBeVisible();
  } finally {await bob.close();}
});


test("create screen and lobby expose the default-on Deck publicity rule",async({page,context})=>{
  const url=process.env.E2E_REMOTE_UI_URL ?? "http://localhost:3310";
  await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,url);
  await page.goto("/duels/new?type=remote");
  const label="Cards Set from Deck are shown to all";
  // On the create screen the toggle's name also holds its small explanation, so the name is matched as a part.
  await expect(page.getByRole("checkbox",{name:label})).toBeChecked();
  await page.getByRole("checkbox",{name:label}).uncheck();
  await page.getByTestId("create-solo").check();
  await page.getByTestId("create-room").click();
  await expect(page.getByTestId("remote-lobby-room")).toBeVisible();
  await expect(page.getByRole("checkbox",{name:label,exact:true})).not.toBeChecked();
  await page.getByTestId("ready").click();
  await expect(page.getByTestId("ready")).toHaveText("Not ready");
  await page.getByRole("checkbox",{name:label,exact:true}).check();
  await page.getByTestId("apply-rules").click();
  await expect(page.getByTestId("ready")).toHaveText("Ready");
  await page.reload();
  await expect(page.getByRole("checkbox",{name:label,exact:true})).toBeChecked();
});
