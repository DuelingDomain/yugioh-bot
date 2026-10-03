import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { defaultDuelSettings, type DuelRoom, type DuelSeriesSummary } from "@yugidraft/shared/duels";

/*
 * Browser proof for a Best of 3 between games: the real DuelRoomView and end screen, bundled with vite and
 * driven by Playwright. There is no test login, so the page is served from a fake origin and every request
 * goes through page.route: /api/duels/<slug> answers from the mocked series state below, which each step
 * advances the way the server would. The room sees those changes the way it does in production: a socket
 * invalidation when a game ends (stood in for by window.__duelChanged, which calls the room's own refresh),
 * and the room's real 2 second poll between games. Nothing is clicked unless a step says so.
 *
 * Playwright is not a repo dependency:
 *   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs PROOF_DIR=/tmp/proof \
 *     node --import tsx packages/web/e2e/spectator-series.playwright.ts
 * ROOM_SRC points the build at another copy of packages/web/src (e.g. an older commit) to compare.
 * BUILD_ONLY=1 builds the browser bundle without importing Playwright or launching Chromium.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const webRoot = resolve(here, "..");
const src = resolve(process.env.ROOM_SRC ?? resolve(webRoot, "src"));
const out = resolve(process.env.PROOF_DIR ?? "/tmp/spectator-series-proof");
const bundle = resolve(process.env.BUNDLE_DIR ?? resolve(out, ".bundle"));
const ORIGIN = "http://yugidraft.test";
await mkdir(out, { recursive: true });

// ---- Build the real room into a static bundle ------------------------------------------------------------

const stubs: Record<string, string> = {
  "next/navigation": `
    const log = (window.__navigations ??= []);
    function go(method, href) {
      log.push({ method, href: String(href) });
      window.history[method === "push" ? "pushState" : "replaceState"](window.history.state, "", href);
      window.dispatchEvent(new Event("harness:navigate"));
    }
    const router = { replace: (h) => go("replace", h), push: (h) => go("push", h), back: () => window.history.back(),
      forward: () => window.history.forward(), refresh() {}, prefetch() {} };
    export function useRouter() { return router; }
    export function usePathname() { return window.location.pathname; }
    export function useSearchParams() { return new URLSearchParams(window.location.search); }
    export function useParams() { return {}; }
    export function redirect(href) { go("replace", href); }
    export function notFound() { throw new Error("notFound"); }`,
  "next/link": `
    import React from "react";
    const Link = React.forwardRef(function Link({ href, prefetch, replace, scroll, shallow, passHref, legacyBehavior, ...rest }, ref) {
      return React.createElement("a", { ...rest, ref, href: typeof href === "string" ? href : href?.pathname ?? "" });
    });
    export default Link;`,
  "next/image": `
    import React from "react";
    export default function Image({ src, fill, priority, quality, sizes, unoptimized, placeholder, blurDataURL, loader, ...rest }) {
      return React.createElement("img", { ...rest, src: typeof src === "string" ? src : src?.src });
    }`,
  "next/font/google": `
    const font = () => ({ className: "", variable: "", style: {} });
    export { font as Oxanium, font as Newsreader, font as Sofia_Sans_Semi_Condensed, font as Sofia_Sans_Extra_Condensed };`,
  // The socket only tells the room "something changed"; the room then refetches. Stand in for it with a hook
  // the test can fire, calling the same refresh the real socket calls.
  websocket: `
    import { useEffect, useRef } from "react";
    export function useDuelWebsocket(slug, seat, onChange) {
      const change = useRef(onChange);
      change.current = onChange;
      useEffect(() => {
        window.__duelChanged = () => change.current();
        return () => { window.__duelChanged = undefined; };
      }, [slug]);
      return { slug, connected: true, presence: null, syncing: false, recovering: false, resync: async () => { await change.current(); } };
    }`,
};

await build({
  configFile: false,
  logLevel: "warn",
  root: here,
  base: "/__harness/",
  cacheDir: resolve(bundle, ".vite"),
  css: { postcss: webRoot },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env.NEXT_PUBLIC_WS_URL": JSON.stringify(""),
  },
  resolve: { alias: { "@": src }, dedupe: ["react", "react-dom", "swr"] },
  build: {
    outDir: bundle, emptyOutDir: true, minify: false,
    rollupOptions: {
      input: resolve(here, "spectator-series-browser.tsx"),
      output: { entryFileNames: "browser.js", assetFileNames: "browser.[ext]" },
    },
  },
  plugins: [{
    name: "spectator-series-stubs",
    enforce: "pre",
    resolveId(id: string) {
      if (id in stubs) return `\0stub:${id}`;
      if (/[\\/]lib[\\/]hooks[\\/]use-duel-websocket(\.tsx?)?$/.test(id)) return "\0stub:websocket";
      return null;
    },
    load(id: string) {
      return id.startsWith("\0stub:") ? stubs[id.slice("\0stub:".length)] : null;
    },
  }, react()],
});
if (process.env.BUILD_ONLY === "1") {
  console.log(`Spectator series browser bundle built: ${bundle}`);
  process.exit(0);
}
const playwrightModule = process.env.PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = await import(playwrightModule.startsWith("/") ? pathToFileURL(playwrightModule).href : playwrightModule);
const indexHtml = `<!doctype html><html lang="en" class="dark"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1"><title>Duel room</title>
  <link rel="stylesheet" href="/__harness/browser.css"></head>
  <body style="margin:0;background:#070b15"><div id="root"></div><script type="module" src="/__harness/browser.js"></script></body></html>`;

// ---- The mocked server state -----------------------------------------------------------------------------

type Viewer = "spectator" | "player";
type Game = { slug: string; number: number; status: "active" | "completed"; winnerSeat: 0 | 1 | null; firstIndex?: 0 | 1 };
type World = {
  viewer: Viewer;
  visibility: "public" | "private";
  games: Map<string, Game>;
  series: DuelSeriesSummary;
};

let revision = 10;
const NAMES: [string, string] = ["Sulman", "Imran"];

function seriesState(overrides: Partial<DuelSeriesSummary>): DuelSeriesSummary {
  return {
    id: 7, bestOf: 3, ranked: false, status: "active", playerIds: [1, 2], displayNames: NAMES, wins: [0, 0],
    gameNumber: 1, currentDuelSlug: "game-1", winnerPlayerId: null, tournamentId: null, tournamentSlug: null,
    tournamentMatchId: null, nextGameAt: null, sideReady: [false, false], hasSide: [false, false],
    firstChooser: null, firstChoice: null, vsBot: false,
    ...overrides,
  };
}

function seat(index: 0 | 1, lp: number) {
  return {
    seat: index, lp, hand: [], deckCount: 30, extraCount: 0, extra: [],
    monsters: Array.from({ length: 7 }, () => null), spells: Array.from({ length: 8 }, () => null),
    graveyard: [], banished: [],
  };
}

function roomFor(world: World, slug: string): DuelRoom | null {
  const game = world.games.get(slug);
  if (!game) return null;
  const done = game.status === "completed";
  const winner = done ? game.winnerSeat : null;
  const result = done ? { winnerSeat: winner, reason: "Life points reached 0" } : null;
  const firstIndex = game.firstIndex ?? 0;
  const order = firstIndex === 0 ? [0, 1] as const : [1, 0] as const;
  return {
    session: {
      id: game.number, slug, name: "Table", guildId: "g", organizerPlayerId: 1, mode: "normal", masterRule: 5,
      status: game.status,
      settings: { ...defaultDuelSettings("normal"), visibility: world.visibility },
      seats: order.map((index, seat) => ({ seat, playerId: index + 1, displayName: NAMES[index], ready: true, isBot: false })),
      createdAt: "", endedAt: done ? new Date().toISOString() : null, archivedAt: null,
      winnerPlayerId: winner == null ? null : order[winner] + 1, winnerSeat: winner,
      resultReason: done ? "Life points reached 0" : null,
      bestOf: 3, seriesId: 7, gameNumber: game.number,
    },
    role: world.viewer,
    mySeat: world.viewer === "player" ? (firstIndex === 0 ? 0 : 1) : null,
    myDeck: null,
    clock: null,
    metadataOnly: false,
    engine: {
      revision, turn: 4, turnSeat: 0, phase: done ? "end" : "main1",
      seats: [seat(0, winner === 1 ? 0 : 8000), seat(1, winner === 0 ? 0 : 8000)],
      prompt: null, chain: [], events: [], log: [], result,
    },
    series: world.series,
    mySide: null,
  } as unknown as DuelRoom;
}

/** Changes the server state, as the duel host would between two polls. */
function advance(world: World, change: (world: World) => void) {
  change(world);
  revision += 1;
}

