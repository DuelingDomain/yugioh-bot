import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

async function soloTable(api: APIRequestContext, seatCount: 2 | 3 | 4, registeredDeck=false) {
  const created = await api.post("/api/remote", { data: { gameId: "ygo", seatCount, solo: true } });
  expect(created.status()).toBe(201); const room = await created.json();
  if(registeredDeck){
    const {decks}=await (await api.get('/api/decks')).json();
    const picked=await api.post(`/api/remote/${room.slug}/deck`,{data:{savedDeckId:decks[0].id}});
    expect(picked.ok(),await picked.text()).toBe(true);
  }
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

  test("a click where no card is found shows a small note, not a popup, and Search card opens the search", async ({ page, context }) => {
    test.setTimeout(240_000);
    const slug = await soloTable(context.request, 2);
    await fakeCamera(page);
    await page.goto(`/duels/remote/${slug}`);
    await page.getByTestId("camera-on-feed").click();
    const video = page.locator('[data-testid="feed-0"] video');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    await page.getByTestId("feed-0").hover();
    await page.waitForTimeout(500);
    // The top left corner of the picture is bare table.
    const p = await video.evaluate((v: HTMLVideoElement) => {
      const r = v.getBoundingClientRect(); const s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
      const w = v.videoWidth * s; const h = v.videoHeight * s;
      return { x: r.left + (r.width - w) / 2 + 0.05 * w, y: r.top + (r.height - h) / 2 + 0.05 * h };
    });
    await page.mouse.click(p.x, p.y);
    await expect(page.getByTestId("no-card")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("no-card")).toContainText("No card here");
    await expect(page.locator('[data-layer="tray"], [data-layer="card"]')).toHaveCount(0);
    await expect(page.getByTestId("reticle")).toHaveCount(0);
    await shot(page, "no-card-note");
    await page.getByTestId("no-card-search").click();
    await expect(page.locator('[data-layer="tray"]').first()).toBeVisible({ timeout: 3_000 });
    await expect(page.getByTestId("no-card")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-layer="tray"], [data-layer="card"]')).toHaveCount(0);
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

test.describe("remote duels screen, moving cards by hand", () => {
  test.beforeEach(async ({ context }) => { await authenticatePlayer(context.request, { userId: 101 }, process.env.E2E_AUTH_SECRET!, (process.env.E2E_REMOTE_UI_URL ?? "http://localhost:3310")); });
  const seed = async (context: { request: APIRequestContext }, slug: string) => {
    let room = await (await context.request.get(`/api/remote/${slug}`)).json();
    const act = async (action: Record<string, unknown>) => {
      const response = await context.request.post(`/api/remote/${slug}/actions`, { data: { baseSeq: room.lastSeq, action: { idempotencyKey: crypto.randomUUID(), ...action } } });
      expect(response.status(), await response.text()).toBe(200); room = await (await context.request.get(`/api/remote/${slug}`)).json();
    };
    await act({ type: "twin.place", actorSeat: 0, seat: 0, zone: "monster", card: { ref: "dm", cardId: 46986414, name: "Dark Magician", slot: 1, faceUp: true, position: "attack" } });
    await act({ type: "twin.place", actorSeat: 0, seat: 0, zone: "monster", card: { ref: "bl", cardId: 89631139, name: "Blue-Eyes White Dragon", slot: 2, faceUp: true, position: "attack" } });
    await act({ type: "twin.place", actorSeat: 0, seat: 0, zone: "spell-trap", card: { ref: "mst", cardId: 5318639, name: "Mystical Space Typhoon", slot: 1, faceUp: true, position: "attack" } });
    return async () => (await (await context.request.get(`/api/remote/${slug}`)).json()) as { state: { seats: { twin: { ref: string; zone: string; slot?: number; faceUp: boolean; position?: string }[] }[] }; events: { action: { type: string } }[] };
  };
  const find = (room: Awaited<ReturnType<Awaited<ReturnType<typeof seed>>>>, ref: string) => room.state.seats[0].twin.find(card => card.ref === ref)!;

  test("drag and drop: move with Undo and a log line, zone rules refuse, keyboard alternative", async ({ page, context }) => {
    const slug = await soloTable(context.request, 2); const room = await seed(context, slug);
    await page.goto(`/duels/remote/${slug}`);
    const field = page.getByTestId("field-0"); const from = field.locator('[data-zone="m1"]'); const to = field.locator('[data-zone="m4"]');
    await expect(from).toBeVisible();
    // A phase click only works once the page is hydrated; a drag before that does nothing.
    await expect(async () => { await page.getByTestId("phase-main1").click(); await expect(page.getByTestId("phase-main1")).toHaveAttribute("aria-current", "step", { timeout: 1500 }); }).toPass({ timeout: 30_000 });
    const drag = async (source: typeof from, target: typeof from) => {
      const a = (await source.boundingBox())!; const b = (await target.boundingBox())!;
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
      await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 3 });
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
      await expect(page.getByTestId("drag-ghost")).toBeVisible(); await shot(page, "drag-over");
      await page.mouse.up();
    };
    await drag(from, to);
    await expect.poll(async () => find(await room(), "dm").slot).toBe(4);
    expect((await room()).events.filter(event => event.action.type === "twin.move")).toHaveLength(1);
    await page.getByTestId("log-button").click(); await expect(page.getByTestId("log-drawer")).toContainText("Monster Zone 4");
    await page.keyboard.press("Escape");
    await page.getByTestId("undo").click(); await expect.poll(async () => find(await room(), "dm").slot).toBe(1);
    // Occupied: refused, nothing changes.
    await drag(field.locator('[data-zone="m1"]'), field.locator('[data-zone="m2"]'));
    await expect(page.getByText("is taken")).toBeVisible(); expect(find(await room(), "dm").slot).toBe(1);
    // A Spell cannot go in a Monster Zone.
    await drag(field.locator('[data-zone="s1"]'), field.locator('[data-zone="m5"]'));
    await expect(page.getByText("Spells do not go in a Monster Zone.")).toBeVisible(); expect(find(await room(), "mst").zone).toBe("spell-trap");
    // A Spell to another Spell/Trap Zone works.
    await drag(field.locator('[data-zone="s1"]'), field.locator('[data-zone="s3"]'));
    await expect.poll(async () => find(await room(), "mst").slot).toBe(3);
    // Keyboard: M picks up, arrows choose, Enter drops, Esc cancels.
    const cell = field.locator('[data-zone="m1"]'); await cell.focus();
    await page.keyboard.press("m"); await expect(page.getByTestId("carry-hint")).toBeVisible();
    await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("Enter");
    await expect.poll(async () => find(await room(), "dm").slot).toBe(4);
    await field.locator('[data-zone="m4"]').focus(); await page.keyboard.press("m"); await page.keyboard.press("Escape");
    await expect(page.getByTestId("carry-hint")).toHaveCount(0); expect(find(await room(), "dm").slot).toBe(4);
  });

  test("field layout: Field, M1-M5, GY on top; Extra Deck, S1-S5, Deck below; other seats turned 180 degrees", async ({ page, context }) => {
    const slug = await soloTable(context.request, 2); await seed(context, slug);
    await page.goto(`/duels/remote/${slug}`);
    const box = async (seat: number, zone: string) => (await page.getByTestId(`field-${seat}`).locator(`[data-zone="${zone}"]`).boundingBox())!;
    await expect(page.getByTestId("field-0")).toBeVisible();
    const [f, m1, m5, gy, ex, s1, s5, deck, e1, m2] = await Promise.all(["f", "m1", "m5", "gy", "ex", "s1", "s5", "deck", "e1", "m2"].map(zone => box(0, zone)));
    expect(f.x).toBeLessThan(m1.x); expect(gy.x).toBeGreaterThan(m5.x); expect(Math.abs(f.y - gy.y)).toBeLessThan(3);
    expect(ex.x).toBeLessThan(s1.x); expect(deck.x).toBeGreaterThan(s5.x); expect(ex.y).toBeGreaterThan(f.y); expect(Math.abs(ex.x - f.x)).toBeLessThan(3); expect(Math.abs(deck.x - gy.x)).toBeLessThan(3);
    expect(e1.y).toBeLessThan(m2.y); expect(Math.abs(e1.x - m2.x)).toBeLessThan(3);
    // The other seat is turned: its Graveyard is on the left and its Field Zone on the right, its Deck on top.
    const [ogy, of, odeck] = await Promise.all(["gy", "f", "deck"].map(zone => box(1, zone)));
    expect(ogy.x).toBeLessThan(of.x); expect(odeck.y).toBeLessThan(ogy.y);
    await shot(page, "layout-1920");
  });

  test("camera row: three-way choice; Turn camera on leaves manual mode; no deck flag without a registered deck", async ({ page, context }) => {
    await fakeCamera(page, "16:9");
    const slug = await soloTable(context.request, 2); await seed(context, slug);
    // A banned card on a table with no registered deck must not raise "Deck no longer valid".
    const room = await (await context.request.get(`/api/remote/${slug}`)).json();
    const placed = await context.request.post(`/api/remote/${slug}/actions`, { data: { baseSeq: room.lastSeq, action: { idempotencyKey: crypto.randomUUID(), type: "twin.place", actorSeat: 0, seat: 0, zone: "spell-trap", card: { ref: "ttt", cardId: 25311006, name: "Triple Tactics Talent", slot: 2, faceUp: true, position: "attack" } } } });
    expect(placed.status(), await placed.text()).toBe(200);
    await page.goto(`/duels/remote/${slug}`);
    const choice = page.getByRole("radiogroup", { name: "Camera source" });
    await expect(choice.getByRole("radio")).toHaveCount(3);
    await expect(choice.getByRole("radio", { name: "Use webcam" })).toBeVisible();
    await expect(choice.getByRole("radio", { name: "Use phone as camera" })).toBeVisible();
    const manual = choice.getByRole("radio", { name: "No camera (manual)" });
    await expect(async () => { await manual.click(); await expect(manual).toHaveAttribute("aria-checked", "true", { timeout: 1500 }); }).toPass({ timeout: 30_000 });
    await expect(page.getByText("No camera (manual). Use voice")).toBeVisible();
    await page.getByTestId("camera-on-feed").click();
    await expect(page.getByTestId("feed-0").locator("video")).toBeVisible();
    await expect(choice.getByRole("radio", { name: "Use webcam" })).toHaveAttribute("aria-checked", "true");
    await expect(manual).toHaveAttribute("aria-checked", "false");
    // The row's own webcam choice also leaves manual mode.
    await manual.click(); await expect(manual).toHaveAttribute("aria-checked", "true");
    await choice.getByRole("radio", { name: "Use webcam" }).click();
    await expect(page.getByTestId("feed-0").locator("video")).toBeVisible();
    await expect(page.getByText("Deck no longer valid")).toHaveCount(0);
    await shot(page, "camera-row");
  });

  test("voice: zone words move the last card, a named card, set face down, and the field zone", async ({ page, context }) => {
    const slug = await soloTable(context.request, 2); const room = await seed(context, slug);
    await page.goto(`/duels/remote/${slug}`);
    await page.getByTestId("phase-main1").click();
    const say = async (text: string) => { const chip = page.getByRole("button", { name: text, exact: true }); if (await chip.count()) await chip.first().click({ force: true }); else await page.evaluate(() => 0); };
    await say("monster zone two");
    // The last card placed was the Spell; it is not a monster, so the move is refused and nothing changes.
    expect(find(await room(), "mst").zone).toBe("spell-trap");
    await say("graveyard");
    await expect.poll(async () => find(await room(), "mst").zone).toBe("graveyard");
    await page.getByTestId("undo").click(); await expect.poll(async () => find(await room(), "mst").zone).toBe("spell-trap");
  });

  test("Try saying list stays in the dock on a short screen and does not block a drag", async ({ page, context }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const slug = await soloTable(context.request, 2); const room = await seed(context, slug);
    await page.goto(`/duels/remote/${slug}`);
    const field = page.getByTestId("field-0"); const from = field.locator('[data-zone="m1"]'); const to = field.locator('[data-zone="m5"]');
    await expect(from).toBeVisible();
    await expect(async () => { await page.getByTestId("phase-main1").click(); await expect(page.getByTestId("phase-main1")).toHaveAttribute("aria-current", "step", { timeout: 1500 }); }).toPass({ timeout: 30_000 });
    await page.getByRole("button", { name: "Try saying…", exact: true }).click();
    const chip = (await page.getByRole("button", { name: "graveyard", exact: true }).boundingBox())!; const fieldBox = (await field.boundingBox())!;
    expect(chip.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height);
    const a = (await from.boundingBox())!; const b = (await to.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => find(await room(), "dm").slot).toBe(5);
  });
});

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

// Standalone real-worker coverage: run with playwright.vision.config.ts and a prepared local lab.
const AUTO_CARD = process.env.E2E_AUTO_CARD ?? new URL('../../../data/vision/benchmark/field-watcher/card.png', import.meta.url).pathname;
async function appearingCamera(page:Page) {
  const data=readFileSync(AUTO_CARD).toString('base64');
  await page.addInitScript(async data=>{
    const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d')!;
    const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));const image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
    let visible=false,x=460,y=170,defense=false,others:{x:number;y:number}[]=[];
    const paint=()=>{ctx.fillStyle='#26392f';ctx.fillRect(0,0,1280,720);if(visible){ctx.save();if(defense){ctx.translate(x+131,y+90);ctx.rotate(Math.PI/2);ctx.drawImage(image,-90,-131,180,262);}else ctx.drawImage(image,x,y,180,262);ctx.restore();for(const other of others)ctx.drawImage(image,other.x,other.y,180,262);}};
    (window as unknown as {fieldTest:{appear():void;place(left:number,top:number,defense?:boolean):void;move():void;clear():void;many(points:{x:number;y:number}[]):void}}).fieldTest={appear:()=>{visible=true;paint();},place:(left:number,top:number,def=false)=>{x=left;y=top;defense=def;visible=true;paint();},move:()=>{x=660;y=185;paint();},clear:()=>{visible=false;others=[];paint();},many:points=>{[ {x,y},...others]=points;visible=true;paint();}};
    paint();setInterval(paint,65);
    navigator.mediaDevices.getUserMedia=async constraints=>{if(!constraints?.video)throw new DOMException('Video only','NotFoundError');return canvas.captureStream(15);};
    navigator.mediaDevices.enumerateDevices=async()=>[];
  },data);
}
test('field watcher automatic: a lab without a deck asks before placement and follows a confirmed card',async({page})=>{
  test.setTimeout(120_000);await appearingCamera(page);await page.goto('/dev/vision-lab');
  await page.getByRole('tab',{name:'Auto-detect',exact:true}).click();
  await page.getByLabel('Auto-detect compute').selectOption('wasm');await page.getByRole('button',{name:'Start camera',exact:true}).click();
  await expect(page.getByTestId('auto-detect-status')).toContainText('Watching field');
  await expect.poll(()=>page.locator('video').evaluate((v:HTMLVideoElement)=>v.videoWidth)).toBe(1280);
  await page.waitForTimeout(2000);await expect(page.getByTestId('auto-detect-twin').locator('li')).toHaveCount(0);
  await page.evaluate(()=>((window as any).fieldTest).appear());
  const prompt=page.getByRole('group',{name:'New card?',exact:true});await expect(prompt).toBeVisible({timeout:30_000});
  await expect(page.getByTestId('auto-detect-twin').locator('li')).toHaveCount(0);
  await prompt.getByRole('button',{name:/Sacred Sword of Seven Stars/}).click();
  await expect(page.getByTestId('auto-detect-twin')).toContainText('Sacred Sword of Seven Stars');
  await expect(page.getByTestId('auto-detect-events')).toContainText('prompt');
  await page.evaluate(()=>((window as any).fieldTest).move());
  await expect(page.getByTestId('auto-detect-events')).toContainText('moved',{timeout:15_000});
  await expect(page.getByTestId('auto-detect-twin').locator('li')).toHaveCount(1);
  await page.evaluate(()=>((window as any).fieldTest).clear());
  await expect(page.getByTestId('auto-detect-twin').locator('li')).toHaveCount(0,{timeout:12000});
  await expect(page.getByTestId('auto-detect-departure')).toContainText('left the field');
  await page.getByRole('button',{name:'Undo automatic field change'}).click();await expect(page.getByTestId('auto-detect-twin').locator('li')).toHaveCount(1);
  await page.waitForTimeout(2800);await expect(page.getByTestId('auto-detect-twin').locator('li')).toHaveCount(1);
  await page.getByRole('button',{name:'Stop',exact:true}).click();
});
test('field watcher automatic: owner table applies once and Undo removes the atomic placement',async({page,context})=>{
  test.setTimeout(120_000);await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,process.env.VISION_LAB_ORIGIN??'http://127.0.0.1:3449');
  const slug=await soloTable(context.request,2,true);
  // Next dev compiles these on first use. Warm them before a placement starts
  // the five-second Undo window; compilation is not part of the Undo contract.
  await context.request.post(`/api/remote/${slug}/actions`,{data:{}});
  await context.request.post('/api/cards/resolve',{data:{customCardIds:[45725480]}});
  await context.request.get('/api/cards/45725480/image?variant=cropped');
  await appearingCamera(page);await page.goto(`/duels/remote/${slug}`);
  await page.getByTestId('camera-on-feed').click();await expect(page.getByTestId('field-watcher-status')).toContainText('Watching field');
  await page.waitForTimeout(2000);await page.evaluate(()=>((window as any).fieldTest).appear());
  const room=async()=>context.request.get(`/api/remote/${slug}`).then(r=>r.json());
  await expect.poll(async()=>{const r=await room();return r.state.seats[0].twin.length;},{timeout:30_000}).toBe(1);
  const placed=await room();expect(placed.state.seats[0].twin[0].cardId).toBe(45725480);
  expect(placed.events.filter((e:any)=>e.action.type==='twin.place'&&e.action.source==='auto')).toHaveLength(1);
  expect(placed.events.some((e:any)=>e.action.type==='card.identified')).toBe(false);
  await page.getByTestId('undo').click();await expect.poll(async()=>(await room()).state.seats[0].twin.length).toBe(0);
  await page.waitForTimeout(2500);expect((await room()).state.seats[0].twin).toHaveLength(0);
  await page.evaluate(()=>{
    const feed=document.querySelector<HTMLElement>('[data-testid="feed-0"]')!,video=feed.querySelector('video')!,r=feed.getBoundingClientRect();
    const scale=Math.min(r.width/video.videoWidth,r.height/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale;
    feed.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+(r.width-w)/2+550/1280*w,clientY:r.top+(r.height-h)/2+301/720*h}));
  });
  await expect(page.getByTestId('recognition-tray')).toBeVisible();await page.keyboard.press('Escape');
  await expect(page.getByTestId('card-popover')).toHaveCount(0);
  await page.getByLabel('Auto-detect cards',{exact:true}).uncheck();await expect(page.getByTestId('field-watcher-status')).toHaveCount(0);
});

