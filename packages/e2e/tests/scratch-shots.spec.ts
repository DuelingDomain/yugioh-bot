import { mkdirSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { authenticatePlayer } from "../stack/login-auth.mjs";
import { startTwoPlayerTable } from "./remote-table";

const OUT = process.env.SHOT_DIR ?? "/mnt/c/Users/sulma/Downloads/dd-round4";
mkdirSync(OUT, { recursive: true });
const SIZES: [string, number, number, boolean][] = (process.env.SIZES ?? "1920x1080,1366x768,1366x768d,2560x1440,390x844").split(",").map(item => { const m = /^(\d+)x(\d+)(d?)$/.exec(item)!; return [item, +m[1], +m[2], !!m[3]]; });
const ONLY = process.env.ONLY ?? "";
async function soloTable(api: APIRequestContext, seatCount: 2 | 3 | 4) {
  const created = await api.post("/api/remote", { data: { gameId: "ygo", seatCount, solo: true, bestOf: 1 } }); const room = await created.json();
  await api.post(`/api/remote/${room.slug}/ready`, { data: { ready: true } }); await api.post(`/api/remote/${room.slug}/start`, { data: {} });
  return room.slug as string;
}
async function fakeCamera(page: Page) {
  await page.addInitScript(() => {
    const canvas = document.createElement("canvas"); canvas.width = 1280; canvas.height = 720; const c = canvas.getContext("2d")!;
    setInterval(() => { c.fillStyle = "#2a3a2e"; c.fillRect(0, 0, 1280, 720); c.fillStyle = "#cfe"; c.font = "48px sans-serif"; c.fillText("camera " + Date.now() % 1000, 80, 120); }, 80);
    navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(15); navigator.mediaDevices.enumerateDevices = async () => [];
  });
}
const wants = (name: string) => !ONLY || ONLY.split(",").includes(name);
test.beforeEach(async ({ context }) => { await context.addInitScript(() => { for (const key of ["dd-remote-webcam-only", "dd-remote-spectator-webcam-only"]) if (localStorage.getItem(key) === null) localStorage.setItem(key, "0"); }); });

test("shots", async ({ browser }) => {
  test.setTimeout(600_000);
  const url = process.env.E2E_REMOTE_UI_URL!;
  const alice = await browser.newContext({ baseURL: url, viewport: { width: 1920, height: 1080 }, permissions: ["camera", "microphone"] }); const bob = await browser.newContext({ baseURL: url });
  for (const [c, userId] of [[alice, 101], [bob, 102]] as const) await authenticatePlayer(c.request, { userId }, process.env.E2E_AUTH_SECRET!, url);
  await alice.addInitScript(() => { for (const key of ["dd-remote-webcam-only"]) if (localStorage.getItem(key) === null) localStorage.setItem(key, "0"); });
  let slug = ""; await expect(async () => { slug = await startTwoPlayerTable(alice.request, bob.request); }).toPass({ timeout: 150_000 });
  let solo = ""; await expect(async () => { solo = await soloTable(alice.request, 2); }).toPass({ timeout: 100_000 });
  let solo3 = ""; await expect(async () => { solo3 = await soloTable(alice.request, 3); }).toPass({ timeout: 100_000 });
  let solo4 = ""; await expect(async () => { solo4 = await soloTable(alice.request, 4); }).toPass({ timeout: 100_000 });
  const page = await alice.newPage(); await fakeCamera(page);
  const resize = async (w: number, h: number, drawer: boolean) => {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(500);
    const open = await page.locator('[data-testid="log-drawer"]:not([aria-hidden="true"])').count();
    if (drawer && !open) { await page.getByTestId("log-button").click(); await page.waitForTimeout(600); }
    if (!drawer && open) { await page.keyboard.press("Escape"); await page.waitForTimeout(600); }
  };
  for (const [name, path] of [["1v1", `/duels/remote/${slug}`], ["bot", `/duels/remote/${solo}`], ["3way", `/duels/remote/${solo3}`], ["4way", `/duels/remote/${solo4}`]] as const) {
    if (!wants(name)) continue;
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(path); await expect(page.getByTestId("seat-0")).toBeVisible({ timeout: 60_000 }); await page.waitForTimeout(1500);
    for (const [label, w, h, drawer] of SIZES) { await resize(w, h, drawer); await page.screenshot({ path: `${OUT}/${name}-${label}.png` }); }
  }
  if (wants("seam")) {
    await page.goto(`/duels/remote/${slug}`); await expect(page.getByTestId("seat-0")).toBeVisible({ timeout: 60_000 });
    for (const [label, w, h, drawer] of SIZES) {
      await resize(w, h, drawer);
      const handle = page.getByTestId("split-0"); await expect(handle).toBeVisible();
      const grab = async (dy: number) => { const box = (await handle.boundingBox())!; const x = box.x + box.width / 2, y = box.y + box.height / 2; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + dy / 2, { steps: 6 }); await page.mouse.move(x, y + dy, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(300); };
      await handle.focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(300);
      await grab(-120); await page.screenshot({ path: `${OUT}/seam-up-${label}.png` });
      await grab(-700); await page.screenshot({ path: `${OUT}/seam-min-${label}.png` });
      await grab(+80); await page.screenshot({ path: `${OUT}/seam-down-${label}.png` });
      await handle.focus(); await page.keyboard.press("Enter"); await page.getByTestId("view-toggle-0").click(); await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/enlarge-${label}.png` }); console.log("DBG", label, JSON.stringify(await page.getByTestId("seat-0").evaluate((el) => { const q = (sel: string) => { const n = el.querySelector(sel) as HTMLElement | null; if (!n) return null; const r = n.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), getComputedStyle(n).flex]; }; return { seat: [el.getAttribute("data-view"), el.getAttribute("data-split"), getComputedStyle(el).getPropertyValue("--split")], seatBox: Math.round(el.getBoundingClientRect().height), feedcol: q("[class*=feedcol]"), cams: q("[class*=cams]"), fboard: q("[class*=fboard]"), fwrap: q("[class*=fwrap]") }; })));
      await page.getByTestId("view-toggle-0").click(); await page.waitForTimeout(600);
    }
  }
  if (wants("coin")) {
    await page.goto(`/duels/remote/${solo}`); await expect(page.getByTestId("seat-0")).toBeVisible({ timeout: 60_000 });
    for (const [label, w, h, drawer] of SIZES) {
      await resize(w, h, drawer);
      await page.getByTestId("coin-die-button").click(); await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/coin-menu-${label}.png` });
      await page.getByTestId("flip-coin").click(); await page.waitForTimeout(250); await page.screenshot({ path: `${OUT}/coin-spin-${label}.png` });
      await page.waitForTimeout(1900); await page.screenshot({ path: `${OUT}/coin-result-${label}.png` }); await page.waitForTimeout(6000);
      await page.getByTestId("coin-die-button").click(); await page.getByTestId("roll-die").click(); await page.waitForTimeout(1900); await page.screenshot({ path: `${OUT}/die-result-${label}.png` }); await page.waitForTimeout(6000);
    }
  }
});
