import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { projectRemoteState } from "@yugidraft/shared/remote";
import { authenticatePlayer } from "../stack/login-auth.mjs";
import { startTwoPlayerTable } from "./remote-table";
import { pickSelect } from "../helpers/themed-select";
import Database from "better-sqlite3";
import { io } from "socket.io-client";

// The default view follows the detection mode (Auto shows the virtual field, Tap to identify hides it). These tests use the board, so a browser with no saved choice starts in Both view.
const bothView = (context: BrowserContext) => context.addInitScript(() => { if (localStorage.getItem("dd-remote-webcam-only") === null) localStorage.setItem("dd-remote-webcam-only", "0"); });
test.beforeEach(async ({ context }) => { await bothView(context); });

const SHOTS = process.env.E2E_SHOTS ?? "";
// A still picture of two cards on a table, served as the camera. Chrome's fake-file camera is not reliable between tests.
const FRAME = process.env.E2E_FAKE_FRAME ? readFileSync(process.env.E2E_FAKE_FRAME).toString("base64") : "";
// Tests that need something this stack may not have are skipped with the reason, not left to fail.
const reachable = (host: string, port: number) => new Promise<boolean>(resolve => {
  const socket = connect({ host, port }); const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
  socket.setTimeout(1000, () => done(false)); socket.once("connect", () => done(true)); socket.once("error", () => done(false));
});
const VISION_LAB = new URL(process.env.VISION_LAB_ORIGIN ?? "http://127.0.0.1:3449");
const LIVEKIT = new URL((process.env.LIVEKIT_URL ?? "ws://127.0.0.1:7880").replace(/^ws/, "http"));
const defaultPort = (url: URL) => Number(url.port || (url.protocol === "https:" ? 443 : 80));
const HAVE_VISION_LAB = await reachable(VISION_LAB.hostname, defaultPort(VISION_LAB));
const HAVE_LIVEKIT = await reachable(LIVEKIT.hostname, defaultPort(LIVEKIT));
// Vision data: the web server reads VISION_DATA_DIR, or data/vision at the repo root.
const HAVE_VISION_DATA = !!process.env.VISION_DATA_DIR || existsSync(new URL("../../../data/vision", import.meta.url));
const NEED_FIXTURES = "needs the field watcher card pictures (E2E_AUTO_CARD and E2E_EXTRA_CARD, default data/vision/benchmark/field-watcher)";
const NEED_LAB = `needs the vision lab at ${VISION_LAB.origin} (VISION_LAB_ORIGIN)`;
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