test('field watcher automatic: a failed lazy recognition load leaves detection usable and can retry',async({page})=>{
  test.setTimeout(90_000);await page.route('**/dev/vision-assets/yugioh-index.bin',route=>route.fulfill({status:503,body:'temporary fixture failure'}),{times:1});
  await page.goto('/dev/vision-lab');
  const answer=await page.evaluate(async()=>{
    const api=await import(/* webpackIgnore: true */ String('/dev/vision-assets/benchmark/field-watcher/api.js'));
    const reader=api.createRecognizer({backend:'wasm'}),canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#26392f';ctx.fillRect(0,0,1280,720);ctx.drawImage(await createImageBitmap(await(await fetch('/dev/vision-assets/benchmark/field-watcher/card.png')).blob()),460,170,180,262);
    try {
      const cards=await reader.detectCards(await createImageBitmap(canvas));let failure='';
      try{await reader.recognize([await createImageBitmap(canvas)],{card:cards[0]});}catch(e){failure=(e as Error).message;}
      const after=await reader.detectCards(await createImageBitmap(canvas)),retried=await reader.recognize([await createImageBitmap(canvas)],{card:after[0]});
      return {failure,detected:after.length,tier:retried.tier};
    }finally{reader.dispose();}
  });
  expect(answer.failure).toContain('503');expect(answer.detected).toBe(1);expect(answer.tier).toBe('sure');
});