// ---- Checks and screenshots ------------------------------------------------------------------------------

type Outcome = { scenario: string; check: string; pass: boolean; detail?: string };
const outcomes: Outcome[] = [];
const shots: string[] = [];

async function check(scenario: string, name: string, run: () => Promise<void>) {
  try {
    await run();
    outcomes.push({ scenario, check: name, pass: true });
    console.log(`PASS  ${scenario} › ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
    outcomes.push({ scenario, check: name, pass: false, detail });
    console.log(`FAIL  ${scenario} › ${name}\n      ${detail}`);
  }
}

function expectEqual(actual: unknown, expected: unknown, what: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  headless: true,
});

/* eslint-disable @typescript-eslint/no-explicit-any */
async function openRoom(scenario: string, world: World, slug: string) {
  const page: any = await browser.newPage({ viewport: { width: Number(process.env.PROOF_WIDTH ?? 1440), height: Number(process.env.PROOF_WIDTH ?? 1440) < 600 ? 844 : 900 }, colorScheme: "dark", reducedMotion: "reduce" });
  const errors: string[] = [];
  const unexpected: string[] = [];
  const roomGets: string[] = [];
  page.on("pageerror", (error: Error) => errors.push(error.message));
  await page.route("**/*", async (route: any) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.fulfill({ status: 404, body: "" });
    if (url.pathname.startsWith("/__harness/")) {
      const file = resolve(bundle, url.pathname.slice("/__harness/".length));
      const type = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" }[extname(file)];
      try {
        return await route.fulfill({ status: 200, contentType: type ?? "application/octet-stream", body: await readFile(file) });
      } catch {
        return route.fulfill({ status: 404, body: "" });
      }
    }
    if (url.pathname.startsWith("/duel/")) {
      // Static art the room references from packages/web/public (card backs).
      try {
        const file = resolve(webRoot, "public", url.pathname.slice(1));
        return await route.fulfill({ status: 200, contentType: extname(file) === ".webp" ? "image/webp" : "application/octet-stream", body: await readFile(file) });
      } catch {
        unexpected.push(`GET ${url.pathname} (missing in public/)`);
        return route.fulfill({ status: 404, body: "" });
      }
    }
    if (url.pathname.startsWith("/duels/")) return route.fulfill({ status: 200, contentType: "text/html", body: indexHtml });
    const roomMatch = /^\/api\/duels\/([^/]+)$/.exec(url.pathname);
    if (roomMatch && route.request().method() === "GET") {
      const target = decodeURIComponent(roomMatch[1]);
      roomGets.push(target);
      const room = roomFor(world, target);
      return room
        ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(room) })
        : route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Duel not found" }) });
    }
    if (url.pathname.startsWith("/api/cards/")) {
      return route.fulfill({ status: 200, contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="59" height="86"><rect width="59" height="86" fill="#2a3350"/></svg>` });
    }
    unexpected.push(`${route.request().method()} ${url.pathname}`);
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not mocked" }) });
  });
  await page.goto(`${ORIGIN}${world.viewer === "player" ? `/duels/${slug}?window=1` : `/duels/${slug}`}`);
  await page.locator('[data-duel-field="true"], [data-testid="duel-result"]').first().waitFor({ state: "visible", timeout: 30000 });
  let shot = 0;
  return {
    page,
    errors,
    unexpected,
    roomGets,
    path: () => new URL(page.url()).pathname,
    navigations: (): Promise<Array<{ method: string; href: string }>> => page.evaluate(() => (window as any).__navigations ?? []),
    /** A socket invalidation: the room refetches, exactly as on duel:changed. */
    invalidate: () => page.evaluate(() => (window as any).__duelChanged?.()),
    result: () => page.locator('[data-testid="duel-result"]'),
    screenshot: async (name: string) => {
      shot += 1;
      const file = resolve(out, `${scenario}-${shot}-${name}.png`);
      await page.waitForTimeout(250);
      await page.screenshot({ path: file });
      shots.push(file);
    },
  };
}