async function soloTable(api: APIRequestContext, seatCount: 2 | 3 | 4, registeredDeck=false, bestOf: 1 | 3 = 1) {
  const created = await api.post("/api/remote", { data: { gameId: "ygo", seatCount, solo: true, bestOf } });
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
  test.beforeEach(async ({ context }) => { await authenticatePlayer(context.request, { userId: 101 }, process.env.E2E_AUTH_SECRET!, "http://localhost:3310"); });

  test("Scan field button beside the board and the S key", async ({ page, context }) => {
    test.setTimeout(120_000);
    const slug = await soloTable(context.request, 2);
    await fakeCamera(page);
    await page.goto(`/duels/remote/${slug}`);
    const scan = page.getByTestId("field-scan");
    await expect(scan).toBeVisible(); await expect(scan).toHaveAttribute("aria-disabled", "true"); await expect(scan).toContainText("Camera off");
    await page.getByTestId("camera-on-feed").click();
    await expect(scan).toHaveAttribute("aria-disabled", "false", { timeout: 30_000 });
    await scan.evaluate(button => { const w = window as unknown as { __scanSeen: boolean }; w.__scanSeen = false; new MutationObserver(() => { if (button.textContent?.includes("Scanning")) w.__scanSeen = true; }).observe(button, { childList: true, subtree: true, characterData: true }); });
    await page.keyboard.press("s");
    await expect.poll(() => page.evaluate(() => (window as unknown as { __scanSeen: boolean }).__scanSeen)).toBe(true);
    await expect(scan).toContainText("Scan field");
  });

  test("1v1 table: phase rail, LP, undo, drawers", async ({ page, context }) => {
    const slug = await soloTable(context.request, 2);
    await page.goto(`/duels/remote/${slug}`);
    await expect(page.getByTestId("remote-table")).toBeVisible();
    await expect(page.getByTestId("remote-table")).toHaveAttribute("data-mode", "1v1");
    await shot(page, "1v1-1920-initial");
    // The turn and phase bar sits under the player panels, at the bottom of the table.
    const [seatBox, phaseBox] = await Promise.all([page.getByTestId("seat-0").boundingBox(), page.getByTestId("phase-main1").boundingBox()]);
    expect(phaseBox!.y).toBeGreaterThan(seatBox!.y + seatBox!.height);
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

  test("click on the live feed opens the card popup, it stays open while the card is read, Esc closes it", async ({ page, context }) => {
    test.skip(!FRAME || !HAVE_VISION_DATA, "needs a camera picture of cards (E2E_FAKE_FRAME) and vision data (VISION_DATA_DIR)");
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
    // It stays open for at least 3 s while the card is read, even with nothing else happening.
    for (let i = 0; i < 6; i++) { await page.waitForTimeout(500); await expect(popup).toBeVisible(); }
    expect(await page.evaluate(() => (window as unknown as { __layerLog: string[] }).__layerLog)).toEqual([]);
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

  test("best of 3: a result can be undone from the result screen", async ({ page, context }) => {
    const slug = await soloTable(context.request, 2, false, 3);
    await page.goto(`/duels/remote/${slug}`);
    await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
    const room = await (await context.request.get(`/api/remote/${slug}`)).json();
    const ended = await context.request.post(`/api/remote/${slug}/actions`, { data: { baseSeq: room.lastSeq, action: { type: "player.concede", actorSeat: 0, idempotencyKey: crypto.randomUUID() } } });
    expect(ended.status(), await ended.text()).toBe(200);
    await expect(page.getByTestId("match-result")).toBeVisible({ timeout: 15_000 });
    await shot(page, "match-result-undo-1920");
    await page.getByTestId("match-undo").click();
    await expect(page.getByTestId("match-result")).toHaveCount(0);
  });

  test("surrender: the top bar button and the Deck menu ask first, then the game ends for both players; LP 0 ends it too", async ({ browser, context }) => {
    test.setTimeout(300_000);
    const url = process.env.E2E_REMOTE_UI_URL!;
    const alice = await browser.newContext({ baseURL: url }); const bob = await browser.newContext({ baseURL: url });
    try {
      for (const [who, userId] of [[alice, 101], [bob, 102]] as const) { await authenticatePlayer(who.request, { userId }, process.env.E2E_AUTH_SECRET!, url); await bothView(who); }
      const slug = await startTwoPlayerTable(alice.request, bob.request);
      const a = await alice.newPage(); const b = await bob.newPage();
      // A cold dev server can time out the first table request, so each page loads again until the table shows.
      for (const page of [a, b]) await expect(async () => { await page.goto(`/duels/remote/${slug}`); await expect(page.getByTestId("rail")).toBeVisible({ timeout: 15_000 }); }).toPass({ timeout: 150_000 });
      await shot(a, "surrender-1-button");
      if (SHOTS) {
        for (const [w, h] of [[1366, 768], [1024, 768], [390, 844], [375, 812], [360, 740]]) {
          await a.setViewportSize({ width: w, height: h }); await a.waitForTimeout(500);
          await expect(a.getByTestId("surrender-button")).toBeVisible(); await shot(a, `surrender-1-button-${w}`);
          // The flag sits fully inside the screen.
          expect(await a.getByTestId("surrender-button").evaluate(el => el.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
          // The leave group sits inside the screen and covers no other header item.
          expect(await a.getByTestId("leave-group").evaluate(el => {
            const r = el.getBoundingClientRect(); const header = el.parentElement!;
            const hit = Array.from(header.children).filter(c => c !== el && c.getBoundingClientRect().width > 0 && getComputedStyle(c).display !== "none").some(c => { const o = c.getBoundingClientRect(); return o.left < r.right - 0.5 && o.right > r.left + 0.5 && o.top < r.bottom - 0.5 && o.bottom > r.top + 0.5; });
            return !hit && r.left >= 0 && r.right <= window.innerWidth;
          })).toBe(true);
          // During a game there is no way to leave the whole match: Surrender only loses this game.
          await expect(a.getByTestId("quit-button")).toHaveCount(0);
          await a.getByTestId("surrender-button").click(); await shot(a, `surrender-2-confirm-${w}`); await a.getByTestId("surrender-no").click();
          await a.locator('[data-zone="deck"][data-seat="0"]').click(); await shot(a, `surrender-3-deck-menu-${w}`); await a.keyboard.press("Escape");
        }
        await a.setViewportSize({ width: 1920, height: 1080 });
      }
      // Cancel keeps the game.
      await a.getByTestId("surrender-button").click();
      await expect(a.getByTestId("surrender-game")).toHaveText("Game 1 of 3");
      await shot(a, "surrender-2-confirm");
      await a.getByTestId("surrender-no").click();
      await expect(a.getByTestId("surrender-confirm")).toHaveCount(0);
      await expect(a.getByTestId("match-result")).toHaveCount(0);
      // My Deck on the virtual field opens a menu with the same question.
      await a.locator('[data-zone="deck"][data-seat="0"]').click();
      await expect(a.getByTestId("deck-menu")).toBeVisible();
      await shot(a, "surrender-3-deck-menu");
      await a.getByTestId("deck-menu-surrender").click();
      await expect(a.getByTestId("surrender-confirm")).toBeVisible();
      await expect(a.getByTestId("surrender-confirm")).toContainText("Side decking starts next");
      await a.getByTestId("surrender-yes").click();
      // Both players see the end of the game; the loser sees it as a defeat.
      await expect(a.getByTestId("match-result")).toContainText("Defeat", { timeout: 15_000 });
      await expect(b.getByTestId("match-result")).toContainText("Victory", { timeout: 15_000 });
      await expect(b.getByTestId("match-reason")).toContainText("conceded");
      await shot(a, "surrender-4-end-loser"); await shot(b, "surrender-5-end-winner");
      await expect(a.getByTestId("surrender-button")).toHaveCount(0);
      if (SHOTS) for (const [w, h] of [[1366, 768], [390, 844]]) { await a.setViewportSize({ width: w, height: h }); await a.waitForTimeout(400); await expect(a.getByTestId("dock-quit")).toBeVisible(); await shot(a, `quit-result-${w}`); }
      await a.setViewportSize({ width: 1920, height: 1080 });
      // The match goes on to side decking. There, with nobody ready, the loser quits the match: it asks first, the other player wins and the table ends.
      // The fixture cards have no art. Their image requests never end, and a browser runs only a few requests at once, so they would hold back the Quit request.
      for (const page of [a, b]) await page.route("**/api/cards/*/image*", route => route.abort());
      await a.getByTestId("match-continue").click();
      await expect(a.getByTestId("siding")).toBeVisible({ timeout: 15_000 });
      if (SHOTS) for (const [w, h] of [[1920, 1080], [1366, 768], [390, 844], [360, 740]]) { await a.setViewportSize({ width: w, height: h }); await a.waitForTimeout(400); await expect(a.getByTestId("dock-quit")).toBeVisible(); await shot(a, `quit-siding-${w}`); }
      await a.setViewportSize({ width: 1920, height: 1080 });
      await a.getByTestId("dock-quit").click();
      await expect(a.getByTestId("quit-yes")).toBeVisible();
      await a.getByTestId("quit-yes").click();
      await expect(b.getByTestId("match-kicker")).toHaveText("Match over", { timeout: 15_000 });
      await expect(b.getByTestId("table-ended")).toContainText("left the match");
    } finally { await alice.close(); await bob.close(); }
    // A solo test table: the same button ends the game. Setting a seat to 0 LP ends a game on a table that is not in a tournament.
    const solo = await soloTable(context.request, 2);
    const page = await context.newPage();
    await page.goto(`/duels/remote/${solo}`);
    await expect(page.getByTestId("rail")).toBeVisible({ timeout: 30_000 });
    // The Deck menu of the other seat gives up that seat, and the question names it.
    await page.locator('[data-zone="deck"][data-seat="1"]').click();
    await page.getByTestId("deck-menu-surrender").click();
    await expect(page.getByTestId("surrender-confirm")).toContainText("Test Bot 1");
    await page.getByTestId("surrender-yes").click();
    await expect(page.getByTestId("match-result")).toContainText("Game over", { timeout: 15_000 });
    const soloRoom = await (await context.request.get(`/api/remote/${solo}`)).json();
    expect(soloRoom.state.seats.map((seat: { eliminated?: boolean }) => !!seat.eliminated)).toEqual([false, true]);
    const lpTable = await soloTable(context.request, 2);
    const room = await (await context.request.get(`/api/remote/${lpTable}`)).json();
    const lpDown = await context.request.post(`/api/remote/${lpTable}/actions`, { data: { baseSeq: room.lastSeq, action: { type: "lp.change", actorSeat: 0, seat: 1, delta: -8000, reason: "test", idempotencyKey: crypto.randomUUID() } } });
    expect(lpDown.ok(), await lpDown.text()).toBe(true);
    await page.goto(`/duels/remote/${lpTable}`);
    await expect(page.getByTestId("match-result")).toBeVisible({ timeout: 30_000 });
    await shot(page, "surrender-6-lp-zero");
  });

  // Camera / field swap: per viewer and per seat, animated, remembered, keyboard reachable, and cards keep their own click.
  for (const [count, mode] of [[2, "1v1"]] as [2 | 3 | 4, string][]) {
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

  test("F freezes the frame and outlines the cards", async ({ page, context }) => {
    test.skip(!FRAME || !HAVE_VISION_DATA, "needs a camera picture of cards (E2E_FAKE_FRAME) and vision data (VISION_DATA_DIR)");
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

  test("zone grid on my camera: shown while the zones need calibration, with a Calibrate link, follows the video through a swap, the toggle is off by default and remembered", async ({ page, context }) => {
    test.setTimeout(120_000);
    const slug = await soloTable(context.request, 2);
    await fakeCamera(page);
    await page.goto(`/duels/remote/${slug}`);
    await page.getByTestId("camera-on-feed").click();
    const video = page.locator('[data-testid="feed-0"] video');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    const dialog = page.getByRole("dialog", { name: "Calibrate field zones" });
    const grid = page.locator('[data-testid="feed-0"] [data-testid="zone-grid"]');
    // The Master Rule zones, with the two Extra Monster Zones for a normal table, outlined and labelled.
    await expect(grid).toBeVisible();
    await expect(grid).toHaveAttribute("data-calibrated", "false");
    for (const zone of ["FIELD", "M1", "M5", "GY", "EXTRA", "S3", "DECK", "EMZ1", "EMZ2"]) await expect(grid.locator(`polygon[data-zone="${zone}"]`)).toHaveCount(1);
    // One Calibrate zones button, in the feed toolbar (it shows on hover): the feed itself carries no second one.
    const calibrate = page.getByRole("button", { name: "Calibrate zones", exact: true }); await expect(calibrate).toHaveCount(1); await expect(page.locator('[data-testid="feed-0"]').getByRole("button", { name: "Default grid · Calibrate" })).toHaveCount(0);
    // The grid sits exactly on the video, before and after the camera and the field swap places.
    const gap = async () => { const [g, v] = await Promise.all([grid.boundingBox(), video.boundingBox()]); return Math.abs(g!.x - v!.x) + Math.abs(g!.y - v!.y) + Math.abs(g!.width - v!.width) + Math.abs(g!.height - v!.height); };
    expect(await gap()).toBeLessThan(6); await shot(page, "zone-grid-default");
    await page.getByTestId("fwrap-0").click({ position: { x: 4, y: 4 } });
    await expect(page.getByTestId("seat-0")).toHaveAttribute("data-view", "field");
    await expect(grid).toBeVisible();
    await expect.poll(gap, { timeout: 3_000 }).toBeLessThan(6);
    // The calibrate controls cover the small camera while the zones need calibration, so this uses the header button.
    await page.getByTestId("view-toggle-0").click();
    await expect(page.getByTestId("seat-0")).toHaveAttribute("data-view", "camera");
    await expect.poll(gap, { timeout: 3_000 }).toBeLessThan(6);
    // The Calibrate zones button opens the calibration, which draws the same zones to drag into place.
    await page.getByTestId("feed-box-0").hover(); await calibrate.click();
    await expect(dialog).toBeVisible();
    for (const zone of ["M1", "S5", "EMZ1"]) await expect(dialog.locator(`polygon[data-zone="${zone}"]`)).toHaveCount(1);
    await dialog.getByRole("button", { name: "Cancel calibration" }).click();
    await expect(dialog).toBeHidden();
    // The toggle starts off, and on stays on for this device; the opponent feed starts without a grid.
    const toggle = page.getByTestId("zone-grid-toggle").first();
    await page.getByTestId("feed-box-0").hover();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await page.getByTestId("camera-on-feed").click();
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    await page.getByTestId("feed-box-0").hover();
    await expect(page.getByTestId("zone-grid-toggle").first()).toHaveAttribute("aria-pressed", "true");
    await expect(grid).toBeVisible();
    await expect(page.locator('[data-testid="feed-1"] [data-testid="zone-grid"]')).toHaveCount(0);
  });

  // Master Rule 5 field: two Extra Monster Zones above the main row, shared with the facing seat.
  test("virtual field shows Extra Monster Zones and Pendulum labels", async ({ page, context }) => {
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
  });

  // The feed box takes the camera's real shape, the camera row sits under it, and the virtual field is smaller.
  for (const [width, height, label] of [[1366, 768, "1366"]] as const) {
    for (const [count, mode] of [[2, "1v1"]] as [2 | 3 | 4, string][]) {
      for (const shape of ["16:9"] as const) for (const view of ["Both", "Webcam only"] as const) {
        test(`video box matches the camera and controls fit: ${label} ${mode} ${shape} ${view}`, async ({ page, context }) => {
          test.setTimeout(120_000);
          await page.setViewportSize({ width, height });
          const slug = await soloTable(context.request, count);
          await fakeCamera(page, shape);
          // Both keeps the virtual field on, so the camera must still hold its share of the seat. Webcam only has no field.
          await page.addInitScript(on => { try { localStorage.setItem("dd-remote-webcam-only", on ? "1" : "0"); } catch { /* storage blocked */ } }, view === "Webcam only");
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
            if (view === "Both") expect(on.holo).toBeTruthy();
            if (view === "Both") expect(on.holo!.w).toBeLessThan(on.seat!.w * (mode === "3" ? 1.01 : 0.7));
            if (view === "Both" && mode !== "4") expect(on.holo!.h).toBeLessThan(on.seat!.h * (mode === "3" ? 0.5 : 0.36));
            expect(on.lpFont).toBeLessThanOrEqual(42);
            if (mode === "1v1") expect(on.lp!.h).toBeLessThanOrEqual(60);
          }
          // No bars: the box has the video's shape (2% tolerance for rounding).
          expect(Math.abs(m.box!.w / m.box!.h - m.vw / m.vh) / (m.vw / m.vh)).toBeLessThan(0.02);
          // Controls: one row under the video, inside the window, not over the box.
          expect(m.row!.y).toBeGreaterThanOrEqual(m.box!.y + m.box!.h - 1);
          expect(m.row!.x).toBeGreaterThanOrEqual(-1); expect(m.row!.x + m.row!.w).toBeLessThanOrEqual(width + 1);
          expect(m.row!.y + m.row!.h).toBeLessThanOrEqual(height + 1);
          const clipped = await page.getByTestId("camera-row").evaluate(row => [...row.querySelectorAll("button,select")].some(b => { const r = b.getBoundingClientRect(); const o = row.getBoundingClientRect(); return r.width > 0 && (r.right > o.right + 1 || r.left < o.left - 1); })); // the closed Settings panel keeps hidden controls in the row
          expect(clipped).toBe(false);
          // Scan field and Token sit in free space: not over the board's zones, the camera row buttons or the Hand -/+ buttons.
          const clashes = await page.evaluate(() => {
            const seat = document.querySelector('[data-testid="seat-0"]')!;
            const box = (e: Element | null | undefined) => e?.getBoundingClientRect();
            const hit = (a: DOMRect, b: DOMRect) => b.width > 0 && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
            const movers = [["Scan field", seat.querySelector('button[aria-keyshortcuts="S"]')], ["Token", seat.querySelector('[data-testid="token-open-0"]')]] as const;
            const others = [["board", document.querySelector('[data-testid="field-0"]')?.closest('[class*="holo"]')], ...[...seat.querySelectorAll('[data-testid="camera-row"] button, [data-testid="camera-row"] select')].map(e => ["camera row", e] as const),
              ...[...seat.querySelectorAll('[data-testid="hand-count-0"] button')].map(e => ["Hand -/+", e] as const)] as const;
            const out: string[] = [];
            for (const [n, e] of movers) { const a = box(e); if (!a) { out.push(`${n} missing`); continue; } for (const [k, o] of others) { const b = box(o); if (b && hit(a, b)) out.push(`${n} over ${k}`); } }
            return out;
          });
          expect(clashes).toEqual([]);
          await shot(page, `feed-${label}-${mode}-${shape.replace(":", "x")}`);
        });
      }
    }
  }

});

const BASE_URL = process.env.E2E_REMOTE_UI_URL ?? "http://localhost:3310";
const remoteRadio = (page: Page) => page.locator("label", { has: page.getByRole("radio", { name: "Remote Duel" }) });
const onlineRadio = (page: Page) => page.locator("label", { has: page.getByRole("radio", { name: "Online" }) });

test.describe("remote lobby camera step", () => {
  test.beforeEach(async ({ context }) => { await authenticatePlayer(context.request, { userId: 101 }, process.env.E2E_AUTH_SECRET!, (process.env.E2E_REMOTE_UI_URL ?? "http://localhost:3310")); });

  test("webcam preview plays, the card check runs, leaving the step releases the camera", async ({ page, context }) => {
    await fakeCamera(page, "16:9");
    test.setTimeout(240_000);
    // A local camera with persistent UVC controls. Its pixels stay real browser video.
    await page.addInitScript(() => {
      const state = { reject: false, supported: sessionStorage.getItem('camlock-unsupported') !== '1', stale: false, glare: false, requests: [] as number[], controls: { exposureMode: 'continuous', whiteBalanceMode: 'continuous', focusMode: 'continuous', exposureTime: 120, colorTemperature: 4500, focusDistance: 40 }, opened: [] as MediaStream[], stopped: [] as string[] };
      Object.assign(window, { __camlock: state });
      const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080;
      const ctx = canvas.getContext('2d')!;
      const paint = () => {
        ctx.fillStyle = state.stale && state.controls.exposureMode === 'manual' ? '#151515' : '#888888'; ctx.fillRect(0, 0, 1920, 1080);
        ctx.fillStyle = '#999999'; for (let x = 0; x < 1920; x += 32) ctx.fillRect(x, 0, 4, 1080);
        if (state.glare) { ctx.fillStyle = '#ffffff'; ctx.fillRect(800, 250, 300, 300); }
      };
      setInterval(paint, 50);
      navigator.mediaDevices.getUserMedia = async constraints => {
        if (!constraints?.video) throw new DOMException('No audio fixture', 'NotFoundError');
        paint(); const stream = canvas.captureStream(30), track = stream.getVideoTracks()[0];
        const stop = track.stop.bind(track);
        track.stop = () => { state.stopped.push(state.controls.exposureMode); stop(); };
        track.getSettings = () => ({ deviceId: 'uvc-fixture', width: 1920, height: 1080, frameRate: 30, ...state.controls });
        track.getCapabilities = () => ({ width: { min: 1280, max: 1920 }, height: { min: 720, max: 1080 }, frameRate: { min: 15, max: 30 }, ...(state.supported ? { exposureMode: ['continuous','manual'], whiteBalanceMode: ['continuous','manual'], focusMode: ['continuous','manual'], exposureTime: { min: 10, max: 1000 }, colorTemperature: { min: 2000, max: 8000 }, focusDistance: { min: 0, max: 100 } } : {}) });
        track.applyConstraints = async constraints => {
          if (constraints?.width && sessionStorage.getItem('camlock-size-hang')) return new Promise<void>(() => {});
          if (state.reject && constraints?.advanced?.some(value => Object.values(value).includes('manual'))) throw new DOMException('Rejected', 'OverconstrainedError');
          for (const value of constraints?.advanced ?? []) { if ('exposureTime' in value) state.requests.push((value as any).exposureTime); Object.assign(state.controls, value); }
        };
        state.opened.push(stream); return stream;
      };
      navigator.mediaDevices.enumerateDevices = async () => [];
    });
    const created = await context.request.post("/api/remote", { data: { gameId: "ygo", seatCount: 2, solo: true } });
    expect(created.status()).toBe(201);
    await page.goto(`/duels/remote/${(await created.json()).slug}`);
    const preview = page.getByTestId("lobby-camera-preview");
    await expect(preview).toBeVisible();
    const video = page.getByTestId("lobby-cam-video");
    await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.videoWidth > 0 && !el.paused)).toBe(true);
    const lock = page.getByTestId('camera-lock'), toggle = lock.getByRole('button', { name: 'Camera lock', exact: true });
    // Next dev compiles during this step. A main-thread stall over the 1.5 s check keeps auto, so retry with Re-lock as a player does. A camera that cannot lock still fails here.
    await expect(async () => {
      if ((await lock.textContent())?.includes('auto kept')) await lock.getByRole('button', { name: 'Re-lock' }).click();
      await expect(lock).toContainText('Locked:', { timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    // A tab switch and a cancelled leave must keep the current lock.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => page.evaluate(() => (window as any).__camlock.controls.exposureMode)).toBe('manual');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('beforeunload'));
    });
    await expect(lock).toContainText('Locked:');
    await expect.poll(() => page.evaluate(() => (window as any).__camlock.controls.exposureMode)).toBe('manual');
    await page.evaluate(() => { (window as any).__camlock.glare = true; });
    await expect.poll(() => page.evaluate(() => (window as any).__camlock.requests.some((value: number) => value < 120))).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as any).__camlock.controls.exposureTime)).toBe(120);
    await page.evaluate(() => { (window as any).__camlock.glare = false; });
    await toggle.click(); await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => page.evaluate(() => (window as any).__camlock.controls.exposureMode)).toBe('continuous');
    await page.evaluate(() => { (window as any).__camlock.reject = true; });
    await toggle.click(); await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(lock).toContainText('auto kept', { timeout: 30_000 });
    expect(await page.evaluate(() => localStorage.getItem('dd-camera-lock:v1:900000000000000001:101:device:uvc-fixture'))).toBe('1');
    await toggle.click(); await page.evaluate(() => { (window as any).__camlock.reject = false; (window as any).__camlock.stale = true; });
    await toggle.click(); await expect(lock).toContainText('auto kept', { timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => (window as any).__camlock.controls.exposureMode)).toBe('continuous');
    await page.evaluate(() => { (window as any).__camlock.stale = false; });
    await lock.getByRole('button', { name: 'Re-lock' }).click(); await expect(lock).toContainText('Locked:');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect.poll(() => page.evaluate(() => (window as any).__camlock.controls.exposureMode)).toBe('continuous');
    // With talk off, only voice commands use a microphone here.
    await expect(page.getByTestId("lobby-cam-mic")).toHaveCount((process.env.REMOTE_VOICE_USERS ?? "").split(",").some(id => id.trim() === "101") ? 1 : 0);
    await expect(page.getByTestId("lobby-cam-calibrate")).toBeEnabled();
    // The card check leaves its starting state: found, none, or skipped when the reader is not installed.
    await expect(page.getByTestId("lobby-cam-check")).not.toHaveAttribute("data-state", "starting", { timeout: 60_000 });
    await shot(page, "lobby-camera-webcam");
    if (SHOTS) for (const [w, h] of [[1366, 768], [390, 844]]) { await page.setViewportSize({ width: w, height: h }); await shot(page, `lobby-camera-${w}`); }
    await page.getByRole("radio", { name: "No camera" }).click({ force: true });
    await expect(page.getByTestId("lobby-manual-note")).toBeVisible();
    await expect(video).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => ((window as any).__camlock.opened as MediaStream[]).every(s => s.getTracks().every(track => track.readyState === "ended")))).toBe(true);
    expect(await page.evaluate(() => (window as any).__camlock.stopped.every((mode: string) => mode === 'continuous'))).toBe(true);
    await page.evaluate(() => { sessionStorage.setItem('camlock-unsupported','1'); sessionStorage.setItem('camlock-size-hang','1'); });
    for (const seats of [2, 4] as const) {
      const slug = await soloTable(context.request, seats); await page.goto(`/duels/remote/${slug}`);
      await page.getByTestId('camera-on-feed').click();
      for (const [width, height] of [[1920,1080],[2560,1440],[1366,768],[390,844]]) {
        await page.setViewportSize({width,height}); await page.getByTestId('camera-settings').click();
        await expect(lock).toContainText('Camera lock not supported — auto kept');
        await expect(toggle).toContainText('On (not supported)');
        const picker = page.getByTestId('recognition-mode-trigger');
        await expect(picker).toBeVisible();
        const box = await picker.boundingBox(); expect(box!.width).toBeGreaterThan(100); expect(box!.height).toBeGreaterThan(28);
        const more = await page.getByTestId('camera-settings').boundingBox(); expect(more!.width).toBeGreaterThan(40);
        expect(await page.getByTestId('camera-settings').evaluate(el => getComputedStyle(el).paddingInlineStart)).toBe('9px');
        await shot(page, `camlock-more-${seats}-${width}`); await page.keyboard.press('Escape');
      }
    }

  });

  test("zones calibrated in the lobby are the ones the table reads, so it does not ask again", async ({ page, context }) => {
    const created = await context.request.post("/api/remote", { data: { gameId: "ygo", seatCount: 2, solo: true } });
    const slug = (await created.json()).slug as string;
    await page.goto(`/duels/remote/${slug}`);
    const zones = page.getByTestId("lobby-cam-zones");
    await expect(zones).toHaveAttribute("data-state", "first");
    await expect.poll(() => page.getByTestId("lobby-cam-video").evaluate((el: HTMLVideoElement) => el.videoWidth > 0)).toBe(true);
    await shot(page, "lobby-zones-first");
    await page.getByTestId("lobby-cam-calibrate").click();
    const dialog = page.getByRole("dialog", { name: "Calibrate field zones" });
    await dialog.getByTestId("camera-faces-me").click();
    // The whole grid moves with the arrow keys; it has eight resize handles and a turn knob, but no per-zone handles.
    await expect(dialog.getByRole("button", { name: /Resize from the/ })).toHaveCount(8);
    await expect(dialog.getByTestId("field-rotate-handle")).toHaveCount(1);
    await dialog.getByTestId("field-move").focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight");
    for (const [w, h] of SHOTS ? [[1920, 1080], [1366, 768], [390, 844]] : []) { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(300); await shot(page, `calibration-dialog-${w}`); }
    if (SHOTS) await page.setViewportSize({ width: 1440, height: 900 });
    await dialog.getByRole("button", { name: "Save calibration" }).click();
    // The large live check opens after the save. "Looks good" closes it, and the lobby shows Calibrated.
    const view = page.getByTestId("lobby-zones-view");
    await expect(view).toBeVisible();
    await shot(page, "lobby-zones-view");
    // Dragging the right-hand edge handle narrows the whole grid and saves it; the zones keep their shape (M3 and M4 stay the same size). Undo brings the width back.
    const gridWidth = () => view.locator("polygon").evaluateAll(polygons => { const xs = polygons.flatMap(p => (p.getAttribute("points") ?? "").split(" ").map(pair => Number(pair.split(",")[0]))); return Math.max(...xs) - Math.min(...xs); });
    const cellWidth = async (zone: string) => { const xs = ((await view.locator(`polygon[data-zone="${zone}"]`).getAttribute("points")) ?? "").split(" ").map(pair => Number(pair.split(",")[0])); return Math.max(...xs) - Math.min(...xs); };
    const wide = await gridWidth(), m3Wide = await cellWidth("M3");
    const surfaceBox = (await view.getByTestId("field-move").boundingBox())!, edge = (await view.getByTestId("field-handle-e").boundingBox())!;
    const edgeX = edge.x + edge.width / 2, edgeY = edge.y + edge.height / 2;
    await page.mouse.move(edgeX, edgeY); await page.mouse.down(); await page.mouse.move(edgeX - surfaceBox.width * 0.15, edgeY, { steps: 6 }); await page.mouse.up();
    await expect.poll(gridWidth).toBeLessThan(wide - 50);
    expect(Math.abs((await cellWidth("M3")) - (await cellWidth("M4")))).toBeLessThan(2);
    await shot(page, "lobby-zones-edited");
    for (const [w, h] of SHOTS ? [[1920, 1080], [1366, 768], [390, 844]] : []) { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(300); await shot(page, `lobby-zones-view-${w}`); }
    if (SHOTS) await page.setViewportSize({ width: 1440, height: 900 });
    await view.getByTestId("field-undo").click();
    await expect.poll(async () => Math.abs((await gridWidth()) - wide)).toBeLessThan(2);
    expect(Math.abs((await cellWidth("M3")) - m3Wide)).toBeLessThan(2);
    await view.getByTestId("lobby-zones-view-done").click();
    await expect(view).toBeHidden();
    await expect(zones).toHaveAttribute("data-state", "done");
    await shot(page, "lobby-zones-done");
    // The lobby grid, in 0..1 units. The table must draw the very same cells from the saved record.
    const cells = (selector: string, scale: number) => page.locator(selector).evaluateAll((polygons, k) => polygons.map(p => (p.getAttribute("points") ?? "").split(/[ ,]+/).map(n => Number(n) / k)), scale);
    const lobbyCells = await cells('svg[viewBox="0 0 1000 1000"] polygon', 1000);
    expect(lobbyCells.length).toBeGreaterThan(10);
    expect((await context.request.post(`/api/remote/${slug}/ready`, { data: { ready: true } })).ok()).toBe(true);
    expect((await context.request.post(`/api/remote/${slug}/start`, { data: {} })).ok()).toBe(true);
    await expect(page.getByTestId("remote-table")).toBeVisible();
    const status = page.getByTestId("field-watcher-status");
    // Only a state after the record was read with the camera on can show a missing calibration.
    await expect(status).toHaveText(/^(Preparing card reader…|Watching field.*|Reader off|Paused · busy)$/, { timeout: 30_000 });
    // With the zones calibrated, the grid shows only when the player turns it on.
    await page.getByTestId("feed-box-0").hover(); await page.getByTestId("zone-grid-toggle").first().click();
    const tableGrid = page.locator('[data-testid="zone-grid"][data-calibrated="true"]');
    await expect(tableGrid.first()).toBeVisible();
    const tableCells = await cells('[data-testid="zone-grid"][data-calibrated="true"] polygon', 1);
    expect(tableCells.length).toBe(lobbyCells.length);
    tableCells.forEach((points, i) => points.forEach((n, j) => expect(Math.abs(n - lobbyCells[i][j])).toBeLessThan(.005)));
  });
});

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

  test("a new browser starts with the board on (Auto detection) and the zone grid off, a bot seat keeps its board, and a choice stays", async ({ browser }) => {
    test.setTimeout(120_000);
    const url = process.env.E2E_REMOTE_UI_URL!;
    const fresh = await browser.newContext({ baseURL: url, viewport: { width: 1920, height: 1080 }, permissions: ["camera", "microphone"] });
    try {
      await authenticatePlayer(fresh.request, { userId: 101 }, process.env.E2E_AUTH_SECRET!, url);
      const slug = await soloTable(fresh.request, 2); const page = await fresh.newPage(); await fakeCamera(page, "16:9");
      await page.goto(`/duels/remote/${slug}`);
      // The default follows the detection mode: Auto shows the board, Tap to identify hides it (resolveWebcamOnly).
      await expect(page.getByTestId("fwrap-0")).toBeVisible(); await expect(page.getByTestId("fwrap-1")).toBeVisible();
      await expect(page.getByTestId("field-toggle-0")).toContainText("Hide virtual field"); await expect(page.getByTestId("field-toggle-0")).toContainText("Beta");
      // The grid shows only while the zones need calibration. Saved zones leave a clean camera.
      await page.getByTestId("camera-on-feed").click();
      await expect.poll(() => page.locator('[data-testid="feed-0"] video').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
      const grid = page.locator('[data-testid="zone-grid"]'); await expect(grid).toHaveCount(1); await expect(grid).toHaveAttribute("data-calibrated", "false");
      await page.getByTestId("feed-box-0").hover(); await page.getByRole("button", { name: "Calibrate zones", exact: true }).first().click();
      const dialog = page.getByRole("dialog", { name: "Calibrate field zones", exact: true }); await expect(dialog).toBeVisible();
      await dialog.getByTestId("camera-my-view").click(); await dialog.getByRole("button", { name: "Save calibration", exact: true }).click(); await expect(dialog).toBeHidden();
      await expect(grid).toHaveCount(0); await page.getByTestId("feed-box-0").hover(); await expect(page.getByTestId("zone-grid-toggle").first()).toHaveAttribute("aria-pressed", "false");
      await page.keyboard.press("w"); await expect(page.getByTestId("fwrap-0")).toBeHidden();
      await page.reload(); await expect(page.getByTestId("remote-table")).toBeVisible(); await expect(page.getByTestId("fwrap-0")).toBeHidden();
      await page.keyboard.press("w"); await expect(page.getByTestId("fwrap-0")).toBeVisible();
      await page.reload(); await expect(page.getByTestId("fwrap-0")).toBeVisible();
    } finally { await fresh.close(); }
  });

  test("webcam only: an attacker picks a target from a list when the opponent has no camera", async ({ browser }) => {
    test.setTimeout(240_000);
    const url = process.env.E2E_REMOTE_UI_URL!;
    const options = { baseURL: url, viewport: { width: 1920, height: 1080 }, permissions: ["camera", "microphone"] };
    const alice = await browser.newContext(options); const bob = await browser.newContext(options);
    try {
      for (const [context, userId] of [[alice, 101], [bob, 102]] as const) await authenticatePlayer(context.request, { userId }, process.env.E2E_AUTH_SECRET!, url);
      const slug = await startTwoPlayerTable(alice.request, bob.request);
      const place = async (api: APIRequestContext, seat: number, ref: string) => {
        const room = await (await api.get(`/api/remote/${slug}`)).json();
        const response = await api.post(`/api/remote/${slug}/actions`, { data: { baseSeq: room.lastSeq, action: { idempotencyKey: crypto.randomUUID(), type: "twin.place", actorSeat: seat, seat, zone: "monster", card: { ref, cardId: 900000001, name: "Origin fixture 1", slot: 1, faceUp: true, position: "attack" } } } });
        expect(response.status(), await response.text()).toBe(200);
      };
      await place(alice.request, 0, "seat0"); await place(bob.request, 1, "seat1");
      // The opening turn has no Battle Phase, so the first player passes. The second player attacks. The other seat has no camera and no outlined card.
      const post = async (api: APIRequestContext, action: Record<string, unknown>) => {
        const room = await (await api.get(`/api/remote/${slug}`)).json();
        const response = await api.post(`/api/remote/${slug}/actions`, { data: { baseSeq: room.lastSeq, action: { idempotencyKey: crypto.randomUUID(), ...action } } });
        expect(response.status(), await response.text()).toBe(200); return response.json();
      };
      const first = (await (await alice.request.get(`/api/remote/${slug}`)).json()).state.turnSeat as number; const turn = 1 - first, other = first;
      await post(first === 0 ? alice.request : bob.request, { type: "turn.end", actorSeat: first });
      const attacker = turn === 0 ? alice : bob;
      await post(attacker.request, { type: "phase.set", actorSeat: turn, phase: "battle" });
      // The default view follows the detection mode (Auto shows the board), so this player picks Webcam only.
      await attacker.addInitScript(() => { try { localStorage.setItem("dd-remote-webcam-only", "1"); } catch { /* storage blocked */ } });
      const page = await attacker.newPage(); await page.goto(`/duels/remote/${slug}`);
      await expect(page.getByTestId(`fwrap-${other}`)).toBeHidden();
      await page.getByTestId(`wc-cards-${turn}`).getByRole("button").first().focus(); await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Attack from here" }).click();
      const targets = page.getByTestId(`wc-cards-${other}`); await expect(targets).toBeVisible(); await expect(targets).toHaveAttribute("data-targets", "true"); await expect(page.getByTestId(`wc-direct-${other}`)).toBeVisible();
      await shot(page, "wc-attack-targets");
      if (SHOTS) for (const [w, h] of [[1366, 768], [390, 844]]) { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(500); await shot(page, `wc-attack-targets-${w}`); }
      await page.setViewportSize({ width: 1920, height: 1080 });
      // A cold dev server can drop this post, so the pick repeats until the attack is on the table.
      const pendingTarget = async () => (await (await attacker.request.get(`/api/remote/${slug}`)).json()).state.attack?.targetCardRef;
      await expect(async () => {
        if (await pendingTarget() === `seat${other}`) return;
        if (await targets.getAttribute("data-targets") !== "true") { await page.getByTestId(`wc-cards-${turn}`).getByRole("button").first().focus(); await page.keyboard.press("Enter"); await page.getByRole("button", { name: "Attack from here" }).click(); }
        await targets.getByRole("button", { name: /Origin fixture 1/ }).click();
        await expect.poll(pendingTarget, { timeout: 12_000 }).toBe(`seat${other}`);
      }).toPass({ timeout: 100_000 });
    } finally { await alice.close(); await bob.close(); }
  });

  test("Rescan sits on the opponent's seat only, and shows what the other side answered", async ({ browser }) => {
    test.setTimeout(240_000);
    const url = process.env.E2E_REMOTE_UI_URL!;
    const options = { baseURL: url, viewport: { width: 1920, height: 1080 }, permissions: ["camera", "microphone"] };
    const alice = await browser.newContext(options); const bob = await browser.newContext(options);
    try {
      for (const [context, userId] of [[alice, 101], [bob, 102]] as const) await authenticatePlayer(context.request, { userId }, process.env.E2E_AUTH_SECRET!, url);
      const slug = await startTwoPlayerTable(alice.request, bob.request);
      const page = await alice.newPage(); await page.goto(`/duels/remote/${slug}`);
      const rescan = page.getByTestId("field-rescan-1");
      await expect(rescan).toBeVisible(); await expect(page.getByTestId("field-rescan-0")).toHaveCount(0);
      await rescan.click();
      // Bob has no camera on, so he answers "off", or nothing arrives in time. Either way the button says so.
      await expect(rescan.getByRole("status")).toHaveText(/Their Auto-detect is off|Could not reach them/);
      if (SHOTS) for (const [w, h] of [[1366, 768], [390, 844]]) { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(300); await shot(page, `rescan-button-${w}`); }
    } finally { await alice.close(); await bob.close(); }
  });

  test("webcam only hides the virtual field and is remembered; a camera card shows its name and opens its actions; right click never shows the browser menu", async ({ page, context }) => {
    test.setTimeout(120_000);
    const slug = await soloTable(context.request, 2); await seed(context, slug);
    await fakeCamera(page, "16:9");
    await page.goto(`/duels/remote/${slug}`);
    const field = page.getByTestId("field-0");
    await expect(field.locator('[data-zone="m1"]')).toBeVisible();
    // Right click on an empty spot is swallowed. On a card it opens the card drawer with its actions.
    const swallowed = (selector: string) => page.locator(selector).first().evaluate(el => !el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(await swallowed('[data-testid="remote-table"] main')).toBe(true);
    await field.locator('[data-zone="m1"]').click({ button: "right" });
    await expect(page.getByTestId("inspector")).toContainText("Dark Magician");
    await page.keyboard.press("Escape");
    // The camera: confirm the mat grid, then use webcam only.
    await page.getByTestId("camera-on-feed").click();
    await expect(page.locator('[data-testid="feed-0"] video')).toBeAttached({ timeout: 60_000 });
    await expect.poll(() => page.locator('[data-testid="feed-0"] video').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    // A press on the camera only closes the orientation list: no read starts. Yes then confirms, and a pick from the list reads nothing either.
    const orientation = page.getByTestId("camera-orientation-trigger"), camera = (await page.getByTestId("feed-0").boundingBox())!;
    await orientation.click(); await page.mouse.click(camera.x + camera.width * .75, camera.y + camera.height * .7);
    await expect(orientation).toHaveAttribute("aria-expanded", "false");
    await page.locator('[data-testid="feed-0"]').getByTestId("orientation-confirm").click();
    await orientation.click(); await page.getByRole("option", { name: "Camera faces me" }).click(); await expect(orientation).not.toBeFocused();
    await expect(page.getByTestId("reticle")).toHaveCount(0); await expect(page.getByTestId("no-card")).toHaveCount(0);
    await page.getByTestId("view-webcam").click();
    await expect(page.getByTestId("view-webcam")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("fwrap-0")).toBeHidden(); await expect(page.getByTestId("feed-box-0")).toBeVisible();
    // A bot seat has no camera to read, so it keeps its board and has no toggle.
    await expect(page.getByTestId("feed-box-1")).toBeVisible(); await expect(page.getByTestId("fwrap-1")).toBeVisible(); await expect(page.getByTestId("field-toggle-1")).toHaveCount(0);
    // The Graveyard and Banished counts sit in the seat header, one click from their pile.
    await expect(page.getByTestId("wc-piles-0")).toContainText("GY");
    // A card on the camera: hover shows its name, click opens its info, right click opens its actions (Monster Zone 1 holds Dark Magician).
    const grid = page.locator('[data-testid="feed-0"] [data-testid="zone-grid"]'); const m1 = (await grid.locator('polygon[data-zone="M1"]').boundingBox())!;
    const at = { x: m1.x + m1.width / 2, y: m1.y + m1.height / 2 };
    await page.mouse.move(at.x, at.y); await expect(page.getByTestId("hover-tip")).toContainText("Dark Magician");
    await page.mouse.click(at.x, at.y); await expect(page.getByTestId("inspector")).toContainText("Dark Magician");
    await page.keyboard.press("Escape"); await expect(page.getByTestId("inspector")).toBeHidden();
    await page.mouse.click(at.x, at.y, { button: "right" }); await expect(page.getByTestId("inspector")).toContainText("Dark Magician");
    await page.keyboard.press("Escape");
    await shot(page, "webcam-only-1920");
    // Notices (here the undo toast) sit in my own seat's stack, never over the camera. Recognition prompts use the same stack.
    await page.keyboard.press("Control+z");
    const toasts = page.getByTestId("toasts"); await expect(toasts).toContainText("Undid");
    const apart = async () => { const [a, b, c] = await Promise.all([toasts.boundingBox(), page.getByTestId("feed-box-0").boundingBox(), page.getByTestId("notify-dock-0").boundingBox()]);
      return !!a && !!b && !!c && (a.x >= b.x + b.width - 1 || a.y >= b.y + b.height - 1) && a.x >= c.x - 1 && a.y >= c.y - 1; };
    expect(await apart()).toBe(true);
    await expect(page.getByTestId("notify-dock-0").getByTestId("toasts")).toBeVisible(); await shot(page, "webcam-only-notice-1920");
    await page.reload(); await expect(page.getByTestId("fwrap-0")).toBeHidden();
    // W switches the view. Each seat has its own "Hide virtual field" button.
    await expect(page.getByTestId("field-toggle-0")).toContainText("Show virtual field");
    await page.keyboard.press("w"); await expect(page.getByTestId("fwrap-0")).toBeVisible(); await expect(page.getByTestId("field-toggle-0")).toContainText("Hide virtual field");
    await page.getByTestId("field-toggle-0").click(); await expect(page.getByTestId("fwrap-0")).toBeHidden();
    await page.getByTestId("view-both").click(); await expect(page.getByTestId("fwrap-0")).toBeVisible();
    // Both view: notices dock beside the player's own field, can be dragged, and fold into a chip with a count.
    await page.keyboard.press("Control+z"); const mine = page.getByTestId("notify-dock-0");
    await expect(mine.getByTestId("toasts")).toContainText("Undid"); await expect(page.getByTestId("notify-dock-1")).toHaveAttribute("data-count", "0");
    await expect(page.getByTestId("notify-count-0")).toHaveText("1");
    const grip = mine.getByRole("button", { name: /Move notifications/ }); const before = (await mine.boundingBox())!;
    await grip.focus(); await page.keyboard.press("ArrowLeft"); await expect.poll(async () => (await mine.boundingBox())!.x).toBeLessThan(before.x - 8);
    await page.getByTestId("notify-toggle-0").click(); await expect(mine.getByTestId("toasts")).toBeHidden();
    await page.getByTestId("notify-toggle-0").click(); await expect(mine.getByTestId("toasts")).toBeVisible();
    await mine.getByRole("button", { name: "Reset notification position" }).click(); await expect.poll(async () => Math.abs((await mine.boundingBox())!.x - before.x)).toBeLessThan(2);
  });

  test("piles: the Graveyard and Banished keep their order, the viewer lists them newest first, a drag brings a card back, Undo restores the order", async ({ page, context }) => {
    const slug = await soloTable(context.request, 2); const room = await seed(context, slug);
    const move = async (ref: string, zone: string) => {
      const current = await (await context.request.get(`/api/remote/${slug}`)).json();
      const response = await context.request.post(`/api/remote/${slug}/actions`, { data: { baseSeq: current.lastSeq, action: { idempotencyKey: crypto.randomUUID(), type: "twin.move", actorSeat: 0, seat: 0, zone, cardRef: ref } } });
      expect(response.status(), await response.text()).toBe(200);
    };
    // Blue-Eyes enters the Graveyard before Dark Magician although it sits after it in the twin list.
    await move("bl", "graveyard"); await move("dm", "graveyard"); await move("mst", "banished");
    const pile = async (zone: string) => (await room()).state.seats[0].twin.filter(card => card.zone === zone).map(card => card.ref);
    expect(await pile("graveyard")).toEqual(["bl", "dm"]);
    await page.goto(`/duels/remote/${slug}`);
    const field = page.getByTestId("field-0"); const gy = field.locator('[data-zone="gy"]');
    await expect(gy).toBeVisible();
    const refs = () => page.getByTestId("pile-card").evaluateAll(tiles => tiles.map(tile => tile.getAttribute("data-ref")));
    await expect(async () => { await gy.click(); await expect(page.getByTestId("pile-viewer")).toBeVisible({ timeout: 1500 }); }).toPass({ timeout: 30_000 });
    await expect(page.getByTestId("pile-tab-graveyard")).toContainText("2"); await expect(page.getByTestId("pile-tab-banished")).toContainText("1");
    expect(await refs()).toEqual(["dm", "bl"]);
    await page.keyboard.press("ArrowRight"); await expect(page.getByTestId("pile-card").nth(1)).toBeFocused();
    await page.getByTestId("pile-tab-banished").click(); expect(await refs()).toEqual(["mst"]);
    await page.getByTestId("pile-tab-graveyard").click();
    // Drag Blue-Eyes from the pile to Monster Zone 3: same move, same rules, one log line, one Undo.
    const tile = page.locator('[data-testid="pile-card"][data-ref="bl"]'); const target = field.locator('[data-zone="m3"]');
    await tile.hover(); await expect(page.getByTestId("pile-preview")).toContainText("ATK"); // the card data is loaded, so the drop has a known type
    const a = (await tile.boundingBox())!; const b = (await target.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 - 12, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await expect(page.getByTestId("drag-ghost")).toBeVisible(); await page.mouse.up();
    await expect.poll(async () => find(await room(), "bl").slot).toBe(3);
    expect(find(await room(), "bl").zone).toBe("monster"); expect(await pile("graveyard")).toEqual(["dm"]);
    await page.getByTestId("undo").click(); await expect.poll(pile.bind(null, "graveyard")).toEqual(["bl", "dm"]); // the Undo window is 5 s, so Undo comes first
    await page.getByTestId("log-button").click(); await expect(page.getByTestId("log-drawer")).toContainText("Monster Zone 3"); await page.keyboard.press("Escape");
    await gy.click(); await expect(page.getByTestId("pile-viewer")).toBeVisible();
    expect(await refs()).toEqual(["dm", "bl"]);
    await page.waitForTimeout(500);
    await shot(page, "pile-viewer");
    for (const [w, h] of SHOTS ? [[1366, 768], [390, 844]] : []) { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(300); await shot(page, `pile-viewer-${w}`); }
    await page.keyboard.press("Escape"); await expect(page.getByTestId("pile-viewer")).toHaveCount(0);
    // The Banished pile is a zone of its own right above the Graveyard (as on the printed mat): count, top card, click opens its tab.
    const ban = field.locator('[data-zone="ban"]'); await expect(ban).toBeVisible(); await expect(ban).toContainText("1");
    const [banBox, gyBox] = [(await ban.boundingBox())!, (await gy.boundingBox())!];
    expect(Math.abs(banBox.x + banBox.width - (gyBox.x + gyBox.width))).toBeLessThan(4); expect(banBox.width).toBeGreaterThan(banBox.height); expect(banBox.y + banBox.height).toBeLessThanOrEqual(gyBox.y + 1); // landscape, right edges level
    await ban.click(); await expect(page.getByTestId("pile-tab-banished")).toHaveAttribute("aria-pressed", "true"); expect(await refs()).toEqual(["mst"]);
    await page.keyboard.press("Escape"); await expect(page.getByTestId("pile-viewer")).toHaveCount(0);
    for (const [w, h] of SHOTS ? [[1920, 1080], [1366, 768], [360, 700]] : []) { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(300); await shot(page, `banish-zone-${w}`); }
  });

  test("one card seen twice: both copies get a 2x badge and no merge line asks; the copies stay (they can be real)", async ({ page, context }) => {
    const slug = await soloTable(context.request, 2); const room = await seed(context, slug);
    // A second Mystical Space Typhoon in another Spell/Trap Zone, seen at once with the first (copy proof): the same public card twice on one field.
    const before = await room() as unknown as { lastSeq: number };
    const placed = await context.request.post(`/api/remote/${slug}/actions`, { data: { baseSeq: before.lastSeq, action: { idempotencyKey: crypto.randomUUID(), type: "twin.place", source: "auto", copyProof: { simultaneousQuads: 2, at: Date.now() }, actorSeat: 0, seat: 0, zone: "spell-trap", card: { ref: "mst2", cardId: 5318639, name: "Mystical Space Typhoon", slot: 3, faceUp: true, position: "attack" } } } });
    expect(placed.status(), await placed.text()).toBe(200);
    await page.goto(`/duels/remote/${slug}`);
    await expect(page.getByTestId("field-0").getByTestId("dup-badge")).toHaveText(["2\u00d7", "2\u00d7"]);
    // Simultaneous physical copies are kept: the table no longer shows the Merge / Two copies line.
    await expect(page.getByTestId("dup-banner-0")).toHaveCount(0);
    expect((await room()).state.seats[0].twin.filter(card => card.zone === "spell-trap")).toHaveLength(2);
    await shot(page, "dup-badges");
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
    await expect(page.getByText(`No camera (manual). Use ${(process.env.REMOTE_VOICE_USERS ?? "").split(",").some(id => id.trim() === "101") ? "voice, " : ""}typing`)).toBeVisible();
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

  test("voice: only phase and turn sample controls are offered", async ({ page, context }) => {
    test.skip(!(process.env.REMOTE_VOICE_USERS ?? "").split(",").some(id => id.trim() === "101"), "needs REMOTE_VOICE_USERS=101");
    const slug = await soloTable(context.request, 2); await seed(context, slug);
    await page.goto(`/duels/remote/${slug}`);
    await expect(page.getByTestId("mic")).toHaveAttribute("data-mic", "muted");
    await page.getByRole("button", { name: "Try saying…" }).click();
    await expect(page.getByRole("button", { name: "end turn", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "monster zone two", exact: true })).toHaveCount(0);
  });

});

test.describe("Remote Duel on the Duels screens (flag on)", () => {
  test.skip(process.env.E2E_REMOTE_OFF === "1", "the stack runs with REMOTE_DUELS off");
  test.beforeEach(async ({ context }) => { await authenticatePlayer(context.request, { userId: 101 }, process.env.E2E_AUTH_SECRET!, BASE_URL); });

  test("Duels → New → Remote Duel → Create room lands on the table", async ({ page }) => {
    await page.goto("/duels");
    await expect(page.getByTestId("new-remote-duel")).toBeVisible();
    for (const [w, h] of [[1920, 1080], [2560, 1440], [1366, 768], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto("/duels");
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
    // Remote offers only Advanced for now, with no format choice, and the rule on by default.
    await expect(page.getByTestId("remote-format")).toHaveText(/Advanced/);
    await expect(page.getByRole("radiogroup", { name: "Duel type" })).toHaveCount(0);
    await expect(page.getByTestId("genesys-toggle")).toHaveCount(0);
    await expect(page.getByTestId("create-show-set")).toBeChecked();
    await onlineRadio(page).click();
    await expect(page).toHaveURL(/\/duels\/new$/);
    await expect(page.getByTestId("remote-setup")).toHaveCount(0);
    await remoteRadio(page).click();
    await page.getByTestId("create-solo").check();
    await page.getByTestId("create-room").click();
    await expect(page).toHaveURL(/\/duels\/remote\/[^/]+$/);
    await expect(page.getByTestId("remote-lobby-room")).toBeVisible();
    // The deck list step is the default path: the paste box is open, and Skip for now closes it so the room stays usable without a list.
    await expect(page.getByTestId("deck-list-text")).toBeVisible();
    await page.getByTestId("deck-list-toggle").click();
    await expect(page.getByTestId("deck-list-text")).toBeHidden();
    await page.getByTestId("deck-list-toggle").click();
    await expect(page.getByTestId("deck-list-text")).toBeVisible();
    await shot(page, "created-room-1920");
    if (SHOTS) {
      for (const [w, h] of [[1440, 900], [1366, 768], [390, 844]]) { await page.setViewportSize({ width: w, height: h }); await shot(page, `lobby-deck-list-${w}x${h}`); }
      await page.setViewportSize({ width: 1920, height: 1080 });
      const deck = page.getByTestId("deck-0"); const choices = await deck.locator("option").count();
      if (choices > 1) {
        await deck.selectOption({ index: 1 }); await expect(page.getByTestId("deck-list-on-0")).toBeVisible();
        for (const [w, h] of [[1920, 1080], [1440, 900], [1366, 768], [390, 844]]) { await page.setViewportSize({ width: w, height: h }); await shot(page, `lobby-deck-on-${w}x${h}`); }
      }
    }
    // The new table is listed on the Duels page. It is yours and solo, so it is still being set up, not open to join.
    await page.goto("/duels");
    await expect(page.getByText("Your table").first()).toBeVisible();
    await expect(page.getByText("Setting up").first()).toBeVisible();
    await expect(page.getByText("Remote", { exact: true }).first()).toBeVisible();
    await shot(page, "duels-with-table-1920");
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
  test("no Play mode, no Remote Duel button, no remote or deck requests", async ({ page, context }) => {
    await authenticatePlayer(context.request, { userId: 101 }, process.env.E2E_AUTH_SECRET!, BASE_URL);
    const seen: string[] = [];
    page.on("request", request => { const path = new URL(request.url()).pathname; if (path.startsWith("/api/remote") || path === "/api/decks") seen.push(path); });
    await page.goto("/duels/new?type=remote");
    await expect(page.getByRole("heading", { name: "Custom game creator" })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Play mode" })).toHaveCount(0);
    await expect(page.getByTestId("remote-setup")).toHaveCount(0);
    await page.goto("/duels");
    await expect(page.getByRole("heading", { name: "Duels", exact: true })).toBeVisible();
    await expect(page.getByTestId("new-remote-duel")).toHaveCount(0);
    await page.waitForTimeout(6000);
    expect(seen).toEqual([]);
  });
});

test.describe("remote duels screen, two players on LiveKit", () => {
  test("Bob reads Alice's feed, both see it, and the other player can undo", async ({ browser }) => {
    test.skip(!HAVE_LIVEKIT, `needs LiveKit at ${LIVEKIT.origin} (LIVEKIT_URL)`);
    test.setTimeout(300_000);
    const alice = await browser.newContext(); const bob = await browser.newContext();
    await Promise.all([bothView(alice), bothView(bob)]);
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

for (const showCardsSetFromDeck of [true]) test(`two browsers honor Deck publicity ${showCardsSetFromDeck}`,async({page,context,browser})=>{
  const url=process.env.E2E_REMOTE_UI_URL ?? "http://localhost:3310";
  await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,url);
  const bob=await browser.newContext();await bothView(bob);
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
    // The one-tap add-to-hand chip shows on the owner side only.
    await page.keyboard.press("Escape"); // the chip waits while the Set picker is open
    await expect(page.getByTestId("hand-chip")).toBeVisible(); await expect(observer.getByTestId("hand-chip")).toHaveCount(0);
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


test.describe("remote duels, spectators", () => {
  test("a spectator watches a public table, cannot act, sees nothing hidden, and a private table refuses", async ({ browser }) => {
    test.setTimeout(480_000);
    const url = process.env.E2E_REMOTE_UI_URL ?? "http://localhost:3310";
    const [alice, bob, carol, dave] = await Promise.all([1, 2, 3, 4].map(() => browser.newContext()));
    const db = new Database(new URL("../.stack-remote-ui/ui.sqlite", import.meta.url).pathname);
    try {
      for (const [context, userId] of [[alice, 101], [bob, 102], [carol, 103], [dave, 104]] as const) await authenticatePlayer(context!.request, { userId }, process.env.E2E_AUTH_SECRET!, url);
      const slug = await startTwoPlayerTable(alice!.request, bob!.request, "public"), path = `/api/remote/${slug}`;
      // Hidden facts of Alice: a Set card, a card known to be in hand. Public: a face-up monster.
      const act = async (action: Record<string, unknown>) => {
        const room = await (await alice!.request.get(path)).json();
        const done = await alice!.request.post(`${path}/actions`, { data: { baseSeq: room.lastSeq, action: { actorSeat: 0, idempotencyKey: crypto.randomUUID(), ...action } } });
        expect(done.status(), await done.text()).toBe(200);
      };
      await act({ type: "twin.place", seat: 0, zone: "spell-trap", card: { ref: "c0-53582587-set", slot: 1, cardId: 53582587, name: "Torrential Tribute", faceUp: false } });
      // Face up once, then Set: the old event must not name it.
      await act({ type: "twin.place", seat: 0, zone: "spell-trap", card: { ref: "c0-70825459-was", slot: 2, cardId: 70825459, name: "Trap Tracks", faceUp: true } });
      await act({ type: "twin.flip", seat: 0, cardRef: "c0-70825459-was", faceUp: false });
      // Added to hand is public table knowledge (the opponent sees it), so the spectator may see it too, never more than the opponent.
      await act({ type: "hand.add", cardId: 47355498, source: "unknown" });
      await act({ type: "twin.place", seat: 0, zone: "banished", card: { ref: "c0-24094653-down", slot: 1, cardId: 24094653, name: "Polymerization", faceUp: false } });
      await act({ type: "twin.place", seat: 0, zone: "monster", card: { ref: "shown", slot: 1, cardId: 900000001, name: "Origin fixture 1", faceUp: true } });
      const hiddenFree = (text: string) => { for (const secret of ["Torrential", "53582587", "Trap Tracks", "70825459", "24094653", "Polymerization", "\"deck\":{", "savedDeckId", "deckCount", "effectTracking"]) expect(text, secret).not.toContain(secret); };

      // Listed where normal duels list tables, and the view from the server holds no hidden fact.
      expect((await (await carol!.request.get("/api/remote?scope=open")).json()).tables.some((t: { slug: string }) => t.slug === slug)).toBe(true);
      const before = await (await alice!.request.get(path)).json();
      const watched = await carol!.request.post(`${path}/spectate`, { data: {} });
      expect(watched.status(), await watched.text()).toBe(200);
      const view = await watched.json(), viewText = JSON.stringify(view);
      expect([view.spectator, view.mySeat]).toEqual([true, -1]);
      hiddenFree(viewText);
      expect(view.state.seats[0].twin.find((c: { ref: string }) => c.ref === "shown").name).toBe("Origin fixture 1");
      expect(view.state.seats[0].twin.filter((c: { ref: string; cardId?: number }) => c.ref.startsWith("private-card-") && c.cardId === undefined)).toHaveLength(3);
      expect(view.state.seats[0].knownHand.map((c: { cardId: number }) => c.cardId)).toEqual([47355498]);
      expect(view.state.seats[0].knownHand).toEqual((await (await bob!.request.get(path)).json()).state.seats[0].knownHand);
      expect(view.state.seats[0].handCount).toBeDefined();

      // No seat change, no event, no idle clock.
      const after = await (await alice!.request.get(path)).json();
      expect([after.lastSeq, after.lastEventAt, after.seats.length]).toEqual([before.lastSeq, before.lastEventAt, 2]);
      expect(after.spectatorCount).toBe(1);

      // Every room action is refused.
      const refused: [string, "post" | "get" | "patch" | "delete", unknown?][] = [
        ["actions", "post", { baseSeq: after.lastSeq, action: { type: "lp.change", actorSeat: 0, seat: 0, delta: -100, reason: "x", idempotencyKey: crypto.randomUUID() } }],
        ["ready", "post", { ready: true }], ["start", "post", {}], ["leave", "post", {}], ["activity", "post", {}], ["deck", "post", { savedDeckId: null }], ["format", "post", { bestOf: 1 }],
        ["search?seat=0&recentCardId=73628505", "get"], ["phone", "get"], ["phone", "post", {}], ["phone", "delete"], ["phone", "patch", { mode: "webcam" }],
      ];
      for (const [route, method, data] of refused) {
        const reply = await carol!.request[method](`${path}/${route}`, data === undefined ? undefined : { data });
        expect(reply.status(), `${method} ${route}`).toBe(403);
      }
      expect((await carol!.request.post(`${path}/seat`, { data: {} })).status()).toBe(409);

      // The video token has no publish rights.
      const media = await carol!.request.post(`${path}/livekit`);
      expect(media.status(), await media.text()).toBe(200);
      const grant = JSON.parse(Buffer.from((await media.json()).token.split(".")[1], "base64url").toString()).video;
      expect(grant).toMatchObject({ canPublish: false, canPublishData: false, canSubscribe: true, hidden: true, room: `remote-${slug}` });
      const grantOf = (token: string) => JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()).video;
      // Voice: a spectator gets no token for its room, and no seated token can put a microphone in the room a spectator enters.
      const noVoice = await carol!.request.post(`${path}/livekit?voice=1`);
      expect([noVoice.status(), (await noVoice.json()).code]).toEqual([403, "SPECTATOR_READ_ONLY"]);
      const seatGrant = grantOf((await (await alice!.request.post(`${path}/livekit`)).json()).token);
      const seatedVoice = await alice!.request.post(`${path}/livekit?voice=1`);
      expect([seatedVoice.status(), (await seatedVoice.json()).code]).toEqual([404, "TABLE_TALK_OFF"]);
      expect(JSON.stringify(seatGrant.canPublishSources).toLowerCase()).not.toContain("microphone");

      // The socket: its own projection, no player room event, and it cannot send.
      const credentials = await (await carol!.request.get(`${path}/connection`)).json();
      expect(credentials.seat).toBeNull();
      const socket = io(`http://localhost:${process.env.E2E_WS_PORT ?? 3312}`, { transports: ["websocket"] });
      const pushes: unknown[] = [], playerRoom: unknown[] = [];
      socket.on("remote:private", payload => pushes.push(payload)); socket.on("remote:changed", payload => playerRoom.push(payload)); socket.on("remote:data", payload => playerRoom.push(payload));
      const joined = await new Promise<{ ok: boolean }>(resolve => socket.on("connect", () => socket.emit("remote:join", { token: credentials.token }, resolve)));
      expect(joined.ok).toBe(true);
      const sent = await new Promise<{ ok: boolean }>(resolve => socket.emit("remote:data", { type: "recognition.request", requestId: crypto.randomUUID(), feedOwnerSeat: 0, x: .5, y: .5 }, resolve));
      expect(sent.ok).toBe(false);
      await act({ type: "lp.change", seat: 1, delta: -500, reason: "Battle" });
      await expect.poll(() => pushes.length).toBeGreaterThan(0);
      hiddenFree(JSON.stringify(pushes)); expect(playerRoom).toEqual([]);
      socket.disconnect();

      // The browser: both cameras at the lower layer, no camera of its own, no card reader or watcher.
      const [a, b, c] = await Promise.all([alice!.newPage(), bob!.newPage(), carol!.newPage()]);
      await c.addInitScript(() => {
        const w = window as unknown as { __cameraAsked: number }; w.__cameraAsked = 0;
        const asked = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = constraints => { w.__cameraAsked++; return asked(constraints); };
      });
      const readerFiles: string[] = [], workers: string[] = [];
      c.on("request", request => { if (/\.onnx|ort-wasm|\/vision|remote-vision/.test(request.url())) readerFiles.push(request.url()); });
      c.on("worker", worker => workers.push(worker.url()));
      await fakeCamera(a, "16:9"); await fakeCamera(b, "16:9");
      // Reads the raw LiveKit data each browser receives, before any page code can filter it.
      for (const page of [b, c]) await page.addInitScript(() => {
        const w = window as unknown as { __lkData: string };
        w.__lkData = "";
        const listen = (channel: RTCDataChannel) => channel.addEventListener("message", event => { if (event.data instanceof ArrayBuffer) w.__lkData += new TextDecoder("utf-8", { fatal: false }).decode(event.data); });
        const Native = window.RTCPeerConnection;
        window.RTCPeerConnection = class extends Native {
          constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) { super(...args); this.addEventListener("datachannel", event => listen(event.channel)); }
          override createDataChannel(...args: Parameters<RTCPeerConnection["createDataChannel"]>) { const channel = super.createDataChannel(...args); listen(channel); return channel; }
        };
      });
      for (const page of [a, b]) await page.addInitScript(() => {
        const asked = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        (window as unknown as { __audioAsked: number }).__audioAsked = 0;
        navigator.mediaDevices.getUserMedia = async constraints => {
          if (constraints?.audio) (window as unknown as { __audioAsked: number }).__audioAsked++;
          if (constraints?.video) return asked(constraints);
          const sound = new AudioContext(), out = sound.createMediaStreamDestination(); sound.createOscillator().connect(out);
          return out.stream;
        };
      });
      const { RoomServiceClient, TrackType } = await import("livekit-server-sdk");
      const lk = new RoomServiceClient((process.env.LIVEKIT_URL ?? "ws://127.0.0.1:7880").replace(/^ws/, "http"), process.env.LIVEKIT_API_KEY ?? "devkey", process.env.LIVEKIT_API_SECRET ?? "secret");
      const inRoom = async (room: string) => lk.listParticipants(room).catch(() => []);
      const audioIn = async (room: string) => (await inRoom(room)).flatMap(p => p.tracks.filter(t => t.type === TrackType.AUDIO).map(() => p.identity));
      const watcher = "remote-spectator-103", tableRoom = `remote-${slug}`, voiceRoom = `remote-${slug}-voice`;
      await Promise.all([a.goto(`/duels/remote/${slug}`), b.goto(`/duels/remote/${slug}`), c.goto(`/duels/remote/${slug}`)]);
      for (const page of [a, b]) { await expect(page.getByTestId("remote-table")).toBeVisible(); await page.getByTestId("camera-on-feed").click(); }
      await expect(c.getByTestId("spectator-table")).toBeVisible();
      await expect(c.getByTestId("spectator-badge")).toBeVisible();
      for (const seat of [0, 1]) {
        const video = c.locator(`[data-testid="feed-${seat}"] video`);
        await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth).catch(() => 0), { timeout: 60_000 }).toBeGreaterThan(0);
        await expect(c.getByTestId(`feed-${seat}`)).toHaveAttribute("data-layer-asked", "high");
      }
      // Player talk is off: nobody joins the voice room, and no audio track exists in the room of the spectator.
      expect((await inRoom(tableRoom)).map(p => p.identity)).toContain(watcher);
      expect((await inRoom(voiceRoom)).map(p => p.identity)).toEqual([]);
      expect(await audioIn(tableRoom)).toEqual([]);
      if (!(process.env.REMOTE_VOICE_USERS ?? "").split(",").some(id => id.trim() === "101")) {
        // With voice commands off too: no mic section, no mute control, V does nothing, and the table never asks for a microphone.
        await expect(a.getByTestId("mic")).toHaveCount(0);
        await expect(a.getByRole("button", { name: /mute/i })).toHaveCount(0);
        await expect(a.getByText("Talk to the table")).toHaveCount(0);
        await a.keyboard.press("v");
        await expect(a.getByTestId("mic")).toHaveCount(0);
        await expect(a.getByTestId("voice-off")).toBeVisible();
        expect(await a.evaluate(() => (window as unknown as { __audioAsked: number }).__audioAsked)).toBe(0);
        for (const [name, width, height] of [["1080p", 1920, 1080], ["768p", 1366, 768], ["mobile", 390, 844]] as const) {
          await a.setViewportSize({ width, height }); await a.waitForTimeout(300); await shot(a, `no-mic-${name}`);
          expect(await a.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), name).toBeLessThanOrEqual(0);
        }
        await a.setViewportSize({ width: 1920, height: 1080 });
      }
      // A Set card outline holds the id in its ref: the opponent receives it, the spectator's raw data does not.
      await a.evaluate(() => {
        const quad = [{ x: .2, y: .2 }, { x: .4, y: .2 }, { x: .4, y: .5 }, { x: .2, y: .5 }];
        const element = document.querySelector('[data-testid="feed-0"]')!, key = Object.keys(element).find(name => name.startsWith("__reactFiber$"))!;
        type Fiber = { return?: Fiber; memoizedProps?: { value?: { publishFieldTracks?: (message: unknown) => void } } };
        let fiber = (element as unknown as Record<string, Fiber>)[key];
        while (fiber && !fiber.memoizedProps?.value?.publishFieldTracks) fiber = fiber.return!;
        const send = () => fiber.memoizedProps!.value!.publishFieldTracks!({ type: "field.tracks", cards: [{ ref: "shown", cardId: 900000001, name: "Origin fixture 1", quad }], backs: [{ ref: "c0-53582587-set", zone: "S1", quad }] });
        // The field watcher also publishes each second, with no backs in this test.
        send(); (window as unknown as { __backs: ReturnType<typeof setInterval> }).__backs = setInterval(send, 200);
      });
      const rawData = (page: Page) => page.evaluate(() => (window as unknown as { __lkData: string }).__lkData);
      await expect.poll(() => rawData(c), { timeout: 15_000 }).toContain("Origin fixture 1");
      await expect.poll(() => rawData(b), { timeout: 15_000 }).toContain("c0-53582587-set");
      for (const secret of ["c0-53582587", "53582587", "backs"]) expect(await rawData(c), secret).not.toContain(secret);
      // The seated opponent's board shows the back. The spectator's does not.
      await expect(b.getByTestId("set-marker")).toBeVisible({ timeout: 15_000 });
      await expect(c.getByTestId("set-marker")).toHaveCount(0);
      await a.evaluate(() => clearInterval((window as unknown as { __backs: ReturnType<typeof setInterval> }).__backs));
      await expect(b.getByTestId("set-marker")).toHaveCount(0, { timeout: 15_000 });
      await expect(c.getByTestId("lp-value-1")).toHaveText("7500");
      await act({ type: "lp.change", seat: 0, delta: -100, reason: "Battle" });
      await expect(c.getByTestId("lp-value-0")).toHaveText("7900");
      await expect(c.getByTestId("public-cards-0")).toContainText("Origin fixture 1");
      await expect(c.getByTestId("set-count-0")).toHaveText("2 Set");
      hiddenFree((await c.locator("body").innerText()));
      // A click on a public card opens the view-only popup. A click on the camera with no public read opens nothing.
      await c.getByTestId("public-cards-0").getByRole("button", { name: "Origin fixture 1" }).click();
      await expect(c.getByTestId("card-popover")).toBeVisible();
      await expect(c.getByTestId("card-popover")).toContainText("Origin fixture 1");
      await expect(c.getByTestId("card-popover").locator("button", { hasText: /Wrong card|Pin|Read again|Attack|Flip|Move/ })).toHaveCount(0);
      await c.keyboard.press("Escape");
      await c.getByTestId("feed-1").click();
      await expect(c.getByTestId("card-popover")).toHaveCount(0);
      await c.getByTestId("log-button").click();
      await expect(c.getByTestId("log-drawer").or(c.locator('[data-layer="log"]')).first()).toBeVisible();
      hiddenFree((await c.locator("body").innerText()));
      await c.keyboard.press("Escape");
      expect(await c.evaluate(() => (window as unknown as { __cameraAsked: number }).__cameraAsked)).toBe(0);
      expect(readerFiles).toEqual([]); expect(workers.filter(worker => /recogni|vision|watcher|field/.test(worker))).toEqual([]);
      await expect(c.locator('[data-testid="field-watcher"],[data-testid="camera-on-feed"],[data-testid="seat-undo"]')).toHaveCount(0);

      // Screen sizes: no page scroll sideways, cameras and LP on the screen.
      for (const [name, width, height] of [["1080p", 1920, 1080], ["1440p", 2560, 1440], ["768p", 1366, 768], ["mobile", 390, 844]] as const) {
        await c.setViewportSize({ width, height }); await c.waitForTimeout(400);
        await shot(c, `spectator-${name}`);
        const overflow = await c.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, name).toBeLessThanOrEqual(0);
        await expect(c.getByTestId("lp-value-0"), name).toBeVisible();
        const video = await c.locator('[data-testid="feed-0"] video').boundingBox();
        expect(video && video.width > 200 && video.height > 100, name).toBe(true);
      }
      await c.setViewportSize({ width: 1920, height: 1080 });

      const tableId = (db.prepare("select id from remote_tables where slug=?").get(slug) as { id: number }).id;
      const frames = () => c.locator('[data-testid="feed-0"] video').evaluate((v: HTMLVideoElement) => v.videoWidth).catch(() => 0);
      // A hidden tab keeps its slot.
      const seen = () => (db.prepare("select last_seen_at from remote_spectators where table_id=? and user_id=103").get(tableId) as { last_seen_at: number }).last_seen_at;
      const seenBefore = seen();
      await c.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); });
      await expect.poll(seen, { timeout: 50_000, intervals: [2000] }).toBeGreaterThan(seenBefore);
      await c.evaluate(() => { delete (document as unknown as { visibilityState?: string }).visibilityState; });
      // A slot that ends takes the video with it. When the slot comes back, so does the video, with no reload.
      await c.route("**/spectate", route => route.abort());
      db.prepare("update remote_spectators set last_seen_at=? where table_id=? and user_id=103").run(Date.now() - 100_000, tableId);
      await expect.poll(async () => (await inRoom(tableRoom)).map(p => p.identity), { timeout: 50_000, intervals: [2000] }).not.toContain(watcher);
      await c.unroute("**/spectate");
      await expect.poll(async () => (await inRoom(tableRoom)).map(p => p.identity), { timeout: 100_000, intervals: [2000] }).toContain(watcher);
      await expect.poll(frames, { timeout: 100_000, intervals: [2000] }).toBeGreaterThan(0);
      // A second tab of one person takes the video. The first tab says so and takes it back with a click.
      const secondTab = await carol!.newPage();
      await secondTab.goto(`/duels/remote/${slug}`);
      // The dev server can reload the first tab while it compiles for the second, so either tab can be the one that lost.
      const lost = (page: Page) => page.getByTestId("spectator-video-retry");
      await expect.poll(async () => await lost(c).count() + await lost(secondTab).count(), { timeout: 40_000, intervals: [500] }).toBe(1);
      const firstLost = await lost(c).count() === 1;
      await expect((firstLost ? c : secondTab).getByTestId("spectator-note")).toContainText("another tab");
      // "Try again" takes the video back, and the other tab then shows the same note. The dev reload above can turn the players' cameras off, so this checks the connection, not frames.
      const [loser, winner] = firstLost ? [c, secondTab] : [secondTab, c];
      await lost(loser).click();
      await expect(lost(loser)).toHaveCount(0, { timeout: 20_000 });
      await expect(lost(winner)).toBeVisible({ timeout: 20_000 });
      await secondTab.close();
      if (!firstLost) { await lost(c).click(); await expect(lost(c)).toHaveCount(0, { timeout: 20_000 }); }
      // Stop watching ends the video at once, not at the next sweep.
      const daveTab = await dave!.newPage();
      await daveTab.goto(`/duels/remote/${slug}`);
      await expect.poll(async () => (await inRoom(tableRoom)).map(p => p.identity), { timeout: 30_000 }).toContain("remote-spectator-104");
      expect((await dave!.request.delete(`${path}/spectate`)).status()).toBe(200);
      await expect.poll(async () => (await inRoom(tableRoom)).map(p => p.identity), { timeout: 5000, intervals: [250] }).not.toContain("remote-spectator-104");
      await daveTab.close();
      await dave!.request.delete(`${path}/spectate`);

      // The cap, with a clear message. Carol keeps her slot; Dave is the one too many.
      for (let filler = 0; filler < 9; filler++) db.prepare("insert into remote_spectators(table_id,user_id,last_seen_at) values(?,?,?)").run(tableId, 9000 + filler, Date.now());
      const full = await dave!.request.post(`${path}/spectate`, { data: {} });
      expect([full.status(), (await full.json()).code]).toEqual([409, "SPECTATORS_FULL"]);
      expect((await carol!.request.post(`${path}/spectate`, { data: {} })).status()).toBe(200);
      const fullPage = await dave!.newPage();
      await fullPage.goto(`/duels/remote/${slug}`);
      await expect(fullPage.getByTestId("remote-load-note")).toContainText("limit of 10 spectators");
      await fullPage.close();
      db.prepare("delete from remote_spectators where table_id=? and user_id>=9000").run(tableId);

      // A spectator never holds a table open: the idle close ends it with the spectator still there, and she sees the end.
      await a.close(); await b.close();
      db.prepare("update remote_tables set last_event_at=?,started_at=? where id=?").run(Date.now() - 11 * 60_000, Date.now() - 20 * 60_000, tableId);
      await expect(c.getByTestId("spectator-note")).toContainText("This table has ended", { timeout: 60_000 });
      await c.close();

      // Private: no spectators by list, by link, by socket or by video. The invite link still seats a player.
      const closed = await alice!.request.post("/api/remote", { data: { gameId: "ygo", seatCount: 2, visibility: "private" } });
      expect(closed.status(), await closed.text()).toBe(201);
      const privateSlug = (await closed.json()).slug as string, privatePath = `/api/remote/${privateSlug}`;
      expect((await (await carol!.request.get("/api/remote?scope=open")).json()).tables.some((t: { slug: string }) => t.slug === privateSlug)).toBe(false);
      const no = await carol!.request.post(`${privatePath}/spectate`, { data: {} });
      expect([no.status(), (await no.json()).code]).toEqual([403, "TABLE_PRIVATE"]);
      expect((await carol!.request.get(`${privatePath}/connection`)).status()).toBe(404);
      expect((await carol!.request.post(`${privatePath}/livekit`)).status()).toBe(404);
      const privatePage = await carol!.newPage();
      await privatePage.goto(`/duels/remote/${privateSlug}`);
      await expect(privatePage.getByTestId("remote-load-note")).toContainText("private");
      await expect(privatePage.getByTestId("spectator-table")).toHaveCount(0);
      await privatePage.close();

      // The creator has the same choice. Its default is REMOTE_DEFAULT_VISIBILITY, Private.
      const creator = await alice!.newPage();
      await creator.goto("/duels/new?type=remote");
      await expect(creator.getByRole("radio", { name: "Private" })).toBeChecked();
      await creator.locator("label", { hasText: "Public" }).click();
      await expect(creator.getByTestId("remote-visibility-hint")).toContainText("can watch");
      await shot(creator, "spectator-creator");
    } finally { db.close(); await Promise.all([alice, bob, carol, dave].map(context => context!.close())); }
  });
});

// Standalone real-worker coverage: run with playwright.vision.config.ts and a prepared local lab.
const AUTO_CARD = process.env.E2E_AUTO_CARD ?? new URL('../../../data/vision/benchmark/field-watcher/card.png', import.meta.url).pathname;
const EXTRA_CARD = process.env.E2E_EXTRA_CARD ?? new URL('../../../data/vision/benchmark/field-watcher/44508094.png', import.meta.url).pathname;
const HAVE_FIXTURE_FILES = existsSync(AUTO_CARD) && existsSync(EXTRA_CARD);
const TRAP_CARD = process.env.E2E_TRAP_CARD ?? new URL('../../../data/vision/benchmark/field-watcher/41420027.png', import.meta.url).pathname;
test('field watcher owner: one card completes the full physical lifecycle',async({page,context})=>{
  test.skip(!HAVE_FIXTURE_FILES, NEED_FIXTURES);
  test.setTimeout(240_000);
  // A human choice must survive a frozen visibility flag and one bad HTTP frame.
  const {fieldEvidenceMatches,applyVerifiedFieldMutation}=await import('../../web/src/lib/remote/field-proposals');
  const track={id:'prompt-card',revision:4,state:'prompt',visible:false,removed:false,faceDown:false,lastSeen:performance.now()} as any;
  const event={type:'prompt',track:{...track},source:'auto'} as any;
  expect(fieldEvidenceMatches(event,track)).toBe(false);
  expect(fieldEvidenceMatches(event,track,true)).toBe(true);
  for(const stale of [{...track,removed:true},{...track,revision:5},{...track,faceDown:true},{...track,state:'dismissed'},{...track,lastSeen:performance.now()-1600}])expect(fieldEvidenceMatches(event,stale,true)).toBe(false);
  const confirmed:any[]=[],saved={state:{undo:{actionId:''}}};
  const identified={type:'card.identified',source:'auto',actorSeat:0,seat:0,cardRef:track.id,cardId:97522863,zone:'monster',slot:3} as const;
  expect(await applyVerifiedFieldMutation(event,()=>track,async(proposal,id)=>{confirmed.push(proposal);saved.state.undo.actionId=id!;track.visible=false;track.lastSeen-=1600;return saved as any;},identified,true)).toBe(saved);
  expect(confirmed).toEqual([identified]);
  const {ygoModule,remoteActionSchema}=await import('../../shared/src/remote/index');
  for(const [delay,slot,version,expected] of [[1000,3,undefined,1],[2600,3,undefined,2],[1000,4,undefined,2],[1000,3,3,2],[1000,3,4,1],[1000,3,5,1]] as const){
    let state=ygoModule.initialState({seatCount:2}),at=0;
    const act=(input:Record<string,unknown>)=>state=ygoModule.reduce(state,remoteActionSchema.parse({actorSeat:0,seat:0,at,idempotencyKey:crypto.randomUUID(),...input}),version?{replay:true,twinPlacementGuard:version}:undefined);
    act({type:'twin.place',zone:'monster',card:{ref:'lifted',cardId:97522863,name:'The Man with the Mark',slot:3,faceUp:true,position:'attack'}});
    at=1000;act({type:'twin.move',source:'auto',cardRef:'lifted',zone:'hand'});
    at+=delay;act({type:'twin.place',source:'auto',zone:'monster',card:{ref:'new-outline',slot,faceUp:false,position:'defense'}});
    expect(state.seats[0].twin).toHaveLength(expected);
    if(expected===1){expect(state.seats[0].twin[0]).toMatchObject({ref:'lifted',name:'The Man with the Mark',zone:'monster',slot:3,faceUp:false});expect(state.seats[0].twin[0].departedFrom).toBeUndefined();}
  }
  // Field ownership has no expiry. Only a surviving field/pile witness proves
  // a second copy; an old automatic hand departure retains its field origin.
  for(const departed of [false,true]){
    let state=ygoModule.initialState({seatCount:2}),at=0;
    const act=(input:Record<string,unknown>)=>state=ygoModule.reduce(state,remoteActionSchema.parse({actorSeat:0,seat:0,at,idempotencyKey:crypto.randomUUID(),...input}));
    const card={cardId:97522863,name:'The Man with the Mark',faceUp:true,position:'attack'};
    act({type:'twin.place',zone:'monster',card:{...card,ref:'field-owner',slot:3}});
    if(departed){at=1000;act({type:'twin.move',source:'auto',cardRef:'field-owner',zone:'hand'});}
    at=1_000_000_000;act({type:'twin.place',source:'auto',zone:'monster',card:{...card,ref:'late-read',slot:4}});
    expect(state.seats[0].twin).toEqual([expect.objectContaining({ref:'field-owner',zone:'monster',slot:4})]);
    expect(state.twinConfirmation).toBeUndefined();
  }
  for(const origin of ['monster','graveyard','banished'] as const){
    let state=ygoModule.initialState({seatCount:2});
    const card={cardId:97522863,name:'The Man with the Mark',faceUp:true,position:'attack'};
    for(const [at,zone,ref,slot] of [[0,origin,'still-there',3],[1_000_000_000,'monster','new-copy',4]] as const){
      state=ygoModule.reduce(state,remoteActionSchema.parse({type:'twin.place',source:'auto',actorSeat:0,seat:0,at,idempotencyKey:crypto.randomUUID(),zone,card:{...card,ref,slot},...(at&&origin==='monster'?{copyProof:{simultaneousQuads:2,at}}:{})}));
    }
    expect(state.seats[0].twin).toHaveLength(2);
    expect(state.seats[0].twin[0]).toMatchObject({ref:'still-there',zone:origin});
    expect(state.twinConfirmation).toBeUndefined();
  }
  const {createFieldWatcher,createFieldCalibration,yugioh}=await import('@yugidraft/vision');
  const width=96,height=140,data=new Uint8ClampedArray(width*height*4);
  for(let py=0;py<height;py++)for(let px=0;px<width;px++){
    const x=px/width,y=py/height;
    const rgb=x<.06||x>.94||y<.04||y>.96?[25,25,25]:x>.12&&x<.88&&y>.18&&y<.70?[60+140*x,40+130*y,70+80*Math.sin(35*x)*Math.cos(30*y)]:x>.10&&x<.90&&y>.76&&y<.92?(y%.035<.012?[65,55,45]:[220,210,180]):[35,145,120];
    data.set([...rgb,255],(py*width+px)*4);
  }
  for(const reverse of [false,true]){
    let at=1_000_000_000;const events:any[]=[];
    const card={kind:'face-up',confidence:.95,partial:false,quad:[{x:.634,y:.3},{x:.694,y:.3},{x:.694,y:.456},{x:.634,y:.456}]} as const;
    const known:any[]=[{id:'field-owner',zone:'M3',cardId:'97522863'},{id:'hand-copy',zone:'HAND',cardId:'97522863'}];
    if(reverse)known.reverse();
    const watcher=createFieldWatcher({profile:yugioh,calibration:createFieldCalibration([{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]),now:()=>at,hidden:()=>false,clone:async f=>f,getKnownCards:()=>known,
      buffer:{sample:async()=>({frame:{width:160,height:90,data:new Uint8ClampedArray(160*90*4)} as ImageData,at})},
      recognizer:{detectCards:async()=>[structuredClone(card)] as any,recognize:async()=>({candidates:[{cardId:'97522863',score:.95}],tier:'sure',quality:{detected:true,cornersFound:true,framesUsed:1,selectedFrameIndices:[0],sharpness:20,fallback:false},identityEmbedding:{space:'art-box',values:[1,0]},timingsMs:{total:1},backend:'wasm'}) as any},
      analyze:()=>({crop:()=>({width,height,data}),motion:()=>0,sharpness:()=>20,appearance:()=>Array.from({length:12},(_,i)=>i%2?.6:.2),halo:()=>Array(192).fill(.2)})});
    watcher.subscribe(event=>events.push(event));
    try{for(let n=0;n<12;n++){at+=100;await watcher.tick();await Promise.resolve();}
      const arrival=events.find(event=>['placed','moved'].includes(event.type));
      expect(arrival?.track).toMatchObject({id:'field-owner',zone:'M4',cardId:'97522863'});
      expect(events.filter(event=>event.type==='prompt')).toEqual([]);
    }finally{watcher.dispose();}
  }
  const origin=process.env.E2E_REMOTE_UI_URL??'http://localhost:3455';
  await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,origin);
  const slug=await soloTable(context.request,2),path=`/api/remote/${slug}`;
  const writes:any[]=[],errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.text().includes('[remote field]'))console.log(message.text());});
  page.on('response',response=>{if(response.url().endsWith(`${path}/actions`)&&response.request().method()==='POST')writes.push({action:response.request().postDataJSON().action,status:response.status()});});
  const cardId=97522863,name='The Man with the Mark';
  await page.route('**/api/cards/resolve',route=>route.fulfill({json:{cards:[{id:cardId,name,type:'Effect Monster',frameType:'effect',race:'Spellcaster',effectText:''}]}}));
  await appearingCamera(page,process.env.E2E_OWNER_CARD??new URL('../../../data/vision/benchmark/field-watcher/97522863.jpg',import.meta.url).pathname);
  // Optional deterministic inference replays provider timing and result shapes;
  // the camera pixels, analyzer, tracker and application remain the real path.
  if(process.env.E2E_SCENARIO_WORKER==='1')await page.route('**/dev/vision-assets/yugioh-index.meta.json',route=>route.fulfill({json:{entries:[{cardId:String(cardId),passcode:cardId,name},{cardId:'46986414',passcode:46986414,name:'Dark Magician'}]}}));
  if(process.env.E2E_SCENARIO_WORKER==='1')await page.addInitScript(backend=>{
    const NativeWorker=window.Worker;
    window.Worker=class extends EventTarget {
      onmessage:((event:MessageEvent)=>void)|null=null;onerror=null;onmessageerror=null;
      constructor(url:string|URL,options?:WorkerOptions){super();if(!String(url).includes('vision-lab/assets/worker.js'))return new NativeWorker(url,options) as any;}
      terminate(){}
      postMessage(message:any){
        const physical=(window as any).fieldTest.snapshot(),{x,y,defense,back,visible,covered}=physical;
        const w=defense?262:180,h=defense?180:262;
        const card={quad:[{x:x/1280,y:y/720},{x:(x+w)/1280,y:y/720},{x:(x+w)/1280,y:(y+h)/720},{x:x/1280,y:(y+h)/720}],kind:(window as any).fieldScenarioKind??(back?'face-down':'face-up'),confidence:(window as any).fieldScenarioConfidence??.95,partial:false};
        if(message.type==='detect')(window as any).fieldScenarioDetectedConfidence=card.confidence;
        const result=message.type==='detect'?(visible&&!covered?[card]:[]):message.type==='recognize'?{
          candidates:[{cardId:'97522863',score:.9},{cardId:'46986414',score:.5}],tier:(window as any).fieldScenarioTier??'not sure',
          quality:{sharpness:80,detected:true,cornersFound:true,framesUsed:1,selectedFrameIndices:[0],fallback:false,partial:false,covered:false,faceDown:false},
          identityEmbedding:{space:'art-box',values:[1,0]},timingsMs:{total:68},backend,
        }:{backend};
        message.frame?.close?.();for(const frame of message.frames??[])frame.close?.();
        setTimeout(()=>{const event=new MessageEvent('message',{data:{id:message.id,result,detectorBackend:backend,backendStatus:{backend,models:[{model:'detector',backend,gpu:{modelPath:'fp32'}}]}}});this.onmessage?.(event);this.dispatchEvent(event);},message.type==='detect'?68:20);
      }
    } as any;
  },process.env.E2E_RECOGNITION_MODE==='gpu'?'webgpu':'wasm');
  await page.addInitScript(()=>{
    const calibration={version:1,layout:2,corners:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],orientation:{playerSide:'top',mirrored:false}};
    for(const suffix of ['',':device:field-test-camera'])localStorage.setItem(`dd-field-watcher:v1:900000000000000001:101:0${suffix}`,JSON.stringify({enabled:true,calibration,placed:true}));
  });
  await page.addInitScript(mode=>localStorage.setItem('dd-remote-recognition-mode',mode),process.env.E2E_RECOGNITION_MODE??'cpu');
  if(process.env.E2E_SCENARIO_CHOICE==='1')await page.addInitScript(()=>(window as any).fieldScenarioTier='low match');
  await page.goto(`/duels/remote/${slug}`);
  await expect(async()=>{
    const camera=page.getByTestId('camera-on-feed');if(await camera.count())await camera.click();
    await expect(page.getByTestId('field-watcher-status')).toContainText('Watching field',{timeout:10_000});
  }).toPass({timeout:90_000});
  const room=async()=>context.request.get(path).then(r=>r.json());let ref:string|undefined;
  const check=async(zone:string,slot:number|undefined,faceUp:boolean,position='attack')=>{
    await expect.poll(async()=>{
      const twin=(await room()).state.seats[0].twin;
      return {cards:twin.map((c:any)=>({ref:c.ref,zone:c.zone,slot:c.slot,faceUp:c.faceUp,position:c.position,cardId:c.cardId})),hand:twin.filter((c:any)=>c.zone==='hand').length,gy:twin.filter((c:any)=>c.zone==='graveyard').length,banished:twin.filter((c:any)=>c.zone==='banished').length,deck:twin.filter((c:any)=>c.zone==='deck').length,extra:twin.filter((c:any)=>c.zone==='extra').length};
    },{timeout:20_000}).toEqual({cards:[{ref:ref??expect.any(String),zone,slot,faceUp,position,cardId}],hand:Number(zone==='hand'),gy:Number(zone==='graveyard'),banished:Number(zone==='banished'),deck:Number(zone==='deck'),extra:Number(zone==='extra')});
    const twin=(await room()).state.seats[0].twin;ref??=twin[0].ref;
    if(zone==='monster')await expect(page.getByTestId('field-0').locator(`[data-zone="m${slot}"]`)).toHaveAttribute('aria-label',faceUp?new RegExp(name):/Face-down/);
  };
  const place=async(x:number,y=315,down=false,rotated=down)=>page.evaluate(({x,y,down,rotated})=>{const camera=(window as any).fieldTest;camera.back(down?'#1e3cbe':'');camera.place(x,y,rotated);},{x,y,down,rotated});
  await place(550);
  if(process.env.E2E_SCENARIO_CHOICE==='1'){
    const prompt=page.getByTestId('field-watcher-prompt');await expect(prompt).toBeVisible();
    await page.evaluate(()=>((window as any).fieldTest).cover(true));
    await page.waitForTimeout(1800);
    await prompt.getByRole('button',{name:/The Man with the Mark/}).click();
    await expect(page.getByRole('status').filter({hasText:'Card is moving or covered. Keep it still, then choose again.'})).toBeVisible();
    await page.evaluate(()=>((window as any).fieldTest).cover(false));
    await page.waitForTimeout(500);
    if(process.env.E2E_SCENARIO_WORKER==='1'){
      await page.evaluate(()=>(window as any).fieldScenarioConfidence=.65);
      await expect.poll(()=>page.evaluate(()=>(window as any).fieldScenarioDetectedConfidence)).toBe(.65);
      await page.waitForTimeout(200);
    }
    await prompt.getByRole('button',{name:/The Man with the Mark/}).click();
    await page.evaluate(()=>{(window as any).fieldScenarioTier='not sure';delete (window as any).fieldScenarioConfidence;});
  }
  await check('monster',3,true);await expect(page.getByTestId('field-watcher-prompt')).toHaveCount(0);
  if(process.env.E2E_SCENARIO_COVER!=='0'){
    await page.evaluate(()=>((window as any).fieldTest).cover(true));
    await page.getByRole('button',{name:'Camera off',exact:true}).click();
    await page.getByTestId('camera-on-feed').click();
    await expect(page.getByTestId('field-watcher-status')).toContainText('Watching field');
    await page.waitForTimeout(6500);await check('monster',3,true);
    await page.evaluate(()=>((window as any).fieldTest).cover(false));await check('monster',3,true);
  }
  await place(509,356,true);await check('monster',3,false,'defense');
  const beforeFlip=(await room()).events.length;
  if(process.env.E2E_SCENARIO_REVEAL==='1')await page.evaluate(()=>(window as any).fieldScenarioTier='low match');
  if(process.env.E2E_SCENARIO_WORKER==='1'){
    // The raw detector still reports the back while the lifted front crosses
    // toward M2. An incomplete face gate must not send any field move.
    await page.evaluate(()=>(window as any).fieldScenarioKind='face-down');
    await place(620);await page.waitForTimeout(450);
    await check('monster',3,false,'defense');
    expect((await room()).events.slice(beforeFlip).filter((e:any)=>e.action.type==='twin.move')).toEqual([]);
    await page.evaluate(()=>delete (window as any).fieldScenarioKind);
  }
  await place(550);
  if(process.env.E2E_SCENARIO_REVEAL==='1'){
    const prompt=page.getByTestId('field-watcher-prompt');await expect(prompt).toBeVisible();
    await prompt.getByRole('button',{name:/The Man with the Mark/}).click();
    await page.evaluate(()=>(window as any).fieldScenarioTier='not sure');
  }
  await check('monster',3,true);
  const revealed=(await room()).events.slice(beforeFlip);
  expect(revealed.filter((e:any)=>e.action.type==='twin.flip'&&e.action.faceUp)).toHaveLength(1);
  expect(revealed.find((e:any)=>e.action.type==='twin.flip'&&e.action.faceUp).action).toMatchObject({cardRef:ref,cardId,name,source:'auto'});
  expect(revealed.filter((e:any)=>['twin.place','card.identified'].includes(e.action.type))).toEqual([]);
  if(process.env.E2E_SCENARIO_REVEAL==='1'){
    // The same physical track can ask again at a later face revision.
    await place(509,356,true);await check('monster',3,false,'defense');
    await page.evaluate(()=>(window as any).fieldScenarioTier='low match');
    await place(550);
    const prompt=page.getByTestId('field-watcher-prompt');await expect(prompt).toBeVisible();
    await prompt.getByRole('button',{name:/The Man with the Mark/}).click();
    await check('monster',3,true);await expect(prompt).toHaveCount(0);
    await page.evaluate(()=>(window as any).fieldScenarioTier='not sure');
  }
  await place(509,356,false,true);await check('monster',3,true,'defense');
  await place(550);await check('monster',3,true);
  await page.evaluate(()=>((window as any).fieldTest).clear());await page.waitForTimeout(100);
  await place(550);await check('monster',3,true);
  expect((await room()).events.slice(beforeFlip).filter((e:any)=>e.action.type==='twin.move'&&e.action.zone==='monster'&&e.action.slot!==3)).toHaveLength(0);
  await place(375);await check('monster',4,true);
  await page.waitForTimeout(3000);
  await place(550);await check('monster',3,true);
  await expect(page.getByTestId('field-watcher-prompt')).toHaveCount(0);
  expect(writes.filter(write=>write.action.type==='twin.move'&&write.action.zone==='hand')).toEqual([]);
  await place(30);await check('graveyard',undefined,true);
  await place(720);await check('monster',2,true);
  expect(writes.filter(write=>write.action.type==='twin.move'&&write.action.zone==='hand')).toEqual([]);
  await page.evaluate(()=>((window as any).fieldTest).clear());await check('hand',undefined,true);
  await place(720);await check('monster',2,true);
  await place(30,450);await check('banished',undefined,true);
  await place(720);await check('monster',2,true);
  await place(30,50);await check('deck',undefined,false);
  await place(720);await check('monster',2,true);
  await place(1080,50);await check('extra',undefined,false);
  await place(720);await check('monster',2,true);
  await page.evaluate(()=>((window as any).fieldTest).clear());await check('hand',undefined,true);
  await page.getByRole('button',{name:'Camera off',exact:true}).click();
  await page.waitForTimeout(2700);await place(550);
  await page.getByTestId('camera-on-feed').click();
  await check('monster',3,true);
  await page.evaluate(()=>((window as any).fieldTest).clear());await check('hand',undefined,true);
  // Restart with an expired field departure and an ordinary hand copy of X.
  // The inferred hand reservation must not replace the recorded field owner.
  await page.getByRole('button',{name:'Camera off',exact:true}).click();
  const beforeRestart=await room();
  const handCopy=await context.request.post(`${path}/actions`,{data:{baseSeq:beforeRestart.lastSeq,action:{type:'twin.place',actorSeat:0,seat:0,zone:'hand',anotherCopy:true,card:{ref:'ordinary-hand-copy',cardId,name,faceUp:false,position:'attack'},idempotencyKey:crypto.randomUUID()}}});
  expect(handCopy.ok()).toBe(true);
  await page.waitForTimeout(2700);await place(550);
  await page.getByTestId('camera-on-feed').click();
  await expect.poll(async()=>{
    const twins=(await room()).state.seats[0].twin;
    return {count:twins.length,field:twins.filter((c:any)=>c.zone==='monster').map((c:any)=>({ref:c.ref,slot:c.slot})),hand:twins.filter((c:any)=>c.zone==='hand').map((c:any)=>c.ref)};
  }).toEqual({count:2,field:[{ref,slot:3}],hand:['ordinary-hand-copy']});
  await expect(page.getByTestId('field-watcher-prompt')).toHaveCount(0);
  expect(writes.every(write=>write.status===200)).toBe(true);expect(errors).toEqual([]);
  console.log(JSON.stringify({scenario:'owner lifecycle',backend:process.env.E2E_RECOGNITION_MODE??'cpu',writes:writes.map(w=>w.action.type)}));
  await page.getByRole('button',{name:'Camera off',exact:true}).click();
});
async function appearingCamera(page:Page,cardFile=AUTO_CARD,guided=false) {
  const data=readFileSync(cardFile).toString('base64');
  await page.addInitScript(async ({data,guided})=>{
    if(!guided){const calibration={version:1,corners:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],orientation:{playerSide:'bottom',mirrored:false}};for(const key of ['900000000000000001:101:0','900000000000000001:102:1','vision-lab:normal:own:0'])for(const suffix of ['',':device:field-test-camera'])localStorage.setItem(`dd-field-watcher:v1:${key}${suffix}`,JSON.stringify({enabled:true,calibration,placed:true}));}
    const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d')!;
    const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));const image=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
    let back='',stacks=false,sleeve:ImageBitmap|null=null;let covered=false;let visible=false,x=460,y=170,defense=false,jitter=false,markers=false,others:{x:number;y:number}[]=[];
    const paint=()=>{ctx.fillStyle=guided?'#101010':'#26392f';ctx.fillRect(0,0,1280,720);if(stacks){ctx.fillStyle='#1e3cbe';ctx.fillRect(30,50,110,160);ctx.fillRect(1140,50,110,160);}if(markers){ctx.drawImage(image,250,172,140,204);ctx.drawImage(image,890,172,140,204);}if(visible){ctx.save();if(jitter){const phase=performance.now()/1400;ctx.filter=`brightness(${.85+.12*Math.sin(phase)})`;ctx.translate(x+90,y+131);ctx.rotate(.04*Math.sin(phase*.7));ctx.translate(-x-90,-y-131);}if(defense){ctx.translate(x+131,y+90);ctx.rotate(Math.PI/2);if(back){if(sleeve)ctx.drawImage(sleeve,-90,-131,180,262);else{ctx.fillStyle=back;ctx.fillRect(-90,-131,180,262);}}else ctx.drawImage(image,-90,-131,180,262);}else if(back){if(sleeve)ctx.drawImage(sleeve,x,y,180,262);else{ctx.fillStyle=back;ctx.fillRect(x,y,180,262);}}else ctx.drawImage(image,x,y,180,262);ctx.restore();if(covered){ctx.fillStyle='#bb8c68';ctx.fillRect(x-150,y-150,(defense?262:180)+300,(defense?180:262)+300);}for(const other of others)ctx.drawImage(image,other.x,other.y,180,262);}};
    (window as any).fieldTest={snapshot:()=>({visible,x,y,defense,back,covered}),cover:(value:boolean)=>{covered=value;paint();},texture:async(on=true)=>{sleeve=on?await createImageBitmap(await(await fetch('/duel/card-back-main-hd.webp')).blob()):null;paint();},back:(colour:string)=>{back=colour;paint();},stacks:(on:boolean)=>{stacks=on;paint();},appear:()=>{visible=true;paint();},place:(left:number,top:number,def=false)=>{x=left;y=top;defense=def;visible=true;paint();},move:()=>{x=660;y=185;paint();},jitter:(active:boolean)=>{jitter=active;paint();},calibrateTwo:()=>{markers=true;visible=false;paint();},clear:()=>{visible=false;markers=false;others=[];paint();},many:(points:{x:number;y:number}[])=>{[ {x,y},...others]=points;visible=true;paint();}};
    paint();setInterval(paint,65);
    navigator.mediaDevices.getUserMedia=async constraints=>{if(!constraints?.video)throw new DOMException('Video only','NotFoundError');const stream=canvas.captureStream(15),track=stream.getVideoTracks()[0],settings=track.getSettings.bind(track);track.getSettings=()=>({...settings(),deviceId:'field-test-camera'});return stream;};
    navigator.mediaDevices.enumerateDevices=async()=>[];
  },{data,guided});
}
test('field watcher automatic: owner table applies once and Undo removes the atomic placement',async({page,context})=>{
  test.skip(!HAVE_FIXTURE_FILES || !HAVE_VISION_LAB, `${NEED_FIXTURES} and the vision lab`);
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
  expect(placed.state.seats[0].twin[0]).toMatchObject({zone:'spell-trap',slot:2});
  expect(placed.events.filter((e:any)=>e.action.type==='twin.place'&&e.action.source==='auto')).toHaveLength(1);
  expect(placed.events.some((e:any)=>e.action.type==='card.identified')).toBe(false);
  await page.getByTestId('undo').click();await expect.poll(async()=>(await room()).state.seats[0].twin.length).toBe(0);
  await page.waitForTimeout(2500);expect((await room()).state.seats[0].twin).toHaveLength(0);
  await page.evaluate(()=>{
    const feed=document.querySelector<HTMLElement>('[data-testid="feed-0"]')!,video=feed.querySelector('video')!,r=feed.getBoundingClientRect();
    const scale=Math.min(r.width/video.videoWidth,r.height/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale;
    feed.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+(r.width-w)/2+550/1280*w,clientY:r.top+(r.height-h)/2+301/720*h}));
  });
  // A clear read opens the card at once; any other read opens the tray.
  await expect(page.getByTestId('card-popover').or(page.getByTestId('recognition-tray')).first()).toBeVisible();await page.keyboard.press('Escape');
  await expect(page.getByTestId('card-popover')).toHaveCount(0);
  await page.getByLabel('Auto-detect cards',{exact:true}).uncheck();await expect(page.getByTestId('field-watcher-status')).toHaveText('Tap to identify');
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
test('field watcher automatic: tap to identify reads every camera on a click, runs nothing while idle, and a slow computer gets one offer',async({browser})=>{
  test.skip(!HAVE_VISION_LAB, NEED_LAB);
  test.setTimeout(360_000);const origin=process.env.VISION_LAB_ORIGIN??'http://127.0.0.1:3449',options={permissions:['camera','microphone'],baseURL:origin,viewport:{width:1920,height:1080}};
  const alice=await browser.newContext(options),bob=await browser.newContext(options);
  try{
    await authenticatePlayer(alice.request,{userId:101},process.env.E2E_AUTH_SECRET!,origin);await authenticatePlayer(bob.request,{userId:102},process.env.E2E_AUTH_SECRET!,origin);
    // The offer sits in the dock, clear of the LP buttons at every size and table shape, and goes with no answer after its time.
    const weak=(page:Page)=>page.addInitScript(()=>{Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>2});localStorage.setItem('dd-remote-recognition-mode','cpu');});
    const carol=await browser.newContext(options);
    try{
      await authenticatePlayer(carol.request,{userId:101},process.env.E2E_AUTH_SECRET!,origin);
      for(const seats of [3,4] as const){
        const page=await carol.newPage();await appearingCamera(page);await weak(page);await page.goto(`/duels/remote/${await soloTable(carol.request,seats)}`);await page.getByTestId('camera-on-feed').click();
        const notice=page.locator('[data-testid="notify-dock-0"]').getByTestId('tap-identify-offer');await expect(notice).toBeVisible({timeout:60_000});
        for(const [width,height] of [[1920,1080],[2560,1440],[1366,768],[390,844]] as const){
          await page.setViewportSize({width,height});await page.waitForTimeout(300);
          expect(await page.evaluate(()=>{const d=document.querySelector('[data-testid="notify-dock-0"]')!.getBoundingClientRect();return Array.from(document.querySelectorAll('[data-testid="lp-0"] button,[data-testid="lp-0"] input')).map(b=>b.getBoundingClientRect()).filter(r=>r.width&&r.left<d.right&&r.right>d.left&&r.top<d.bottom&&r.bottom>d.top).length;}),`${seats} seats at ${width}x${height}`).toBe(0);
        }
        if(seats===4){await expect(notice).toHaveCount(0,{timeout:25_000});expect(await page.evaluate(()=>localStorage.getItem('dd-remote-tap-offer:v1'))).toBeNull();}
        await page.close();
      }
    }finally{await carol.close();}
    const slug=await startTwoPlayerTable(alice.request,bob.request),a=await alice.newPage(),b=await bob.newPage();
    for(const page of [a,b]){await appearingCamera(page);await page.addInitScript(()=>{
      (window as any).visionCalls=[];const post=Worker.prototype.postMessage;
      Worker.prototype.postMessage=function(...args:any[]){if(['recognize','detect'].includes(args[0]?.type))(window as any).visionCalls.push(args[0].type);return (post as any).apply(this,args);};
    });}
    // Alice has a weak computer on the CPU.
    await weak(a);
    await Promise.all([a.goto(`/duels/remote/${slug}`),b.goto(`/duels/remote/${slug}`)]);
    for(const page of [a,b])await page.getByTestId('camera-on-feed').click();
    const offer=a.getByTestId('tap-identify-offer');await expect(offer).toContainText('Switch to tap-to-identify?',{timeout:60_000});
    const boxes=async()=>a.evaluate(()=>['feed-box-0','remote-table'].map(id=>{const r=document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();return [r.left,r.top,r.width,r.height];}));
    await offer.getByRole('button',{name:'Switch',exact:true}).click();await expect(offer).toHaveCount(0);await expect(a.getByTestId('field-watcher-status')).toHaveText('Tap to identify');
    // Tap to identify starts with the virtual field hidden, so the camera may move once. After that it stays put.
    await expect(a.getByTestId('field-toggle-0')).toContainText('Show virtual field');
    const settled=await boxes();await a.waitForTimeout(800);expect(await boxes()).toEqual(settled);
    await expect(a.getByLabel('Auto-detect cards',{exact:true})).not.toBeChecked();expect(await a.evaluate(()=>localStorage.getItem('dd-remote-tap-offer:v1'))).toBe('switch');
    // Bob changes the mode in the Settings menu; the checkbox follows.
    await b.getByTestId('camera-settings').first().click();await pickSelect(b,'Card detection',{value:'tap'});await b.keyboard.press('Escape');await expect(b.getByLabel('Auto-detect cards',{exact:true})).not.toBeChecked();
    await expect.poll(()=>b.locator('[data-testid="feed-0"] video').evaluate((v:HTMLVideoElement)=>v.videoWidth),{timeout:40_000}).toBeGreaterThan(0);
    // Bob sees Alice's mode on her camera.
    await expect(b.getByTestId('feed-tap-tag')).toBeVisible();await expect(b.locator('[data-testid="feed-0"]').locator('..').getByTestId('zone-grid-toggle')).toBeDisabled();
    await a.evaluate(()=>((window as any).fieldTest).appear());await a.waitForTimeout(1500);
    const calls=(page:Page,type:string)=>page.evaluate(t=>(window as any).visionCalls.filter((c:string)=>c===t).length,type);
    const before=await Promise.all([a,b].flatMap(page=>[calls(page,'detect'),calls(page,'recognize')]));
    await a.waitForTimeout(5000);
    expect(await Promise.all([a,b].flatMap(page=>[calls(page,'detect'),calls(page,'recognize')]))).toEqual(before);
    const clickCard=(page:Page)=>page.evaluate(()=>{
      const feed=document.querySelector<HTMLElement>('[data-testid="feed-0"]')!,video=feed.querySelector('video')!,r=feed.getBoundingClientRect();
      const scale=Math.min(r.width/video.videoWidth,r.height/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale;
      feed.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+(r.width-w)/2+550/1280*w,clientY:r.top+(r.height-h)/2+301/720*h}));
    });
    for(const page of [a,b]){
      const detect=await calls(page,'detect');await clickCard(page);
      await expect(page.getByTestId('card-popover').or(page.getByTestId('recognition-tray')).first()).toBeVisible({timeout:30_000});
      expect(await calls(page,'detect')).toBe(detect+1);
      if(await page.getByTestId('recognition-tray').isVisible()){await page.getByTestId('confirm-card').click();await expect(page.getByTestId('card-popover')).toBeVisible({timeout:15_000});}
      // A read on a tap seat adds nothing to the shared board.
      expect((await alice.request.get(`/api/remote/${slug}`).then(r=>r.json())).state.seats[0].twin).toHaveLength(0);
    }
    // The opponent's auto-detect is off, so no outlines came: Alice's own reader answered Bob's click.
    expect(await calls(a,'recognize')).toBeGreaterThanOrEqual(2);
    const room=()=>alice.request.get(`/api/remote/${slug}`).then(r=>r.json());
    // The card turns face down: Alice's click names it from her own memory, and the table hears nothing of it.
    const seenCard=(await a.getByTestId('card-popover').getAttribute('aria-label'))!;await expect(a.getByTestId('card-last-read')).toHaveCount(0);
    const actionPosts:string[]=[];a.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/actions'))actionPosts.push(r.url());});
    const identifiedBefore=(await room()).events.filter((e:any)=>e.action.type==='card.identified').length;
    await a.keyboard.press('Escape');await a.evaluate(async()=>{const camera=(window as any).fieldTest;await camera.texture();camera.back('#1e3cbe');});await a.waitForTimeout(500);
    const recalled=calls(a,'detect').then(n=>n+1);await clickCard(a);
    await expect(a.getByTestId('card-last-read')).toContainText('Last read here, may have changed',{timeout:30_000});await expect(a.getByTestId('card-read-again')).toBeVisible();await expect(a.getByTestId('card-popover')).toHaveAttribute('aria-label',seenCard);
    expect(await calls(a,'detect')).toBe(await recalled);
    await expect(a.getByTestId('card-popover').getByRole('button',{name:'Wrong card?'})).toBeVisible();await expect(a.getByTestId('pin-inspector')).toHaveCount(0);
    await expect(b.getByTestId('card-last-read')).toHaveCount(0);await a.waitForTimeout(1000);
    expect(actionPosts).toEqual([]);const after=await room();expect(after.state.seats[0].twin).toHaveLength(0);expect(after.events.filter((e:any)=>e.action.type==='card.identified')).toHaveLength(identifiedBefore);
    await a.evaluate(async()=>{const camera=(window as any).fieldTest;await camera.texture(false);camera.back('');});
    // Read board on a tap seat places nothing.
    await a.keyboard.press('Escape');await a.getByTestId('feed-box-0').hover();await a.getByTestId('feed-box-0').getByTestId('freeze-feed').click();await a.getByTestId('feed-box-0').getByTestId('read-board').click();await expect(a.getByTestId('feed-box-0').getByTestId('read-board')).toBeEnabled({timeout:60_000});await a.waitForTimeout(1000);
    expect((await room()).state.seats[0].twin).toHaveLength(0);await a.getByTestId('feed-box-0').getByTestId('resume-live').click();
    // Back to Auto-detect with a manual card: the hold survives a reload and the board does not change.
    const seen=await room();
    expect((await alice.request.post(`/api/remote/${slug}/actions`,{data:{baseSeq:seen.lastSeq,action:{type:'twin.place',actorSeat:0,seat:0,zone:'monster',idempotencyKey:crypto.randomUUID(),card:{ref:'manual-hold',cardId:5318639,name:'Mystical Space Typhoon',slot:3,faceUp:true,position:'attack'}}}})).ok()).toBe(true);
    await expect.poll(()=>a.evaluate(()=>document.querySelector('[data-testid="feed-box-0"]')!==null)).toBe(true);await a.getByTestId('feed-box-0').hover();await a.getByLabel('Auto-detect cards',{exact:true}).check();await expect(a.getByTestId('sync-board-hold')).toBeVisible();
    const held=JSON.stringify((await room()).state.seats[0].twin);
    await a.reload();await a.getByTestId('camera-on-feed').click();await expect(a.getByTestId('sync-board-hold')).toBeVisible({timeout:30_000});
    await a.waitForTimeout(20_000);expect(JSON.stringify((await room()).state.seats[0].twin)).toBe(held);
  }finally{await Promise.allSettled([alice.close(),bob.close()]);}
});
async function measuredFieldChange(page:Page,kind:'move'|'remove') {
  return page.evaluate(kind=>new Promise<number>((resolve,reject)=>{
    const started=performance.now(),observer=new MutationObserver(()=>{
      const done=kind==='move'?document.querySelector('[data-testid="field-0"] [data-zone="e2"]')?.textContent?.includes('Stardust'):document.querySelector('[data-testid="field-departure-toast"]')?.textContent?.includes('left the field');
      if(done){clearTimeout(timer);observer.disconnect();resolve(performance.now()-started);}
    }),timer=setTimeout(()=>{observer.disconnect();reject(Error('Camera field update timed out: '+kind));},15000);
    observer.observe(document.body,{childList:true,subtree:true});
    if(kind==='move')(window as any).fieldTest.place(714,8,false);else (window as any).fieldTest.clear();
  }),kind);
}
for(const seatCount of [2,4] as const)test(`field watcher automatic: responsive best-match and calibration screenshots for ${seatCount} seats`,async({page,context})=>{
  test.skip(!HAVE_FIXTURE_FILES || !HAVE_VISION_LAB, `${NEED_FIXTURES} and the vision lab`);
  test.setTimeout(180_000);const origin=process.env.VISION_LAB_ORIGIN??'http://127.0.0.1:3449';
  await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,origin);
  const slug=await soloTable(context.request,seatCount),directory=process.env.E2E_FIELD_SHOTS??new URL('../../../data/vision/benchmark/field-watcher/r1-shots/',import.meta.url).pathname;
  mkdirSync(directory,{recursive:true});await appearingCamera(page);await page.goto(`/duels/remote/${slug}`);
  await page.getByTestId('camera-on-feed').click();await expect(page.getByTestId('field-watcher-status')).toContainText('Watching field');
  await page.evaluate(()=>((window as any).fieldTest).many([{x:300,y:440},{x:800,y:440}]));
  const prompt=page.getByTestId('field-watcher-prompt');await expect.poll(async()=>(await context.request.get(`/api/remote/${slug}`).then(r=>r.json())).state.seats[0].twin.length,{timeout:40_000}).toBe(2);await expect(prompt).toHaveCount(0);
  for(const [width,height] of [[1920,1080],[2560,1440],[1366,768],[390,844]] as const){
    await page.setViewportSize({width,height});await page.getByTestId('feed-box-0').focus();await page.waitForTimeout(250);
    await expect(prompt).toHaveCount(0);
    const checkBounds=async(locator:ReturnType<Page['locator']>)=>{
      const rect=await locator.boundingBox();expect(rect).not.toBeNull();expect(rect!.x).toBeGreaterThanOrEqual(0);expect(rect!.y).toBeGreaterThanOrEqual(0);
      expect(rect!.x+rect!.width).toBeLessThanOrEqual(width+1);expect(rect!.y+rect!.height).toBeLessThanOrEqual(height+1);
    };
    const overlap=await page.getByTestId('feed-box-0').evaluate(host=>{
      const toolbar=host.querySelector('[data-feed-toolbar]')!,chip=host.querySelector('[data-field-watcher-status-slot]')!,tag=chip.previousElementSibling!;
      const camera=Array.from(host.children).find(node=>node.className.includes('camsel'));
      const intersects=(a:Element,b:Element)=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return Math.min(x.right,y.right)>Math.max(x.left,y.left)&&Math.min(x.bottom,y.bottom)>Math.max(x.top,y.top);};
      return {chipTag:intersects(chip,tag),toolbarCamera:camera?intersects(toolbar,camera):false};
    });
    expect(overlap).toEqual({chipTag:false,toolbarCamera:false});
    await page.screenshot({path:`${directory}/${seatCount===2?'1v1':'4seat'}-${width}x${height}-best-match.png`});
    const calibrate=page.getByRole('button',{name:'Recalibrate',exact:true});await calibrate.focus();await page.keyboard.press('Enter');
    const modal=page.getByRole('dialog',{name:'Calibrate field zones',exact:true});await expect(modal).toHaveAttribute('aria-modal','true');await expect(modal).toBeFocused();
    expect(await modal.evaluate(node=>node.parentElement?.parentElement===document.body)).toBe(true);
    await checkBounds(modal);await modal.getByRole('button',{name:'Cancel calibration'}).scrollIntoViewIfNeeded();await checkBounds(modal.getByRole('button',{name:'Cancel calibration'}));
    await page.keyboard.press('Shift+Tab');await expect(modal.getByRole('button',{name:'Cancel calibration'})).toBeFocused();
    await page.screenshot({path:`${directory}/${seatCount===2?'1v1':'4seat'}-${width}x${height}-calibration.png`});
    await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);await expect(calibrate).toBeFocused();
  }
});