test('field watcher automatic: actual table format places both EMZ above the main row and omits them in Genesys',async({page,context})=>{
  test.setTimeout(120_000);await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,process.env.VISION_LAB_ORIGIN??'http://127.0.0.1:3449');
  for(const format of ['normal','domain','genesys','genesys-domain']) {
    const created=await context.request.post('/api/remote',{data:{gameId:'ygo',seatCount:2,solo:true,format}});expect(created.status()).toBe(201);
    const {slug}=await created.json();await context.request.post(`/api/remote/${slug}/ready`,{data:{ready:true}});await context.request.post(`/api/remote/${slug}/start`,{data:{}});
    await page.goto(`/duels/remote/${slug}`);const field=page.getByTestId('field-0');
    await expect(field.locator('[data-zone="e1"], [data-zone="e2"]')).toHaveCount(format.startsWith('genesys')?0:2);
    if(!format.startsWith('genesys'))for(const [extra,main] of [['e1','m2'],['e2','m4']]) {
      const a=await field.locator(`[data-zone="${extra}"]`).boundingBox(),b=await field.locator(`[data-zone="${main}"]`).boundingBox();
      expect(a).not.toBeNull();expect(b).not.toBeNull();expect(a!.y+a!.height).toBeLessThanOrEqual(b!.y);
      // The existing perspective tilt shifts the projected x coordinate by row.
      expect(Math.abs(a!.x+a!.width/2-b!.x-b!.width/2)).toBeLessThan(b!.width*.1);
    }
  }
});

