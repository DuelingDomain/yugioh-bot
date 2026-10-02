/**
 * Browser proof for the side deck Ready bug: Ready, then a swap with no save, then the opponent readies.
 * The player must stay on the side deck screen (no longer ready) and only move on after clicking Ready again.
 *
 * Real parts: the duel room and side deck panel (bundled from src with vite), the shared duel and series
 * services on a temp SQLite DB, and the duel host with real engine workers and card data. Stand-ins:
 * Discord sign-in (the browser is always player 1), the web API routes (mirrored below, one line each,
 * onto the same host ops), next/navigation, socket.io (the room polls instead) and placeholder card art.
 * The side deck window is stretched to 10 minutes so its timer cannot start game 2 during the run.
 *
 * Run (Node 22, shared built, engine data in data/duel-engine):
 *   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs SIDE_DECK_ARTIFACTS=/tmp/side-deck-proof \
 *   CHROMIUM_PATH=/optional/chrome (otherwise Playwright's own browser) \
 *     node --import tsx packages/web/e2e/side-deck-unready.playwright.ts
 * Exits 1 when any step's check fails; screenshots and evidence.json are written either way.
 */
import { createHmac } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";
import { migrate } from "@yugidraft/shared/db";
import type { DuelDeck } from "@yugidraft/shared/duels";
import { createDuelSeriesService, createDuelService } from "@yugidraft/shared/services";
import { createDuelHost } from "../../duel-server/src/host.js";
import { buildPracticeBotDeck } from "../../duel-server/src/practice-bot.js";

const require = createRequire(import.meta.url);
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE ?? require.resolve("playwright")).href);
const e2e = fileURLToPath(new URL(".", import.meta.url));
const web = resolve(e2e, "..");
const repo = resolve(web, "../..");
const out = resolve(process.env.SIDE_DECK_ARTIFACTS ?? "/tmp/side-deck-unready");
const dataDirectory = resolve(process.env.DUEL_DATA_DIR ?? join(repo, "data/duel-engine"));
const imageCache = process.env.CARD_IMAGE_CACHE_DIR;
const ORIGIN = "http://side-deck.harness";
const GUILD = "g1";
const SECRET = "side-deck-harness";
await mkdir(out, { recursive: true });

// ---- Backend: real services and duel host on a temp DB -------------------------------------------
const tmp = mkdtempSync(join(tmpdir(), "side-deck-harness-"));
const db = new Database(join(tmp, "bot.sqlite"));
migrate(db);
const duels = createDuelService(db);
const series = createDuelSeriesService(db);
const addPlayer = db.prepare("insert into players (guild_id, discord_user_id, display_name) values (?, ?, ?)");
const p1 = Number(addPlayer.run(GUILD, "u1", "Yugi").lastInsertRowid);
const p2 = Number(addPlayer.run(GUILD, "u2", "Kaiba").lastInsertRowid);
const host = createDuelHost({ db, dataDirectory, secret: SECRET, searchCards: () => [] });

async function callHost(body: Record<string, unknown>): Promise<{ status: number; data: any }> {
  const raw = JSON.stringify({ guildId: GUILD, ...body });
  const signature = "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");
  const response = await host.handle(new Request("http://duel/internal/duel", {
    method: "POST",
    headers: { "content-type": "application/json", "x-announce-signature": signature },
    body: raw,
  }));
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function expectOk(label: string, body: Record<string, unknown>) {
  const result = await callHost(body);
  if (result.status !== 200) throw new Error(`${label}: ${result.status} ${JSON.stringify(result.data)}`);
  return result.data;
}

// Each player has two side cards (copies of main deck cards), so the side deck window has a deadline.
const practice = buildPracticeBotDeck("normal", dataDirectory);
const registered: DuelDeck = { main: practice.main, extra: [], side: [practice.main[0]!, practice.main[1]!] };
// The swap the browser makes: Main card 1 out, Side card 2 in.
const swapped: DuelDeck = {
  main: [registered.side[1]!, ...registered.main.slice(1)],
  extra: [],
  side: [registered.side[0]!, registered.main[0]!],
};

const started = series.createChallenge({ guildId: GUILD, challengerPlayerId: p1, opponentPlayerId: p2, bestOf: 3, ranked: false, mode: "normal" });
const game1 = started.duel.slug;
await expectOk("p1 deck", { op: "deck", slug: game1, playerId: p1, deck: registered });
await expectOk("p2 deck", { op: "deck", slug: game1, playerId: p2, deck: registered });
if (duels.get(game1, GUILD).status !== "active") throw new Error("game 1 did not start");
await expectOk("p2 surrenders game 1", { op: "surrender", slug: game1, playerId: p2 });
if (series.get(started.series.id, GUILD).status !== "between_games") throw new Error("series is not between games");
db.prepare("update duel_series set next_game_at = ? where id = ?").run(new Date(Date.now() + 10 * 60_000).toISOString(), started.series.id);
const p1Index = series.get(started.series.id, GUILD).playerIds.indexOf(p1) as 0 | 1;
const seriesNow = () => series.get(started.series.id, GUILD);