test('field watcher automatic: Set backs, deck stacks, and revealed Sets keep face state',async({page,context})=>{
  test.skip(!HAVE_FIXTURE_FILES, NEED_FIXTURES);
  test.setTimeout(120_000);
  const writes:{type:string;baseSeq:number;status:number;recovery:boolean}[]=[];let recovery=false;
  page.on('response',response=>{
    if(!response.url().endsWith('/actions')||response.request().method()!=='POST')return;
    const body=response.request().postDataJSON();writes.push({type:body.action?.type,baseSeq:body.baseSeq,status:response.status(),recovery});
  });
  await page.addInitScript(()=>{
    (window as any).fieldTimings=[];
    (window as any).fieldDetections=[];(window as any).fieldLongTasks=[];
    new PerformanceObserver(list=>(window as any).fieldLongTasks.push(...list.getEntries().map(e=>({at:e.startTime,duration:e.duration})))).observe({entryTypes:['longtask']});
    window.addEventListener('remote-field-latency',event=>(window as any).fieldTimings.push((event as CustomEvent).detail));
    const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker {
      constructor(url:string|URL,options?:WorkerOptions){super(url,options);this.addEventListener('message',event=>{if(event.data?.result?.runtime)(window as any).fieldRuntime=event.data.result.runtime;if(Array.isArray(event.data?.result))(window as any).fieldDetections.push({at:performance.now(),cards:event.data.result});});}
    };
  });
  const origin=process.env.E2E_REMOTE_UI_URL??process.env.VISION_LAB_ORIGIN??'http://127.0.0.1:3449';
  await authenticatePlayer(context.request,{userId:101},process.env.E2E_AUTH_SECRET!,origin);
  const slug=await soloTable(context.request,2);
  // Compile lazy save/catalog routes before measuring camera changes.
  await context.request.post(`/api/remote/${slug}/actions`,{data:{}});
  await context.request.post('/api/cards/resolve',{data:{lookupIds:[44508094]}});
  await context.request.get('/api/cards/44508094/image?variant=cropped');
  await appearingCamera(page,EXTRA_CARD);
  // Camera faces the owner: Deck at upper left, Extra Deck at upper right.
  await page.addInitScript(()=>{
    const calibration={version:1,corners:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],orientation:{playerSide:'top',mirrored:false}};
    for(const suffix of ['',':device:field-test-camera'])localStorage.setItem(`dd-field-watcher:v1:900000000000000001:101:0${suffix}`,JSON.stringify({enabled:true,calibration,placed:true}));
  });
  await page.addInitScript(mode=>localStorage.setItem('dd-remote-recognition-mode',mode),process.env.E2E_RECOGNITION_MODE??'cpu');
  await page.goto(`/duels/remote/${slug}`);
  await page.getByTestId('camera-on-feed').click();
  await expect(page.getByTestId('field-watcher-status')).toContainText('Watching field',{timeout:60_000});
  await expect.poll(()=>page.locator('video').first().evaluate((v:HTMLVideoElement)=>v.videoWidth)).toBe(1280);
  const room=async()=>context.request.get(`/api/remote/${slug}`).then(r=>r.json());
  await expect.poll(async()=>Number((await page.getByTestId('field-watcher-status').getAttribute('title'))?.match(/Detector (\d+) ms/)?.[1]??0),{timeout:40_000}).toBeGreaterThan(0);
  await page.evaluate(()=>((window as any).fieldTest).texture());
  // A moving draw crosses the field; it must never create a Set or prompt.
  await page.evaluate(async()=>{
    const camera=(window as any).fieldTest,start=performance.now();camera.back('#1e3cbe');
    // Animate inside the page: IPC waits must not turn a moving draw into a
    // stationary card held for the complete face-confirmation window.
    while(performance.now()-start<640){const step=(performance.now()-start)/80;camera.place(50+step*120,80+step*45);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));}
    camera.clear();
  });await page.waitForTimeout(350);
  expect((await room()).state.seats[0].twin).toHaveLength(0);await expect(page.getByTestId('field-watcher-prompt')).toHaveCount(0);
  // Time the rendered state in the page, starting at the camera pixel change.
  const change = async (down:boolean,colour='#1e3cbe') => {
    // Finish the preceding UI/setup work before the next physical action.
    // The measured interval still starts at the actual camera pixel change.
    await page.waitForTimeout(350);
    const result=await page.evaluate(({down,colour})=>new Promise<{renderMs:number;changedAt:number;placeholderRenderMs?:number}>((resolve,reject)=>{
    const cell=document.querySelector('[data-testid="field-0"] [data-zone="m3"]')!;
    const start=performance.now(),changedAt=performance.timeOrigin+start;
    let placeholderRenderMs:number|undefined;
    const timer=setTimeout(()=>{observer.disconnect();reject(new Error('Face state did not render'));},30_000);
    const observer=new MutationObserver(()=>{
      const label=cell.getAttribute('aria-label')??'',marker=!!document.querySelector('[data-testid="set-marker"]');
      if(label.includes('unidentified card'))placeholderRenderMs??=performance.now()-start;
      if(down?label.includes('Face-down')&&marker:label.includes('Stardust Dragon')&&!label.includes('Face-down')&&!marker){
        observer.disconnect();clearTimeout(timer);resolve({renderMs:performance.now()-start,changedAt,placeholderRenderMs});
      }
    });
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-label']});
    const camera=(window as any).fieldTest;camera.back(down?colour:'');camera.place(down?509:550,down?356:315,down);
    }),{down,colour});
    if(process.env.E2E_LATENCY_REPORT){
      mkdirSync(process.env.E2E_LATENCY_REPORT,{recursive:true});
      writeFileSync(`${process.env.E2E_LATENCY_REPORT}/event-${test.info().repeatEachIndex}-${result.changedAt}.json`,JSON.stringify({...result,down,colour,...await page.evaluate(()=>({stages:(window as any).fieldTimings,detections:(window as any).fieldDetections,longTasks:(window as any).fieldLongTasks,timeOrigin:performance.timeOrigin}))},null,2));
    }
    return result;
  };
  const shots = async (label:string) => {
    if(!SHOTS)return;
    for(const [width,height] of [[1920,1080],[1366,768],[390,844]]){
      await page.setViewportSize({width,height});
      const cell=page.getByTestId('field-0').locator('[data-zone="m3"]');await cell.scrollIntoViewIfNeeded();
      if(label==='revealed-set-same-slot'){
        await expect(cell.getByTestId('revealed-chip')).toHaveCount(0);
      }
      await shot(page,`${label}-${width}x${height}`);
    }
    await page.setViewportSize({width:1920,height:1080});
  };
  const setTiming=await change(true);
  await expect.poll(async()=>(await room()).state.seats[0].twin,{timeout:15_000,intervals:[25]}).toHaveLength(1);
  const set=await room(),card=set.state.seats[0].twin[0];
  expect(card).toMatchObject({zone:'monster',slot:3,faceUp:false,position:'defense'});
  expect(card.cardId).toBeUndefined();
  expect(set.events.some((event:any)=>event.action.type==='card.identified')).toBe(false);
  await expect(page.getByTestId('field-0').locator('[data-zone="m3"]')).toHaveAttribute('aria-label',/Face-down/);
  await expect(page.getByTestId('set-marker')).toHaveText('Set');
  await shots('set-blue-monster');
  await page.evaluate(()=>((window as any).fieldTest).stacks(true));
  await expect(page.getByTestId('field-0').locator('[data-zone="deck"] [data-testid="deck-pile"]')).toBeVisible();
  await expect(page.getByTestId('field-0').locator('[data-zone="ex"] [data-testid="deck-pile"]')).toBeVisible();
  await page.waitForTimeout(1200);
  const piles=await room();expect(piles.state.seats[0].twin).toHaveLength(1);
  expect(piles.events.filter((e:any)=>e.action.type==='twin.place')).toHaveLength(1);
  expect(piles.events.filter((e:any)=>e.action.type==='twin.remove')).toHaveLength(0);
  await expect(page.getByTestId('field-watcher-prompt')).toHaveCount(0);
  await shots('set-deck-extra-piles');
  const flipTiming=await change(false);
  await expect.poll(async()=>{const r=await room();return r.state.seats[0].twin.find((c:any)=>c.ref===card.ref)?.faceUp;},{timeout:30_000,intervals:[25]}).toBe(true);
  const flipped=await room();expect(flipped.state.seats[0].twin).toHaveLength(1);
  expect(flipped.state.seats[0].twin[0]).toMatchObject({ref:card.ref,zone:'monster',slot:3,cardId:44508094,faceUp:true});
  expect(flipped.events.slice(piles.events.length).filter((e:any)=>e.action.type==='twin.flip')).toHaveLength(1);
  expect(flipped.events.slice(piles.events.length).filter((e:any)=>['twin.move','card.identified'].includes(e.action.type))).toHaveLength(0);
  await expect(page.getByTestId('set-marker')).toHaveCount(0);
  await shots('set-flipped-same-slot');
  const faceUpCell=page.getByTestId('field-0').locator('[data-zone="m3"]');
  await faceUpCell.click();await expect(page.getByTestId('inspector-body')).not.toContainText('Revealed');await page.keyboard.press('Escape');
  const resetTiming=await change(true);
  await expect.poll(async()=>(await room()).state.seats[0].twin[0]?.faceUp,{timeout:15_000,intervals:[25]}).toBe(false);
  const reset=await room();
  expect(reset.events.filter((e:any)=>e.action.type==='twin.remove')).toHaveLength(0);
  expect(reset.events.filter((e:any)=>e.action.type==='twin.flip')).toHaveLength(2);
  // The camera saw it turned face-down: the owner keeps the name, everybody else sees a plain Set.
  expect(projectRemoteState(reset.state,new Set([0])).seats[0].twin).toEqual([expect.objectContaining({ref:card.ref,zone:'monster',slot:3,cardId:44508094,name:'Stardust Dragon',faceUp:false,position:'defense'})]);
  expect(reset.state.seats[0].twin[0].publicIdentity).toBeUndefined();
  for(const seats of [new Set([1]),new Set<number>()]) {
    const view=projectRemoteState(reset.state,seats);
    expect(view.seats[0].twin).toHaveLength(1);
    expect(view.seats[0].twin[0]).toMatchObject({ref:card.ref,zone:'monster',slot:3,faceUp:false,position:'defense'});
    expect(view.seats[0].twin[0].cardId).toBeUndefined();expect(view.seats[0].twin[0].name).toBeUndefined();
  }
  expect(reset.events.filter((e:any)=>e.action.type==='twin.place')).toHaveLength(1);
  expect(reset.events.filter((e:any)=>e.action.type==='card.identified')).toHaveLength(flipped.events.filter((e:any)=>e.action.type==='card.identified').length);
  const cell=page.getByTestId('field-0').locator('[data-zone="m3"]');
  await expect(cell).toHaveAttribute('aria-label',/^(?!.*Revealed).*Face-down.*Stardust Dragon/);
  await expect(cell.locator('img')).toBeVisible();
  await expect(page.getByTestId('set-marker')).toHaveText('Set');
  await expect(page.getByTestId('field-watcher-prompt')).toHaveCount(0);
  await shots('revealed-set-same-slot');
  await cell.click();
  await expect(page.getByTestId('inspector-body')).not.toContainText('Revealed');
  await page.keyboard.press('Escape');
  // Normal repeated reveal must save once, without a conflict/retry.
  const revealAgainTiming=await change(false);
  expect((await room()).state.seats[0].twin).toEqual([expect.objectContaining({ref:card.ref,slot:3,faceUp:true,position:'attack'})]);
  expect(writes.map(write=>write.type)).toEqual(['twin.place','twin.flip','twin.flip','twin.flip']);
  expect(writes.every(write=>write.status===200)).toBe(true);
  for(let i=1;i<writes.length;i++)expect(writes[i].baseSeq).toBe(writes[i-1].baseSeq+1);
  // Three adjacent physical centres remain M2/M3/M4. Stale virtual fronts
  // have no quad and must yield to the newly read top-1, without a chooser.
  const ghosts=['stale-left','stale-right'];
  for(const [i,ref] of ghosts.entries()){
    const latest=await room();
    const response=await context.request.post(`/api/remote/${slug}/actions`,{data:{baseSeq:latest.lastSeq,action:{type:'twin.place',actorSeat:0,seat:0,zone:'monster',card:{ref,slot:i?4:2,cardId:82782870,name:'Mitsurugi no Mikoto, Kusanagi',faceUp:true,position:'attack'},idempotencyKey:ref}}});
    expect(response.ok(),await response.text()).toBe(true);
  }
  await page.evaluate(()=>((window as any).fieldTest).many([{x:550,y:315},{x:340,y:315},{x:760,y:315}]));
  await expect.poll(async()=>(await room()).state.seats[0].twin.filter((c:any)=>c.zone==='monster').sort((a:any,b:any)=>a.slot-b.slot).map((c:any)=>({slot:c.slot,cardId:c.cardId})),{timeout:15_000,intervals:[25]}).toEqual([2,3,4].map(slot=>({slot,cardId:44508094})));
  await expect(page.getByTestId('field-watcher-prompt')).toHaveCount(0);
  await page.evaluate(()=>((window as any).fieldTest).many([{x:550,y:315}]));
  await expect.poll(async()=>(await room()).state.seats[0].twin.filter((c:any)=>c.zone==='monster').map((c:any)=>c.ref),{timeout:10_000,intervals:[50]}).toEqual([card.ref]);
  for(const {ref} of (await room()).state.seats[0].twin.filter((c:any)=>c.ref!==card.ref)){
    for(let attempt=0;attempt<3;attempt++){
      const latest=await room();const response=await context.request.post(`/api/remote/${slug}/actions`,{data:{baseSeq:latest.lastSeq,action:{type:'twin.remove',actorSeat:0,seat:0,cardRef:ref,idempotencyKey:`remove-${ref}`}}});
      if(response.status()===409&&attempt<2)continue;expect(response.ok(),await response.text()).toBe(true);break;
    }
  }
  await page.evaluate(()=>((window as any).fieldTest).texture(false));
  const whiteResetTiming=await change(true,'#f5f5f5');
  expect((await room()).state.seats[0].twin).toEqual([expect.objectContaining({ref:card.ref,slot:3,faceUp:false,position:'defense'})]);
  await expect(page.getByTestId('field-watcher-prompt')).toHaveCount(0);
  // Test conflict recovery separately from normal-play latency.
  // One refused save must refresh/retry, rather than leave a silent stale Set.
  recovery=true;
  const retryKeys:string[]=[];let refused=false;
  await page.route(`**/api/remote/${slug}/actions`,async route=>{
    const body=route.request().postDataJSON();
    if(body.action?.type==='twin.flip'&&body.action.faceUp){
      retryKeys.push(body.action.idempotencyKey);
      if(!refused){refused=true;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Table changed; retry with its latest sequence'})});return;}
    }
    await route.continue();
  });
  const recoveryTiming=await change(false);
  expect(refused).toBe(true);expect(retryKeys).toHaveLength(2);expect(retryKeys[0]).toBe(retryKeys[1]);
  expect((await room()).state.seats[0].twin).toEqual([expect.objectContaining({ref:card.ref,slot:3,faceUp:true,position:'attack'})]);
  await page.unroute(`**/api/remote/${slug}/actions`);
  recovery=false;
  // A known front returns from hand even after the old move window. Its
  // temporary Reading cue yields to the original physical ref.
  await page.evaluate(()=>((window as any).fieldTest).clear());
  await expect.poll(async()=>(await room()).state.seats[0].twin.filter((card:any)=>card.zone!=='hand'),{timeout:15_000,intervals:[50]}).toHaveLength(0);
  await page.waitForTimeout(2700); // The departed card is outside the physical reconnection window.
  const placeholderStart=(await room()).events.length;
  const revealAfterPlaceholderTiming=await change(false);
  const afterPlaceholder=await room();
  expect(afterPlaceholder.events.slice(placeholderStart).map((event:any)=>event.action.type)).toEqual(['twin.place','twin.remove','twin.place']);
  expect(writes.slice(-3).map(write=>write.type)).toEqual(['twin.place','twin.remove','twin.place']);
  for(let i=1;i<3;i++)expect(writes.slice(-3)[i].baseSeq).toBe(writes.slice(-3)[i-1].baseSeq+1);
  const manualCard=afterPlaceholder.state.seats[0].twin.find((card:any)=>card.zone==='monster'&&card.slot===3);
  expect(manualCard.ref).toBe(card.ref);expect(afterPlaceholder.state.seats[0].twin).toHaveLength(1);
  await expect(page.getByTestId('field-watcher-prompt')).toHaveCount(0);
  expect(writes.filter(write=>!write.recovery&&write.status!==200)).toEqual([]);
  const eventDelay=(snapshot:any,type:string,timing:{changedAt:number})=>snapshot.events.findLast((e:any)=>e.action.type===type).at-timing.changedAt;
  const backend=await page.getByTestId('recognition-backend').first().getAttribute('data-backend');
  const runtime=await page.evaluate(()=>(window as any).fieldRuntime);
  console.log(JSON.stringify({backend,runtime,
    setRenderMs:setTiming.renderMs,revealRenderMs:flipTiming.renderMs,resetRenderMs:resetTiming.renderMs,revealAgainRenderMs:revealAgainTiming.renderMs,whiteResetRenderMs:whiteResetTiming.renderMs,revealAfterPlaceholderRenderMs:revealAfterPlaceholderTiming.renderMs,
    setServerMs:eventDelay(set,'twin.place',setTiming),revealServerMs:eventDelay(flipped,'twin.flip',flipTiming)}));
  if(process.env.E2E_LATENCY_REPORT){
    mkdirSync(process.env.E2E_LATENCY_REPORT,{recursive:true});
    writeFileSync(`${process.env.E2E_LATENCY_REPORT}/timings-${test.info().repeatEachIndex}.json`,JSON.stringify({backend,runtime,setTiming,flipTiming,resetTiming,revealAgainTiming,whiteResetTiming,revealAfterPlaceholderTiming,recoveryTiming,writes,stages:await page.evaluate(()=>(window as any).fieldTimings)},null,2));
  }
  await page.getByRole('button',{name:'Camera off',exact:true}).click();
  // Manual same-slot setting uses twin.move and retains the same public knowledge.
  for(const [index,action] of [{type:'twin.move',zone:'hand',faceUp:false},{type:'twin.move',zone:'deck',faceUp:false},{type:'twin.move',zone:'monster',slot:3,faceUp:true},{type:'twin.move',zone:'monster',slot:3,faceUp:false}].entries()) {
    const latest=await room();
    const response=await context.request.post(`/api/remote/${slug}/actions`,{data:{baseSeq:latest.lastSeq,action:{...action,actorSeat:0,seat:0,cardRef:manualCard.ref,idempotencyKey:`revealed-set-${index}`}}});
    expect(response.ok(),await response.text()).toBe(true);
    if(['hand','deck'].includes(action.zone))expect(projectRemoteState((await room()).state,new Set([1])).seats[0].twin.find((card:any)=>card.ref===manualCard.ref)!.cardId).toBeUndefined();
  }
  expect(projectRemoteState((await room()).state,new Set([1])).seats[0].twin.find((card:any)=>card.ref===manualCard.ref)).toMatchObject({ref:manualCard.ref,slot:3,cardId:44508094,faceUp:false,publicIdentity:true});
});