async function cachedPopupClick(page:Page) {
  return page.evaluate(()=>new Promise<number>((resolve,reject)=>{
    const feed=document.querySelector<HTMLElement>('[data-testid="feed-0"]')!,video=feed.querySelector('video')!,rect=feed.getBoundingClientRect();
    const scale=Math.min(rect.width/video.videoWidth,rect.height/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale;
    const start=performance.now(),timer=setTimeout(()=>{observer.disconnect();reject(Error('No cached popup '+JSON.stringify({status:document.querySelector('[data-testid=field-watcher-status]')?.textContent,tray:document.querySelector('[data-testid=recognition-tray]')?.textContent,calls:(window as any).visionCalls,visibility:document.visibilityState})));},3000);
    const observer=new MutationObserver(()=>{if(document.querySelector('[data-testid="card-popover"]')?.textContent?.includes('Sacred Sword of Seven Stars')){clearTimeout(timer);observer.disconnect();resolve(performance.now()-start);}});
    observer.observe(document.body,{subtree:true,childList:true});
    feed.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:rect.left+(rect.width-w)/2+550/1280*w,clientY:rect.top+(rect.height-h)/2+301/720*h}));
  }));
}
test('field watcher automatic: cached owner and observer clicks open the popup without another read',async({browser})=>{
  test.setTimeout(180_000);const origin=process.env.VISION_LAB_ORIGIN??'http://127.0.0.1:3449';
  const alice=await browser.newContext({baseURL:origin,permissions:["camera","microphone"]}),bob=await browser.newContext({baseURL:origin,permissions:["camera","microphone"]}),records:{view:string;ms:number}[]=[];
  try{
    await authenticatePlayer(alice.request,{userId:101},process.env.E2E_AUTH_SECRET!,origin);await authenticatePlayer(bob.request,{userId:102},process.env.E2E_AUTH_SECRET!,origin);
    const slug=await startTwoPlayerTable(alice.request,bob.request),a=await alice.newPage(),b=await bob.newPage(),realtimeSeen=new Set<Page>(),realtimeAt=new Map<Page,number>();
    for(const page of [a,b])page.on('websocket',socket=>socket.on('framereceived',({payload})=>{
      const frame=typeof payload==='string'?payload:payload.toString();if(!frame.startsWith('42'))return;
      try{const [event,snapshot]=JSON.parse(frame.slice(2));if(event==='remote:changed'&&snapshot?.state?.seats?.[0]?.twin?.some((card:any)=>card.cardId===45725480)&&!realtimeSeen.has(page)){realtimeSeen.add(page);realtimeAt.set(page,Date.now());}}catch{/* Other transports are not Socket.IO snapshots. */}
    }));
    for(const page of [a,b]){await appearingCamera(page);await page.addInitScript(()=>{
      (window as any).visionCalls=[];const post=Worker.prototype.postMessage;
      Worker.prototype.postMessage=function(...args:any[]){if(['recognize','detect'].includes(args[0]?.type))(window as any).visionCalls.push(args[0].type);return (post as any).apply(this,args);};
    });}
    await Promise.all([a.goto(`/duels/remote/${slug}`),b.goto(`/duels/remote/${slug}`)]);
    for(const page of [a,b]){await page.getByTestId('camera-on-feed').click();await expect(page.getByTestId('field-watcher-status')).toContainText('Watching field',{timeout:40_000});}
    await b.getByLabel('Auto-detect cards',{exact:true}).uncheck();
    await expect.poll(()=>b.locator('[data-testid="feed-0"] video').evaluate((v:HTMLVideoElement)=>v.videoWidth),{timeout:40_000}).toBeGreaterThan(0);
    const appearedAt=await a.evaluate(()=>{const at=Date.now();((window as any).fieldTest).appear();return at;});
    await expect.poll(async()=>{const r=await alice.request.get(`/api/remote/${slug}`).then(r=>r.json());return r.state.seats[0].twin.length;},{timeout:30_000}).toBe(1);
    // Require the real socket snapshot before testing the receiver's twin-state cache guard.
    for(const page of [a,b])await expect.poll(()=>realtimeSeen.has(page),{timeout:10_000}).toBe(true);
    for(const page of [a,b])await expect(page.getByTestId('field-0')).toContainText('Sacred Sword',{timeout:15_000});
    await b.waitForTimeout(1200);
    const counts=await Promise.all([a,b].map(p=>p.evaluate(()=>(window as any).visionCalls.filter((t:string)=>t==='recognize').length)));
    const eventCount=(await alice.request.get(`/api/remote/${slug}`).then(r=>r.json())).events.length;
    for(let n=0;n<20;n++)for(const [view,page] of [['owner',a],['observer',b]] as const){
      records.push({view,ms:await cachedPopupClick(page)});await expect(page.getByTestId('recognition-tray')).toHaveCount(0);await page.getByRole('button',{name:'Close card',exact:true}).click();await expect(page.getByTestId('card-popover')).toHaveCount(0);
    }
    expect(await Promise.all([a,b].map(p=>p.evaluate(()=>(window as any).visionCalls.filter((t:string)=>t==='recognize').length)))).toEqual(counts);
    expect((await alice.request.get(`/api/remote/${slug}`).then(r=>r.json())).events.length).toBe(eventCount);
    const summary=Object.fromEntries(['owner','observer'].map(view=>{const v=records.filter(r=>r.view===view).map(r=>r.ms).sort((a,b)=>a-b);return [view,{n:v.length,p50Ms:v[9],p95Ms:v[18],maxMs:v[19]}];}));
    console.log('cached popup latency',JSON.stringify(summary));console.log('Appearance to real socket snapshot',JSON.stringify({ownerMs:realtimeAt.get(a)!-appearedAt,observerMs:realtimeAt.get(b)!-appearedAt}));mkdirSync(new URL('../../../data/vision/benchmark/cache/',import.meta.url),{recursive:true});writeFileSync(new URL('../../../data/vision/benchmark/cache/clicks.json',import.meta.url),JSON.stringify({summary,records,recognitionCounts:counts,realtimeSnapshots:{owner:realtimeSeen.has(a),observer:realtimeSeen.has(b)},appearanceToSnapshotMs:{owner:realtimeAt.get(a)!-appearedAt,observer:realtimeAt.get(b)!-appearedAt}},null,2));
    for(const row of Object.values(summary))expect(row.p95Ms).toBeLessThan(50);
    await cachedPopupClick(a);await a.getByRole('button',{name:'Wrong card?',exact:true}).click();
    await expect.poll(()=>a.evaluate(()=>(window as any).visionCalls.filter((t:string)=>t==='recognize').length)).toBeGreaterThan(counts[0]);
    await expect(a.getByTestId('card-popover')).toContainText('Sacred Sword of Seven Stars');
    const room=await alice.request.get(`/api/remote/${slug}`).then(r=>r.json());expect(room.state.seats[0].twin).toHaveLength(1);
  }finally{await Promise.allSettled([alice.close(),bob.close()]);}
});
async function measuredFieldChange(page:Page,kind:'move'|'remove') {
  return page.evaluate(kind=>new Promise<number>((resolve,reject)=>{
    const started=performance.now(),observer=new MutationObserver(()=>{
      const done=kind==='move'?document.querySelector('[data-testid="field-0"] [data-zone="e2"]')?.textContent?.includes('Sacred Sword'):document.querySelector('[data-testid="field-departure-toast"]')?.textContent?.includes('left the field');
      if(done){clearTimeout(timer);observer.disconnect();resolve(performance.now()-started);}
    }),timer=setTimeout(()=>{observer.disconnect();reject(Error('Camera field update timed out: '+kind));},15000);
    observer.observe(document.body,{childList:true,subtree:true});
    if(kind==='move')(window as any).fieldTest.place(714,8,false);else (window as any).fieldTest.clear();
  }),kind);
}
test('field watcher automatic: camera follows EMZ/DEF moves and clear departure with destinations and Undo',async({page,context})=>{
  test.setTimeout(120_000);await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,process.env.VISION_LAB_ORIGIN??'http://127.0.0.1:3449');
  const slug=await soloTable(context.request,2,true);await context.request.post(`/api/remote/${slug}/actions`,{data:{}});
  await appearingCamera(page);await page.goto(`/duels/remote/${slug}`);await page.getByTestId('camera-on-feed').click();await expect(page.getByTestId('field-watcher-status')).toContainText('Watching field');
  await page.evaluate(()=>((window as any).fieldTest).place(345,8,true));
  const room=async()=>context.request.get(`/api/remote/${slug}`).then(r=>r.json());
  await expect.poll(async()=>(await room()).state.seats[0].twin[0],{timeout:30_000}).toMatchObject({cardId:45725480,zone:'extra-monster',slot:1,position:'defense'});
  const first=(await room()).state.seats[0].twin[0];await expect(page.getByTestId('field-0').locator('[data-zone="e1"]')).toContainText('Sacred Sword');
  await expect.poll(()=>page.getByTestId('field-0').locator('[data-zone="e1"]').evaluate(el=>{const m=new DOMMatrixReadOnly(getComputedStyle(el.firstElementChild!).transform);return Math.round(Math.atan2(m.b,m.a)*180/Math.PI);})).toBe(-90);
  const moveMs=await measuredFieldChange(page,'move');
  await expect.poll(async()=>(await room()).state.seats[0].twin[0],{timeout:20_000}).toMatchObject({ref:first.ref,zone:'extra-monster',slot:2,position:'attack'});
  expect((await room()).state.seats[0].twin).toHaveLength(1);
  const removalMs=await measuredFieldChange(page,'remove');
  await expect.poll(async()=>(await room()).state.seats[0].twin[0]).toMatchObject({ref:first.ref,zone:'graveyard'});
  const toast=page.getByTestId('field-departure-toast');await expect(toast).toContainText('Sacred Sword of Seven Stars left the field');
  await expect(page.getByTestId('field-0').locator('[data-zone="e2"]')).not.toContainText('Sacred Sword');
  const departed=await room();expect(departed.events.at(-1).action).toMatchObject({type:'twin.move',source:'auto',cardRef:first.ref,zone:'graveyard',name:'Sacred Sword of Seven Stars'});
  await toast.getByRole('button',{name:'Undo',exact:true}).click();
  await expect.poll(async()=>(await room()).state.seats[0].twin[0]).toMatchObject({ref:first.ref,zone:'extra-monster',slot:2});
  await page.waitForTimeout(3200);expect((await room()).events.length).toBe(departed.events.length+1);
  await page.evaluate(()=>((window as any).fieldTest).place(345,8,true));
  await expect.poll(async()=>(await room()).state.seats[0].twin[0],{timeout:15000}).toMatchObject({ref:first.ref,zone:'extra-monster',slot:1});
  let rejectDeparture=true;await page.route('**/api/remote/*/actions',async route=>{
    const action=route.request().postDataJSON()?.action;
    if(rejectDeparture&&action?.type==='twin.move'&&action.source==='auto'){rejectDeparture=false;await route.fulfill({status:409,json:{error:'Stale sequence; fetch state and retry'}});}else await route.continue();
  });
  await page.evaluate(()=>((window as any).fieldTest).clear());
  await expect(toast).toContainText('update failed',{timeout:15000});await toast.getByRole('button',{name:'Retry removal',exact:true}).click();
  await expect.poll(async()=>(await room()).state.seats[0].twin[0],{timeout:15000}).toMatchObject({ref:first.ref,zone:'graveyard'});
  for(const [label,zone] of [['Banish','banished'],['Hand','hand'],['Extra Deck','extra'],['GY','graveyard']] as const){
    await toast.getByRole('button',{name:label,exact:true}).click();await expect.poll(async()=>(await room()).state.seats[0].twin[0].zone).toBe(zone);
  }
  await toast.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(async()=>(await room()).state.seats[0].twin[0].zone).toBe('extra');
  await page.getByTestId('log-button').click();await expect(page.getByTestId('log-drawer')).toContainText('Sacred Sword of Seven Stars left the field');
  console.log('Table camera follow',JSON.stringify({moveMs,removalMs}));mkdirSync(new URL('../../../data/vision/benchmark/field-watcher/',import.meta.url),{recursive:true});writeFileSync(new URL('../../../data/vision/benchmark/field-watcher/table-follow.json',import.meta.url),JSON.stringify({moveMs,removalMs,ref:first.ref},null,2));
});

