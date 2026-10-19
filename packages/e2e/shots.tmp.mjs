// usage: node shots.mjs <outDir> <prefix> [path]
import { chromium, request } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
const [outDir, prefix, path = "/admin"] = process.argv.slice(2);
const base = "http://localhost:3391";
const secret = readFileSync("/tmp/claude-1000/-home-sulman633-repos-yugioh-bot/afb38400-c3ce-4cfa-9c06-ac93470c7769/scratchpad/.e2e-auth9", "utf8").trim();
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
async function login(userId) {
  const api = await request.newContext({ baseURL: base });
  const r = await api.post("/api/test-auth/session", { data: { userId, secret } });
  if (r.status() !== 200) throw new Error("login " + r.status());
  const state = await api.storageState();
  await api.dispose();
  return state;
}
// others online
for (const id of [102, 103, 104, 105]) {
  const ctx = await browser.newContext({ storageState: await login(id) });
  const page = await ctx.newPage();
  await page.goto(base + (id === 103 ? "/decks/new" : id === 104 ? "/duels" : "/")).catch(() => {});
  await page.waitForTimeout(1500);
}
const sizes = [["1080p", 1920, 1080], ["1440p", 2560, 1440], ["1366", 1366, 768], ["mobile", 390, 844]];
const state = await login(101);
for (const [name, width, height] of sizes) {
  const ctx = await browser.newContext({ storageState: state, viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(base + path, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const file = `${outDir}/${prefix}-${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log(file);
  await ctx.close();
}
await browser.close();