const visible = async (locator: any, what: string, timeout = 6000) => {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
  } catch {
    throw new Error(`${what} not visible within ${timeout} ms`);
  }
};
const hidden = async (locator: any, what: string) => {
  const count = await locator.count();
  if (count > 0 && await locator.first().isVisible()) throw new Error(`${what} is showing`);
};
const POLL_WINDOW = 4500; // more than two 2 s polls

function gameOneLive(viewer: Viewer, visibility: World["visibility"]): World {
  return {
    viewer, visibility,
    games: new Map([["game-1", { slug: "game-1", number: 1, status: "active", winnerSeat: null }]]),
    series: seriesState({}),
  };
}
const endGameOne = (world: World) => {
  world.games.set("game-1", { slug: "game-1", number: 1, status: "completed", winnerSeat: 0 });
  world.series = seriesState({ status: "between_games", wins: [1, 0], firstChooser: 1, nextGameAt: new Date(Date.now() + 90_000).toISOString() });
};
const startGameTwo = (world: World) => {
  const chooser = world.series.firstChooser ?? 1;
  const firstIndex = world.series.firstChoice === "second" ? (chooser === 0 ? 1 : 0) : chooser;
  world.games.set("game-2", { slug: "game-2", number: 2, status: "active", winnerSeat: null, firstIndex });
  world.series = seriesState({ status: "active", wins: [1, 0], gameNumber: 2, currentDuelSlug: "game-2" });
};
const readyRow = (page: any, name: string) => page.locator('[data-testid="series-ready-row"]').filter({ hasText: name });