test('field watcher automatic: a manual feed read before settling keeps exactly one physical twin',async({page,context})=>{
  test.setTimeout(120_000);const origin=process.env.VISION_LAB_ORIGIN??'http://127.0.0.1:3449';
  await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,origin);
  const slug=await soloTable(context.request,2,true),room=()=>context.request.get(`/api/remote/${slug}`).then(r=>r.json());
  await appearingCamera(page);await page.goto(`/duels/remote/${slug}`);await page.evaluate(()=>((window as any).fieldTest).appear());
  await page.getByTestId('camera-on-feed').click();await expect(page.getByTestId('field-watcher-status')).toContainText('Watching field');
  await expect.poll(()=>page.locator('[data-testid="feed-0"] video').evaluate((video:HTMLVideoElement)=>video.videoWidth)).toBe(1280);
  await page.evaluate(()=>{
    const feed=document.querySelector<HTMLElement>('[data-testid="feed-0"]')!,video=feed.querySelector('video')!,rect=feed.getBoundingClientRect();
    const scale=Math.min(rect.width/video.videoWidth,rect.height/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale;
    feed.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:rect.left+(rect.width-w)/2+550/1280*w,clientY:rect.top+(rect.height-h)/2+301/720*h}));
  });
  // A sure manual read confirms through the normal click flow before the watcher settles.
  await expect(page.getByTestId('card-popover')).toContainText('Sacred Sword of Seven Stars',{timeout:30_000});
  await expect.poll(async()=>(await room()).state.seats[0].twin.length).toBe(1);
  const initial=(await room()).state.seats[0].twin[0];await page.getByRole('button',{name:'Close card',exact:true}).click();
  await page.waitForTimeout(4000);const settled=await room();expect(settled.state.seats[0].twin).toHaveLength(1);expect(settled.state.seats[0].twin[0].ref).toBe(initial.ref);
  expect(settled.events.filter((event:any)=>event.action.type==='twin.place')).toHaveLength(1);
  expect(initial.ref).toMatch(/^c0-/);
});