// ---- The web API routes the room calls, mirrored onto the host for player 1 ------------------------
function json(status: number, data: unknown) {
  return { status, contentType: "application/json", body: JSON.stringify(data) };
}

async function api(method: string, url: URL, body: unknown) {
  const path = url.pathname;
  if (path === "/api/duels/cards" && method === "POST") {
    const result = await callHost({ op: "card-details", playerId: p1, codes: (body as { codes: number[] }).codes });
    return json(result.status, result.data);
  }
  if (path === "/api/duels/cards" && method === "GET") {
    const result = await callHost({ op: "cards", playerId: p1, query: url.searchParams.get("q") ?? "", slug: url.searchParams.get("slug") ?? undefined });
    return json(result.status, result.data);
  }
  // Player 1 has no saved decks in the harness.
  if (path === "/api/decks" && method === "GET") return json(200, { decks: [] });
  const match = /^\/api\/duels\/([^/]+)(\/.*)?$/.exec(path);
  if (!match) return json(404, { error: `harness: no route ${method} ${path}` });
  const slug = decodeURIComponent(match[1]!);
  const rest = match[2] ?? "";
  if (rest === "" && method === "GET") {
    // app/api/duels/[slug]/route.ts: the shared room unless the game is live, then the host view.
    try {
      const room = duels.room(slug, GUILD, p1);
      if (room.session.status !== "active") return json(200, room);
    } catch (error) {
      return json((error as { status?: number }).status ?? 500, { error: (error as Error).message });
    }
    const result = await callHost({ op: "view", slug, playerId: p1 });
    return json(result.status, result.data);
  }
  const ops: Record<string, string> = { "/series/side": "series-side", "/series/ready": "series-ready", "/series/unready": "series-unready" };
  if (method === "POST" && ops[rest]) {
    const deck = rest === "/series/side" ? (body as { deck: DuelDeck }).deck : undefined;
    const result = await callHost({ op: ops[rest], slug, playerId: p1, ...(deck ? { deck } : {}) });
    return json(result.status, result.data);
  }
  if (rest === "/deck/validate" && method === "POST") {
    const result = await callHost({ op: "validate-deck", slug, playerId: p1, deck: body });
    return json(result.status, result.data);
  }
  if (rest === "/connection") return json(503, { error: "No realtime in the harness: the room polls" });
  return json(404, { error: `harness: no route ${method} ${path}` });
}

const cardDb = new Database(join(dataDirectory, "cards.cdb"), { readonly: true });
const cardNames = cardDb.prepare<[number], { name: string }>("select name from texts where id = ?");

/** Cached real art when CARD_IMAGE_CACHE_DIR has it, otherwise a labelled placeholder. */
function cardImage(code: string) {
  const cached = imageCache ? join(imageCache, `${code}.jpg`) : null;
  if (cached && existsSync(cached)) return { status: 200, contentType: "image/jpeg", body: readFileSync(cached) };
  const row = cardNames.get(Number(code));
  const name = (row?.name ?? code).replace(/[<&>]/g, "").slice(0, 22);
  return {
    status: 200,
    contentType: "image/svg+xml",
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="168" height="246"><rect width="168" height="246" rx="6" fill="#3b3352"/>
      <rect x="10" y="10" width="148" height="226" rx="4" fill="none" stroke="#c9a24a" stroke-width="2"/>
      <text x="84" y="128" fill="#efe7d5" text-anchor="middle" font-family="Arial" font-size="18">${name}</text></svg>`,
  };
}

// ---- Bundle the real room for the browser -----------------------------------------------------------
const bundle = resolve(out, "bundle");
await build({
  configFile: false,
  root: e2e,
  logLevel: "warn",
  cacheDir: resolve(out, ".vite"),
  base: "./",
  define: { "process.env.NEXT_PUBLIC_WS_URL": JSON.stringify(ORIGIN), "process.env.NODE_ENV": JSON.stringify("production") },
  css: { postcss: { plugins: [tailwindcss({ base: web })] } },
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${resolve(web, "src")}/` },
      { find: /^next\/navigation$/, replacement: resolve(e2e, "side-deck-unready-next.ts") },
      { find: /^socket\.io-client$/, replacement: resolve(e2e, "side-deck-unready-next.ts") },
    ],
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: bundle,
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(e2e, "side-deck-unready-browser.tsx"),
      output: { entryFileNames: "browser.js", assetFileNames: "browser.[ext]" },
    },
  },
  plugins: [{
    name: "side-deck-next-stubs",
    enforce: "pre",
    resolveId(id: string) {
      if (id === "next/font/google" || id === "next/font/local") return "\0fonts";
      if (id === "next/link") return "\0link";
    },
    load(id: string) {
      if (id === "\0fonts") {
        return `const font = () => ({ className: "", variable: "", style: {} });
          export { font as Oxanium, font as Newsreader, font as Sofia_Sans_Semi_Condensed, font as Sofia_Sans_Extra_Condensed };
          export default font;`;
      }
      if (id === "\0link") {
        return `import { createElement } from "react";
          export default function Link({ href, prefetch, ...rest }) { return createElement("a", { href: String(href), ...rest }); }`;
      }
    },
  }, react()],
});
await writeFile(resolve(bundle, "index.html"), `<!doctype html><html lang="en" class="dark"><head><meta charset="utf-8">
  <title>Side deck Ready proof</title><link rel="stylesheet" href="./browser.css">
  <style>body{margin:0;min-height:100vh;background:#0A0E1A;color:#E8ECF4;font-family:Arial,sans-serif}</style></head>
  <body><div id="root"></div><script type="module" src="./browser.js"></script></body></html>`);