test.describe("remote tournament", () => {
  test("a paired match runs on a Remote table: concede proposes the result, both confirm, the slot is final", async ({ browser }) => {
    test.setTimeout(180_000);
    const url = process.env.E2E_REMOTE_UI_URL!;
    const alice = await browser.newContext({ baseURL: url }); const bob = await browser.newContext({ baseURL: url });
    try {
      for (const [context, userId] of [[alice, 101], [bob, 102]] as const) await authenticatePlayer(context.request, { userId }, process.env.E2E_AUTH_SECRET!, url);
      const created = await alice.request.post("/api/tournaments", { data: { name: "Remote cup", format: "round_robin", visibility: "open", duelType: "remote", bestOf: 1, duelRules: { mode: "normal", masterRule: 5 } } });
      expect(created.status(), await created.text()).toBe(201);
      const { webSlug } = await created.json() as { webSlug: string };
      // The creator is already an entrant; Bob joins.
      const joined = await bob.request.post(`/api/tournaments/${webSlug}/join`); expect(joined.ok(), await joined.text()).toBe(true);
      const started = await alice.request.post(`/api/tournaments/${webSlug}`);
      expect(started.status(), await started.text()).toBe(200);
      const detail = await (await alice.request.get(`/api/tournaments/${webSlug}`)).json();
      const slot = detail.matches[0] as { id: number };
      const root = `/api/tournaments/${webSlug}/matches/${slot.id}`;
      const remote = await alice.request.post(`${root}/remote`);
      expect(remote.status(), await remote.text()).toBe(201);
      const { table } = await remote.json() as { table: { slug: string } };
      // Bob takes seat 1, both sit with the seeded deck and start; seat 0 concedes.
      expect((await bob.request.post(`/api/remote/${table.slug}/seat`, { data: { seat: 1 } })).ok()).toBe(true);
      for (const api of [alice.request, bob.request]) {
        const decks = (await (await api.get("/api/decks")).json()).decks as { id: number }[];
        expect((await api.post(`/api/remote/${table.slug}/deck`, { data: { savedDeckId: decks[0]!.id } })).ok()).toBe(true);
        expect((await api.post(`/api/remote/${table.slug}/ready`, { data: { ready: true } })).ok()).toBe(true);
      }
      expect((await alice.request.post(`/api/remote/${table.slug}/start`, { data: {} })).ok()).toBe(true);
      const room = await (await alice.request.get(`/api/remote/${table.slug}`)).json();
      const conceded = await alice.request.post(`/api/remote/${table.slug}/actions`, { data: { baseSeq: room.lastSeq, action: { type: "player.concede", actorSeat: 0, idempotencyKey: crypto.randomUUID() } } });
      expect(conceded.ok(), await conceded.text()).toBe(true);
      const read = await (await bob.request.get(`${root}/remote-result`)).json();
      expect(read.remoteResult).toMatchObject({ status: "proposed", source: "concede" });
      expect(typeof read.now).toBe("number");
      for (const api of [alice.request, bob.request]) {
        const confirmed = await api.post(`${root}/remote-result/confirm`, { data: {} });
        expect(confirmed.ok(), await confirmed.text()).toBe(true);
      }
      const final = await (await alice.request.get(`${root}/remote-result`)).json();
      expect(final.remoteResult).toMatchObject({ status: "final", finalizationReason: "both_confirmed" });
      // The bracket page shows the slot as completed with a winner.
      const after = await (await alice.request.get(`/api/tournaments/${webSlug}`)).json();
      const done = after.matches.find((m: { id: number }) => m.id === slot.id);
      expect(done.status).toBe("completed");
      // Alice created the table (seat 0) and conceded, so she is not the winner.
      expect(done.winnerId).not.toBeNull();
      expect(done.winnerId).not.toBe(detail.currentUserPlayerId);
    } finally { await alice.close(); await bob.close(); }
  });
});