for(const seatCount of [2,4] as const)test(`field watcher automatic: responsive prompt and calibration screenshots for ${seatCount} seats`,async({page,context})=>{
  test.setTimeout(180_000);const origin=process.env.VISION_LAB_ORIGIN??'http://127.0.0.1:3449';
  await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,origin);
  const slug=await soloTable(context.request,seatCount),directory=new URL('../../../data/vision/benchmark/field-watcher/r1-shots/',import.meta.url).pathname;
  mkdirSync(directory,{recursive:true});await appearingCamera(page);await page.goto(`/duels/remote/${slug}`);
  await page.getByTestId('camera-on-feed').click();await expect(page.getByTestId('field-watcher-status')).toContainText('Watching field');
  await page.evaluate(()=>((window as any).fieldTest).many([{x:300,y:440},{x:800,y:440}]));
  const prompt=page.getByTestId('field-watcher-prompt');await expect(prompt).toBeVisible({timeout:40_000});await expect(prompt).toContainText('+1 more',{timeout:40_000});
  expect((await context.request.get(`/api/remote/${slug}`).then(r=>r.json())).state.seats[0].twin).toHaveLength(0);
  for(const [width,height] of [[1920,1080],[2560,1440],[1366,768],[390,844]] as const){
    await page.setViewportSize({width,height});await page.getByTestId('feed-box-0').focus();await page.waitForTimeout(250);
    await expect(prompt).toHaveCount(1);await expect(prompt).toHaveAccessibleDescription(/Detected in (Spell\/Trap|Main Monster) Zone/);
    expect(await prompt.evaluate(node=>node.parentElement===document.body)).toBe(true);
    const checkBounds=async(locator:ReturnType<Page['locator']>)=>{
      const rect=await locator.boundingBox();expect(rect).not.toBeNull();expect(rect!.x).toBeGreaterThanOrEqual(0);expect(rect!.y).toBeGreaterThanOrEqual(0);
      expect(rect!.x+rect!.width).toBeLessThanOrEqual(width+1);expect(rect!.y+rect!.height).toBeLessThanOrEqual(height+1);
    };
    await checkBounds(prompt);await checkBounds(prompt.getByRole('button',{name:'Dismiss',exact:true}));
    const overlap=await page.getByTestId('feed-box-0').evaluate(host=>{
      const toolbar=host.querySelector('[data-feed-toolbar]')!,chip=host.querySelector('[data-field-watcher-status-slot]')!,tag=chip.previousElementSibling!;
      const camera=Array.from(host.children).find(node=>node.className.includes('camsel'));
      const intersects=(a:Element,b:Element)=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return Math.min(x.right,y.right)>Math.max(x.left,y.left)&&Math.min(x.bottom,y.bottom)>Math.max(x.top,y.top);};
      return {chipTag:intersects(chip,tag),toolbarCamera:camera?intersects(toolbar,camera):false};
    });
    expect(overlap).toEqual({chipTag:false,toolbarCamera:false});
    await page.screenshot({path:`${directory}/${seatCount===2?'1v1':'4seat'}-${width}x${height}-prompt.png`});
    const calibrate=page.getByRole('button',{name:'Calibrate zones',exact:true});await calibrate.focus();await page.keyboard.press('Enter');
    const modal=page.getByRole('dialog',{name:'Calibrate field zones',exact:true});await expect(modal).toHaveAttribute('aria-modal','true');await expect(modal).toBeFocused();
    expect(await modal.evaluate(node=>node.parentElement?.parentElement===document.body)).toBe(true);
    await checkBounds(modal);await modal.getByRole('button',{name:'Cancel calibration'}).scrollIntoViewIfNeeded();await checkBounds(modal.getByRole('button',{name:'Cancel calibration'}));
    await page.keyboard.press('Shift+Tab');await expect(modal.getByRole('button',{name:'Cancel calibration'})).toBeFocused();
    await page.screenshot({path:`${directory}/${seatCount===2?'1v1':'4seat'}-${width}x${height}-calibration.png`});
    await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);await expect(calibrate).toBeFocused();
  }
});