// ---- The scripted scenario ------------------------------------------------------------------------
type Check = { step: string; check: string; ok: boolean; detail: string };
const checks: Check[] = [];
const shots: Record<string, string> = {};
function check(step: string, name: string, ok: boolean, detail: unknown = "") {
  checks.push({ step, check: name, ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
  console.log(`${ok ? "PASS" : "FAIL"} [${step}] ${name}${detail === "" ? "" : ` (${typeof detail === "string" ? detail : JSON.stringify(detail)})`}`);
}

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const pageErrors: string[] = [];
const unrouted: string[] = [];
let exitCode = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
  page.on("pageerror", (error: Error) => pageErrors.push(error.message));
  await page.route(`${ORIGIN}/**`, async (route: any) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/cards/")) return route.fulfill(cardImage(url.pathname.split("/")[3] ?? "0"));
    if (url.pathname.startsWith("/api/")) {
      const raw = request.postData();
      const response = await api(request.method(), url, raw ? JSON.parse(raw) : null);
      if (response.status === 404) unrouted.push(`${request.method()} ${url.pathname}`);
      return route.fulfill(response);
    }
    // The bundle, then packages/web/public (card backs and other static art).
    const publicDir = resolve(web, "public");
    let file = resolve(bundle, `.${url.pathname}`);
    if (!file.startsWith(bundle) || !existsSync(file)) file = resolve(publicDir, `.${url.pathname}`);
    if (!file.startsWith(publicDir) && !file.startsWith(bundle)) return route.fulfill({ status: 404, body: "" });
    if (!existsSync(file)) return route.fulfill({ status: 404, body: "" });
    const types: Record<string, string> = {
      ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
      ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".mp3": "audio/mpeg", ".woff2": "font/woff2",
    };
    return route.fulfill({ status: 200, contentType: types[extname(file)] ?? "application/octet-stream", body: readFileSync(file) });
  });

  const dialog = page.getByRole("dialog", { name: "Side deck" });
  const navigations = () => page.evaluate(() => window.__navigations) as Promise<string[]>;
  const shot = async (name: string) => {
    const file = resolve(out, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    shots[name] = file;
  };
  const openSide = async () => {
    await page.getByRole("button", { name: "Side deck", exact: true }).first().click();
    await dialog.waitFor({ state: "visible" });
    await dialog.locator('section[aria-label="Side deck"] li button').first().waitFor({ state: "visible" });
    await page.waitForTimeout(400);
  };

  // a. The side deck screen, before Ready.
  await page.goto(`${ORIGIN}/index.html?slug=${game1}`);
  await openSide();
  await shot("a-side-deck-before-ready");
  check("a", "side deck screen is open on game 1", await dialog.isVisible());
  check("a", "server: player 1 is not ready", seriesNow().sideReady[p1Index] === false, seriesNow().sideReady);
  check("a", "Ready for next game is offered", await dialog.getByRole("button", { name: "Ready for next game" }).isEnabled());

  // b. After clicking Ready (the panel closes on Ready; reopen it to keep siding).
  await dialog.getByRole("button", { name: "Ready for next game" }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.waitForTimeout(500);
  await openSide();
  await shot("b-after-ready");
  check("b", "server: player 1 is ready", seriesNow().sideReady[p1Index] === true, seriesNow().sideReady);
  check("b", "panel shows the player as ready", await dialog.getByRole("button", { name: "Ready", exact: true }).isDisabled());

  // c. After a swap (no save).
  await dialog.locator('section[aria-label="Main deck"] li button').nth(0).click();
  await dialog.locator('section[aria-label="Side deck"] li button').nth(1).click();
  await page.waitForTimeout(1500);
  await shot("c-after-swap");
  check("c", "the swap is on screen", (await dialog.getByText("1 card swapped from your registered deck").count()) === 1);
  check("c", "server: player 1 is no longer ready (nothing saved)", seriesNow().sideReady[p1Index] === false, seriesNow().sideReady);
  check("c", "panel says the player is no longer ready", (await dialog.getByText(/You are no longer ready/).count()) === 1);

  // d. The opponent readies.
  const opponent = await callHost({ op: "series-ready", slug: game1, playerId: p2 });
  await page.waitForTimeout(4000);
  await shot("d-after-opponent-ready");
  const afterD = seriesNow();
  check("d", "opponent's Ready did not start game 2", opponent.data?.nextSlug == null && afterD.status === "between_games",
    { opponentNextSlug: opponent.data?.nextSlug ?? null, series: afterD.status, game: afterD.gameNumber });
  check("d", "player 1 was not moved to another game", (await navigations()).length === 0, await navigations());
  check("d", "player 1 is still on the side deck screen", await dialog.isVisible());

  // e. Player 1 clicks Ready again: the next game starts with the swapped deck.
  if (await dialog.isVisible()) {
    await dialog.getByRole("button", { name: "Ready for next game" }).click();
    await page.waitForFunction(() => window.__navigations.length > 0, undefined, { timeout: 15_000 }).catch(() => undefined);
    // A live game first offers its own window; stay in this tab to show the board.
    const here = page.getByRole("button", { name: "Open here instead" });
    await here.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
    if (await here.isVisible()) await here.click();
    await page.locator('[data-duel-field="true"]').waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(2500);
    await shot("e-after-ready-again");
    check("e", "game 2's board is on screen", await page.locator('[data-duel-field="true"]').isVisible());
    const afterE = seriesNow();
    const nav = await navigations();
    check("e", "game 2 started", afterE.status === "active" && afterE.gameNumber === 2, { series: afterE.status, game: afterE.gameNumber });
    // The panel and the room's own follow both replace the URL with game 2: one move, maybe sent twice.
    check("e", "player 1 followed to game 2", nav.length > 0 && nav.every((href) => href.endsWith(`/${afterE.currentDuelSlug}`)), nav);
    if (afterE.currentDuelSlug && afterE.currentDuelSlug !== game1) {
      const game2 = duels.get(afterE.currentDuelSlug, GUILD);
      const seat = game2.seats.find((entry) => entry.playerId === p1)!.seat;
      const deck = duels.privateState(game2.slug, GUILD).decks[seat];
      check("e", "game 2 uses player 1's swapped deck", JSON.stringify(deck) === JSON.stringify(swapped));
    }
  } else {
    await shot("e-after-ready-again");
    const moved = seriesNow();
    let deckUsed = "unknown";
    if (moved.currentDuelSlug && moved.currentDuelSlug !== game1) {
      const game2 = duels.get(moved.currentDuelSlug, GUILD);
      const seat = game2.seats.find((entry) => entry.playerId === p1)!.seat;
      const deck = JSON.stringify(duels.privateState(game2.slug, GUILD).decks[seat]);
      deckUsed = deck === JSON.stringify(swapped) ? "the swapped deck" : deck === JSON.stringify(registered) ? "the registered deck (swap lost)" : "another deck";
    }
    check("e", "player 1 could click Ready again on the side deck screen", false,
      `already moved at step d: ${JSON.stringify(await navigations())}, game ${moved.gameNumber} started with ${deckUsed}`);
  }
  check("all", "no browser errors", pageErrors.length === 0, pageErrors);
  check("all", "every API call the room made is mirrored", unrouted.length === 0, [...new Set(unrouted)]);
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  await browser.close();
  await host.close();
  db.close();
  cardDb.close();
  rmSync(tmp, { recursive: true, force: true });
}
await writeFile(resolve(out, "evidence.json"), JSON.stringify({ checks, screenshots: shots }, null, 2));
const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed. Screenshots: ${out}`);
process.exit(exitCode || (failed.length > 0 ? 1 : 0));