test.describe("remote duels screen, tokens and the camera", () => {
  test.beforeEach(async ({ context }) => { await authenticatePlayer(context.request, { userId: 101 }, process.env.E2E_AUTH_SECRET!, process.env.E2E_REMOTE_UI_URL!); });

  // A fake reader stands in for the camera model (NEXT_PUBLIC_E2E_FIELD_HOOK, set by the e2e stack only): the test hands the table a card "seen" in a cell that holds a token.
  test("a card seen on a token's cell: Choose another zone places it in the zone picked and keeps the token; Remove token puts it there and one Undo restores the token", async ({ page, context }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await fakeCamera(page, "16:9");
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>; w.__tracks = [];
      w.__e2eFieldWatcher = {
        getSnapshot: () => ({ status: "running", tracks: w.__tracks, metrics: { detectorMs: 0, recognitionMs: 0, dutyPercent: 0, intervalMs: 333, samples: 0, skipped: 0, placements: 0, latencyMs: 0, errors: 0 } }),
        confirm() {}, dismiss() {}, forget() {}, resetBaselines() {}, scanNow() {}, setCalibration() {}, start() {}, dispose() {}, subscribe: () => () => {}, subscribeState: () => () => {},
      };
    });
    const slug = await soloTable(context.request, 2), path = `/api/remote/${slug}`;
    const act = async (action: Record<string, unknown>) => {
      const room = await (await context.request.get(path)).json();
      const response = await context.request.post(`${path}/actions`, { data: { baseSeq: room.lastSeq, action: { idempotencyKey: crypto.randomUUID(), ...action } } });
      expect(response.status(), await response.text()).toBe(200);
    };
    const mine = async () => ((await (await context.request.get(path)).json()).state.seats[0].twin as { zone: string; slot?: number; token?: unknown }[]).map(c => `${c.zone}:${c.slot}:${c.token ? "token" : "card"}`);
    await act({ type: "twin.place", actorSeat: 0, seat: 0, zone: "monster", card: { ref: "tk", name: "Sheep Token", slot: 3, faceUp: true, position: "defense", token: { atk: 0, def: 0 } } });
    await page.goto(`/duels/remote/${slug}`);
    await page.getByTestId("camera-on-feed").click();
    await expect.poll(() => page.locator('[data-testid="feed-0"] video').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    await page.getByTestId("feed-box-0").hover(); await page.getByRole("button", { name: "Calibrate zones", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Calibrate field zones", exact: true }); await expect(dialog).toBeVisible();
    await dialog.getByTestId("camera-my-view").click(); await dialog.getByRole("button", { name: "Save calibration", exact: true }).click(); await expect(dialog).toBeHidden();
    await page.waitForFunction(() => (window as unknown as { __e2eField?: { live: () => boolean } }).__e2eField?.live());
    await page.waitForTimeout(1500);
    const sees = (id: string, cardId: string) => page.evaluate(([trackId, code]) => {
      const w = window as unknown as { __tracks: unknown[]; __e2eField: { entries: { current: Map<string, unknown> }; handle: (event: unknown) => void } };
      const now = performance.now(), down = false, cardId = code;
      const track = { id: trackId, zone: "M3", faceDown: down, cardId: down ? undefined : cardId, revision: 0, state: "identified", firstSeen: now - 3000, lastSeen: now, removed: false, visible: true, position: "attack",
        card: { kind: down ? "face-down" : "face-up", confidence: 1, partial: false, quad: [{ x: .4, y: .4 }, { x: .5, y: .4 }, { x: .5, y: .5 }, { x: .4, y: .5 }] } };
      w.__e2eField.entries.current.set(cardId, { cardId, passcode: Number(cardId), name: `Origin fixture ${cardId.slice(-1)}` });
      w.__tracks = [track]; w.__e2eField.handle({ type: "placed", track });
    }, [id, cardId] as const);

    // Choose another zone: the picker offers the other free monster zones, never M3. The card goes where the player picks and the token stays.
    const clash = page.getByTestId("token-clash");
    await sees("cam1", "900000001");
    await expect(clash).toBeVisible();
    await page.getByTestId("token-clash-other").click();
    await expect(page.getByTestId("token-clash-zones")).toBeVisible();
    await expect(page.getByTestId("token-clash-zone-M3")).toHaveCount(0);
    await page.getByTestId("token-clash-zone-M4").click();
    await expect.poll(mine).toEqual(["monster:3:token", "monster:4:card"]);

    // The first card is lifted off and a new card lies on the same cell: it asks again (the choice was for the first card only). Remove token puts it in M3, and one Undo brings the token back and clears the card.
    await sees("cam2", "900000002");
    await expect(clash).toBeVisible();
    await page.getByTestId("token-clash-remove").click();
    const cell = async () => (await mine()).filter(c => c.startsWith("monster:3:"));
    await expect.poll(cell).toEqual(["monster:3:card"]);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    // The whole board is back: the token in M3, the first card in M4, no card in M3.
    await expect.poll(mine).toEqual(["monster:3:token", "monster:4:card"]);
  });

  // A plain monster in a Spell & Trap Zone can be legal (equipped by a card, placed as a Continuous Trap), so the table keeps it where the camera saw it and asks.
  test("a plain monster seen in a Spell & Trap Zone stays there and asks, and Keep leaves it", async ({ page, context }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    await fakeCamera(page, "16:9");
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>; w.__tracks = [];
      w.__e2eFieldWatcher = {
        getSnapshot: () => ({ status: "running", tracks: w.__tracks, metrics: { detectorMs: 0, recognitionMs: 0, dutyPercent: 0, intervalMs: 333, samples: 0, skipped: 0, placements: 0, latencyMs: 0, errors: 0 } }),
        confirm() {}, dismiss() {}, forget() {}, resetBaselines() {}, scanNow() {}, setCalibration() {}, start() {}, dispose() {}, subscribe: () => () => {}, subscribeState: () => () => {},
      };
    });
    const slug = await soloTable(context.request, 2), path = `/api/remote/${slug}`;
    const mine = async () => ((await (await context.request.get(path)).json()).state.seats[0].twin as { zone: string; slot?: number }[]).map(c => `${c.zone}:${c.slot}`);
    await page.goto(`/duels/remote/${slug}`);
    await page.getByTestId("camera-on-feed").click();
    await expect.poll(() => page.locator('[data-testid="feed-0"] video').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    await page.getByTestId("feed-box-0").hover(); await page.getByRole("button", { name: "Calibrate zones", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Calibrate field zones", exact: true }); await expect(dialog).toBeVisible();
    await dialog.getByTestId("camera-my-view").click(); await dialog.getByRole("button", { name: "Save calibration", exact: true }).click(); await expect(dialog).toBeHidden();
    await page.waitForFunction(() => (window as unknown as { __e2eField?: { live: () => boolean } }).__e2eField?.live());
    await page.waitForTimeout(1500);
    const sees = (id: string, zone: string, cardId: string) => page.evaluate(([trackId, cell, code]) => {
      const w = window as unknown as { __tracks: unknown[]; __e2eField: { entries: { current: Map<string, unknown> }; handle: (event: unknown) => void } };
      const now = performance.now();
      const track = { id: trackId, zone: cell, faceDown: false, cardId: code, revision: 0, state: "identified", firstSeen: now - 3000, lastSeen: now, removed: false, visible: true, position: "attack",
        card: { kind: "face-up", confidence: 1, partial: false, quad: [{ x: .4, y: .4 }, { x: .5, y: .4 }, { x: .5, y: .5 }, { x: .4, y: .5 }] } };
      w.__e2eField.entries.current.set(code, { cardId: code, passcode: Number(code), name: "Dark Magician" });
      w.__tracks = [track]; w.__e2eField.handle({ type: "placed", track });
    }, [id, zone, cardId] as const);

    const prompt = page.getByTestId("monster-in-st");
    await sees("cam1", "S3", "46986414");
    await expect(prompt).toBeVisible();
    // The card stays where the camera saw it until the player answers.
    await expect.poll(mine).toEqual(["spell-trap:3"]);
    await expect(page.getByTestId("monster-in-st-move")).toContainText("Move to M3");
    await page.getByTestId("monster-in-st-keep").click();
    await expect(prompt).toBeHidden();
    await expect.poll(mine).toEqual(["spell-trap:3"]);
  });
});

test.describe("remote duels screen, card logic", () => {
  test.beforeEach(async ({ context }) => { await authenticatePlayer(context.request, { userId: 101 }, process.env.E2E_AUTH_SECRET!, process.env.E2E_REMOTE_UI_URL!); });
  const seedCards = async (context: { request: APIRequestContext }, slug: string, cards: { seat: number; zone: string; ref: string; cardId: number; name: string; slot?: number }[]) => {
    let room = await (await context.request.get(`/api/remote/${slug}`)).json();
    for (const { seat, zone, ...card } of cards) {
      const response = await context.request.post(`/api/remote/${slug}/actions`, { data: { baseSeq: room.lastSeq, action: { idempotencyKey: crypto.randomUUID(), type: "twin.place", actorSeat: seat, seat, zone, card: { ...card, faceUp: true, position: "attack" } } } });
      expect(response.status(), await response.text()).toBe(200); room = await (await context.request.get(`/api/remote/${slug}`)).json();
    }
    return async () => (await (await context.request.get(`/api/remote/${slug}`)).json()) as { state: { seats: { twin: { ref: string; zone: string; slot?: number; position?: string; ownerSeat?: number; equippedTo?: { seat: number; ref: string } }[] }[] } };
  };

  test("control change: Monster Reborn asks which Graveyard, the revived card is mine, and Return control gives it back", async ({ page, context }) => {
    test.setTimeout(120_000);
    const slug = await soloTable(context.request, 2);
    const room = await seedCards(context, slug, [
      { seat: 1, zone: "graveyard", ref: "dm", cardId: 46986414, name: "Dark Magician" },
      { seat: 0, zone: "spell-trap", ref: "mr", cardId: 83764718, name: "Monster Reborn", slot: 1 },
    ]);
    await page.goto(`/duels/remote/${slug}`);
    const field = page.getByTestId("field-0");
    await expect(field.locator('[data-zone="s1"]')).toBeVisible();
    await field.locator('[data-zone="s1"]').click({ button: "right" });
    await page.getByTestId("inspector").getByRole("button", { name: "Activate" }).click();
    // The card logic knows Monster Reborn revives from a Graveyard, so the table asks. The player picks the card.
    const dialog = page.getByTestId("control-dialog");
    await expect(dialog).toContainText("Revive from which Graveyard?", { timeout: 60_000 });
    await dialog.getByTestId("control-pick").first().click();
    // The table never picks the zone or the position: both buttons are the player's choice. The zone stays locked until the position is chosen.
    await expect(dialog.getByTestId("control-zone-M3")).toBeDisabled();
    await dialog.getByTestId("control-position-defense").click();
    await dialog.getByTestId("control-zone-M3").click();
    await expect.poll(async () => (await room()).state.seats[0].twin.find(card => card.ref === "dm")).toMatchObject({ zone: "monster", slot: 3, position: "defense", ownerSeat: 1 });
    expect((await room()).state.seats[1].twin.some(card => card.ref === "dm")).toBe(false);
    await field.locator('[data-zone="m3"]').click({ button: "right" });
    await page.getByTestId("inspector").getByTestId("card-control").click();
    await page.getByTestId("control-dialog").getByTestId("control-zone-M2").click();
    await expect.poll(async () => (await room()).state.seats[1].twin.find(card => card.ref === "dm")).toMatchObject({ zone: "monster", slot: 2 });
    expect((await room()).state.seats[0].twin.some(card => card.ref === "dm")).toBe(false);
  });

  test("equip: a Union monster in a Spell & Trap Zone asks which monster it equips, and links only after a click", async ({ page, context }) => {
    test.setTimeout(120_000);
    const slug = await soloTable(context.request, 2);
    const room = await seedCards(context, slug, [
      { seat: 0, zone: "monster", ref: "dm", cardId: 46986414, name: "Dark Magician", slot: 1 },
      { seat: 0, zone: "spell-trap", ref: "yd", cardId: 65622692, name: "Y-Dragon Head", slot: 1 },
    ]);
    await page.goto(`/duels/remote/${slug}`);
    const dialog = page.getByTestId("control-dialog");
    await expect(dialog).toContainText("equipped to which monster?", { timeout: 60_000 });
    expect((await room()).state.seats[0].twin.find(card => card.ref === "yd")?.equippedTo).toBeUndefined();
    await dialog.getByTestId("equip-pick").first().click();
    await expect.poll(async () => (await room()).state.seats[0].twin.find(card => card.ref === "yd")).toMatchObject({ zone: "spell-trap", equippedTo: { seat: 0, ref: "dm" } });
  });
});