/** Runs one scenario; a crash is recorded as a failed check so the other scenarios still run. */
async function scenarioBlock(scenario: string, run: (scenario: string) => Promise<void>) {
  try {
    await run(scenario);
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
    outcomes.push({ scenario, check: "scenario ran to the end", pass: false, detail });
    console.log(`FAIL  ${scenario} › scenario ran to the end\n      ${detail}`);
  }
}

async function finish(scenario: string, room: Awaited<ReturnType<typeof openRoom>>) {
  await check(scenario, "no page errors, no unmocked requests", async () => {
    expectEqual(room.errors, [], "page errors");
    expectEqual(room.unexpected, [], "unmocked requests");
  });
  await room.page.close();
}

// ---- Scenario 1: a spectator on a public table watches game 1 through to game 2 ---------------------------
await scenarioBlock("spectator-public", async (scenario) => {
  const world = gameOneLive("spectator", "public");
  const room = await openRoom(scenario, world, "game-1");
  await check(scenario, "1. game 1 is live: board shown, no end screen, URL /duels/game-1", async () => {
    await visible(room.page.locator('[data-duel-field="true"]'), "duel field");
    await hidden(room.result(), "end screen");
    expectEqual(room.path(), "/duels/game-1", "URL");
  });
  await room.screenshot("game1-live");

  advance(world, endGameOne);
  await room.invalidate();
  await check(scenario, "2. game 1 ends: end screen says side decking is in progress", async () => {
    await visible(room.result(), "end screen");
    await visible(room.result().getByText("Side decking in progress"), "\"Side decking in progress\"");
  });
  await check(scenario, "2. Imran is choosing first or second; no first player announced yet", async () => {
    const choice = room.result().getByText("Imran is choosing to go first or second…", { exact: true });
    await visible(choice.first(), "Imran's pending choice");
    expectEqual(await choice.count(), 1, "choice status shown once");
    const info = await room.result().getByTestId("between-games-info").textContent();
    expectEqual(info.includes("goes first"), false, "order announced before the choice");
  });
  await check(scenario, "2. both players' Ready rows show, neither ready", async () => {
    await visible(readyRow(room.page, "Sulman"), "Sulman's Ready row", 2000);
    expectEqual(await room.page.locator('[data-testid="series-ready-row"]').count(), 2, "Ready rows");
    expectEqual(await readyRow(room.page, "Sulman").getAttribute("data-ready"), "false", "Sulman ready");
    expectEqual(await readyRow(room.page, "Imran").getAttribute("data-ready"), "false", "Imran ready");
  });
  await check(scenario, "2. URL is still /duels/game-1", async () => expectEqual(room.path(), "/duels/game-1", "URL"));
  await room.screenshot("game1-ended-siding");

  advance(world, (w) => { w.series = { ...w.series, sideReady: [false, true], firstChoice: "second" }; });
  await check(scenario, "3. Imran clicks Ready: his row turns Ready on the next poll (no socket push)", async () => {
    await visible(readyRow(room.page, "Imran").and(room.page.locator('[data-ready="true"]')), "Imran's row marked Ready", POLL_WINDOW);
    expectEqual((await readyRow(room.page, "Imran").textContent())?.includes("Ready"), true, "Imran row says Ready");
    expectEqual(await readyRow(room.page, "Sulman").getAttribute("data-ready"), "false", "Sulman still siding");
  });
  await check(scenario, "3. Imran chose second: Sulman goes first in game 2", async () => {
    await visible(room.result().getByText("Sulman goes first (Imran chose to go second)"), "chosen order", POLL_WINDOW);
    expectEqual(await room.result().getByText(/chose to go second/).count(), 1, "choice shown once");
  });
  await room.screenshot("imran-ready");

  // A phone held sideways: the series and Ready cards make the stack taller than the screen. The overlay
  // must scroll so the actions stay reachable.
  await room.page.setViewportSize({ width: 844, height: 390 });
  await room.screenshot("phone-landscape-top");
  await check(scenario, "3. at 844×390 the overlay scrolls and Exit can be reached and clicked", async () => {
    await visible(room.result().getByText("Side decking in progress"), "\"Side decking in progress\"", 1000);
    const exit = room.result().getByRole("button", { name: "Exit duel" });
    await room.page.mouse.move(422, 195);
    await room.page.mouse.wheel(0, 2000);
    await room.page.waitForTimeout(300);
    const box = await exit.boundingBox({ timeout: 1000 });
    if (!box) throw new Error("Exit button has no box");
    if (box.y < 0 || box.y + box.height > 390) {
      throw new Error(`Exit button spans y ${Math.round(box.y)}–${Math.round(box.y + box.height)} after scrolling, outside the 390 px screen`);
    }
    const hit = await exit.evaluate((button: Element, point: { x: number; y: number }) => button.contains(document.elementFromPoint(point.x, point.y)), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expectEqual(hit, true, "Exit button is the element under its own centre");
  });
  await room.screenshot("phone-landscape-scrolled");
  await room.page.setViewportSize({ width: 1440, height: 900 });

  const getsBefore = room.roomGets.length;
  advance(world, startGameTwo);
  await check(scenario, "4. game 2 starts: the browser moves to /duels/game-2 by itself, no click", async () => {
    try {
      await room.page.waitForURL(`${ORIGIN}/duels/game-2`, { timeout: POLL_WINDOW + 1500 });
    } catch {
      throw new Error(`still on ${room.path()} ${POLL_WINDOW + 1500} ms after game 2 started (room GETs since: ${room.roomGets.slice(getsBefore).join(", ")})`);
    }
    expectEqual(await room.navigations(), [{ method: "replace", href: "/duels/game-2" }], "router calls");
  });
  await check(scenario, "4. game 2's board is showing, end screen gone", async () => {
    await visible(room.page.locator('[data-duel-field="true"]'), "duel field");
    await hidden(room.result(), "end screen");
    if (!room.roomGets.includes("game-2")) throw new Error("game 2 was never fetched");
  });
  await room.screenshot("moved-to-game2");
  await finish(scenario, room);
});

// ---- Scenario 2: a spectator opens game 1 after game 2 has started --------------------------------------
await scenarioBlock("spectator-late", async (scenario) => {
  const world = gameOneLive("spectator", "public");
  endGameOne(world);
  startGameTwo(world);
  const room = await openRoom(scenario, world, "game-1");
  await check(scenario, "end screen points at the live game: \"Game 2 of 3 is live\" and \"Watch game 2\"", async () => {
    await visible(room.result(), "end screen");
    await visible(room.result().getByText("Game 2 of 3 is live"), "\"Game 2 of 3 is live\"");
    await visible(room.result().getByRole("button", { name: "Watch game 2" }), "\"Watch game 2\" button", 1000);
  });
  await check(scenario, "\"Watch game 2\" is the primary button", async () => {
    expectEqual(await room.result().getByRole("button", { name: "Watch game 2" }).getAttribute("data-kind"), "primary", "Watch kind");
  });
  await room.page.waitForTimeout(POLL_WINDOW);
  await check(scenario, `stays on /duels/game-1 for ${POLL_WINDOW} ms (no automatic move)`, async () => {
    expectEqual(room.path(), "/duels/game-1", "URL");
    expectEqual(await room.navigations(), [], "router calls");
  });
  await room.screenshot("stays-on-game1");
  await check(scenario, "clicking \"Watch game 2\" opens game 2", async () => {
    await room.result().getByRole("button", { name: "Watch game 2" }).click({ timeout: 2000 });
    await room.page.waitForURL(`${ORIGIN}/duels/game-2`, { timeout: 3000 });
  });
  await room.screenshot("after-watch-click");
  await finish(scenario, room);
});

// ---- Scenario 3: an admitted spectator follows a private table --------------------------------------------
await scenarioBlock("spectator-private", async (scenario) => {
  const world = gameOneLive("spectator", "private");
  const room = await openRoom(scenario, world, "game-1");
  advance(world, endGameOne);
  await room.invalidate();
  await check(scenario, "game 1 ends: side decking shown, spectator will move to game 2", async () => {
    await visible(room.result().getByText("Side decking in progress"), "\"Side decking in progress\"");
    await visible(room.result().getByText(/You will move to game 2/), "\"You will move to game 2\"");
  });
  await room.screenshot("game1-ended-siding");
  advance(world, startGameTwo);
  await check(scenario, "game 2 starts: the browser moves to /duels/game-2 by itself, no click", async () => {
    await room.page.waitForURL(`${ORIGIN}/duels/game-2`, { timeout: POLL_WINDOW + 1500 });
    expectEqual(await room.navigations(), [{ method: "replace", href: "/duels/game-2" }], "router calls");
  });
  await check(scenario, "game 2's board is showing, end screen gone", async () => {
    await visible(room.page.locator('[data-duel-field="true"]'), "duel field");
    await hidden(room.result(), "end screen");
    if (!room.roomGets.includes("game-2")) throw new Error("game 2 was never fetched");
  });
  await room.screenshot("moved-to-game2");
  await finish(scenario, room);
});

// ---- Scenario 4: the series is decided --------------------------------------------------------------------
await scenarioBlock("spectator-decided", async (scenario) => {
  const world: World = {
    viewer: "spectator", visibility: "public",
    games: new Map([["game-3", { slug: "game-3", number: 3, status: "active", winnerSeat: null }]]),
    series: seriesState({ wins: [1, 1], gameNumber: 3, currentDuelSlug: "game-3" }),
  };
  const room = await openRoom(scenario, world, "game-3");
  advance(world, (w) => {
    w.games.set("game-3", { slug: "game-3", number: 3, status: "completed", winnerSeat: 0 });
    w.series = seriesState({ status: "completed", wins: [2, 1], gameNumber: 3, currentDuelSlug: "game-3", winnerPlayerId: 1 });
  });
  await room.invalidate();
  await check(scenario, "game 3 ends: \"Sulman wins the series\", final score 2 – 1", async () => {
    await visible(room.result().getByText("Sulman wins the series"), "\"Sulman wins the series\"");
    await visible(room.result().getByText(/Final score 2\s*[–-]\s*1/), "final score", 1000);
  });
  await check(scenario, "no Ready rows, no Watch button", async () => {
    expectEqual(await room.page.locator('[data-testid="series-ready-row"]').count(), 0, "Ready rows");
    await hidden(room.result().getByRole("button", { name: /Watch game/ }), "Watch button");
  });
  await room.page.waitForTimeout(POLL_WINDOW);
  await check(scenario, `stays on /duels/game-3 for ${POLL_WINDOW} ms`, async () => {
    expectEqual(room.path(), "/duels/game-3", "URL");
    expectEqual(await room.navigations(), [], "router calls");
  });
  await room.screenshot("series-decided");
  await finish(scenario, room);
});

// ---- Scenario 5: a player still follows exactly as before -------------------------------------------------
await scenarioBlock("player", async (scenario) => {
  const world = gameOneLive("player", "public");
  const room = await openRoom(scenario, world, "game-1");
  advance(world, endGameOne);
  await room.invalidate();
  await check(scenario, "game 1 ends: the player gets the Between games screen and Ready button", async () => {
    const between = room.page.getByTestId("between-games");
    await visible(between, "Between games screen");
    await visible(between.getByRole("button", { name: "Ready", exact: true }), "Ready button");
    expectEqual(await between.getByTestId("opponent-first-status").textContent(), "Opponent is choosing to go first or second…", "opponent's pending choice");
    expectEqual(await room.page.locator('[data-testid="series-ready-row"]').count(), 0, "spectator Ready rows");
  });
  await room.screenshot("game1-ended");
  advance(world, startGameTwo);
  await check(scenario, "game 2 starts: the player's duel window moves to /duels/game-2?window=1 by itself", async () => {
    try {
      await room.page.waitForURL(`${ORIGIN}/duels/game-2?window=1`, { timeout: POLL_WINDOW + 1500 });
    } catch {
      throw new Error(`still on ${room.path()}`);
    }
    expectEqual(await room.navigations(), [{ method: "replace", href: "/duels/game-2?window=1" }], "router calls");
  });
  await room.screenshot("moved-to-game2");
  await finish(scenario, room);
});

await browser.close();

const failed = outcomes.filter((outcome) => !outcome.pass);
await writeFile(resolve(out, "results.json"), JSON.stringify({ src, outcomes, screenshots: shots }, null, 2));
console.log(`\n${outcomes.length - failed.length} passed, ${failed.length} failed (room source: ${src})`);
console.log(`screenshots: ${out}`);
process.exitCode = failed.length ? 1 : 0;
