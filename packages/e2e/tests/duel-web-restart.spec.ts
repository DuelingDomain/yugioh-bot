import Database from "better-sqlite3";
import type { DuelCommand } from "@yugidraft/shared/duels";
import { test, expect } from "../helpers/fixtures";
import { expectReadyToAct, handCard, pickLegalZone, startDuel as startLiveDuel, useCard, watchDuel } from "../helpers/board";
import { FILLER, withFiller } from "../helpers/decks";
import { dbPath } from "../stack/env.mjs";

// These cases share fixture identities; two concurrent lobby creations would
// replace one another under the one-waiting-table-per-host rule.
test.describe.configure({ mode: "default" });

let finishDuel: (() => Promise<void>) | undefined;
test.afterEach(async () => {
  await finishDuel?.();
  finishDuel = undefined;
});

async function startDuel(...args: Parameters<typeof startLiveDuel>) {
  await Promise.all([args[0], args[1]].map(seat => seat.page.emulateMedia({ reducedMotion: "reduce" })));
  const duel = await startLiveDuel(...args);
  finishDuel = async () => {
    const response = await args[1].page.request.post(`/api/duels/${duel.slug}/surrender`);
    expect([200, 409]).toContain(response.status());
  };
  return duel;
}

function acceptedCount(slug: string, command: DuelCommand): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare(`SELECT command_json FROM duel_commands c JOIN duels d ON d.id = c.duel_id
      WHERE d.web_slug = ?`).all(slug).filter(row => {
      const saved = JSON.parse((row as { command_json: string }).command_json) as DuelCommand;
      return saved.promptId === command.promptId && saved.revision === command.revision;
    }).length;
  } finally { db.close(); }
}

const cases = [
  { failure: 502, width: 1920, height: 1080 },
  { failure: 503, width: 2560, height: 1440 },
  { failure: 504, width: 1366, height: 768 },
  { failure: "network", width: 390, height: 844 },
  { failure: "upstream", width: 1440, height: 900 },
] as const;

for (const { failure, width, height } of cases) {
  test(`a move survives ${failure} at ${width}x${height} and lands once`, async ({ player }, testInfo) => {
    const alice = await player("p1"), bob = await player("p2");
    await alice.page.setViewportSize({ width, height });
    const { slug } = await startDuel(alice, bob, "web-retry",
      { main: withFiller([FILLER], 14) }, { main: withFiller([FILLER], 14) });
    await useCard(alice.page, handCard(alice.page, FILLER), "Normal Summon");
    const commands: DuelCommand[] = [];
    await alice.page.route(`**/api/duels/${slug}/actions`, async route => {
      commands.push(route.request().postDataJSON() as DuelCommand);
      if (commands.length > 3) return route.continue();
      if (failure === "network") return route.abort("connectionreset");
      if (failure === "upstream") return route.fulfill({ status: 503, contentType: "application/json",
        body: JSON.stringify({ error: "Duel host unavailable", code: "DUEL_UPSTREAM_UNAVAILABLE" }) });
      return route.fulfill({ status: failure, contentType: "application/json", body: JSON.stringify({ error: "web restarting" }) });
    });
    await pickLegalZone(alice.page, "mz");
    const reconnecting = alice.page.getByRole("status").filter({ hasText: "Reconnecting" });
    await expect(reconnecting).toBeVisible();
    await expect(reconnecting.locator(":scope > span")).toBeVisible({ timeout: 1000 });
    const box = await reconnecting.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(height);
    const screenshot = testInfo.outputPath(`reconnecting-${width}x${height}.png`);
    await alice.page.screenshot({ path: screenshot, animations: "disabled" });
    await testInfo.attach(`reconnecting-${width}x${height}`, { path: screenshot, contentType: "image/png" });
    await expect(alice.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]')).toHaveCount(1);
    await expect(reconnecting).toHaveCount(0);
    expect(commands).toHaveLength(4);
    expect(commands.every(command => JSON.stringify(command) === JSON.stringify(commands[0]))).toBe(true);
    expect(acceptedCount(slug, commands[0]!)).toBe(1);
    await expect(alice.page.getByRole("main").getByRole("alert")).toHaveCount(0);
  });
}

test("a lost accepted response is replayed safely and a different stale answer is refused", async ({ player }) => {
  const alice = await player("p1"), bob = await player("p2");
  const { slug } = await startDuel(alice, bob, "lost-response",
    { main: withFiller([FILLER], 14) }, { main: withFiller([FILLER], 14) });
  await useCard(alice.page, handCard(alice.page, FILLER), "Normal Summon");
  const commands: DuelCommand[] = [];
  await alice.page.route(`**/api/duels/${slug}/actions`, async route => {
    commands.push(route.request().postDataJSON() as DuelCommand);
    if (commands.length > 1) return route.continue();
    const accepted = await route.fetch();
    expect(accepted.ok()).toBe(true);
    // The host committed the move, but the browser never received its reply.
    await route.abort("connectionreset");
  });
  await pickLegalZone(alice.page, "mz");
  await expect.poll(() => commands.length).toBe(2);
  await expect(alice.page.getByRole("status").filter({ hasText: "Reconnecting" })).toHaveCount(0);
  expect(commands[1]).toEqual(commands[0]);
  expect(acceptedCount(slug, commands[0]!)).toBe(1);
  const replay = await alice.page.request.post(`/api/duels/${slug}/actions`, { data: commands[0] });
  expect(replay.ok()).toBe(true);
  const changed = await alice.page.request.post(`/api/duels/${slug}/actions`, {
    data: { ...commands[0], answer: { choice: "a-different-answer" } },
  });
  expect(changed.status()).toBe(409);
  const otherSeat = await bob.page.request.post(`/api/duels/${slug}/actions`, { data: commands[0] });
  expect(otherSeat.status()).toBe(409);
  expect(acceptedCount(slug, commands[0]!)).toBe(1);
  await expect(alice.page.getByRole("main").getByRole("alert")).toHaveCount(0);
  expect((await bob.page.request.post(`/api/duels/${slug}/surrender`)).ok()).toBe(true);
  const finishedReplay = await alice.page.request.post(`/api/duels/${slug}/actions`, { data: commands[0] });
  expect(finishedReplay.ok()).toBe(true);
  expect((await finishedReplay.json()).session.status).toBe("completed");
  expect(acceptedCount(slug, commands[0]!)).toBe(1);
});

test("brief background read failures keep the live badge and open menu", async ({ player }) => {
  const alice = await player("p1"), bob = await player("p2");
  const { slug } = await startDuel(alice, bob, "read-recovery",
    { main: withFiller([FILLER], 14) }, { main: withFiller([FILLER], 14) });
  let reads = 0;
  await alice.page.route(`**/api/duels/${slug}`, async route => {
    if (++reads <= 3) return route.fulfill({ status: 503, body: "web restarting" });
    return route.continue();
  });
  await expectReadyToAct(alice.page);
  await handCard(alice.page, FILLER).click();
  const menu = alice.page.getByRole("menu");
  await expect(menu).toBeVisible();
  await alice.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => reads).toBeGreaterThanOrEqual(4);
  await expect(alice.page.getByRole("status").filter({ hasText: "Reconnecting" })).toHaveCount(0);
  await expect(menu).toBeVisible();
  await expect(alice.page.getByRole("status").filter({ hasText: "Live duel" })).toBeVisible();
  await menu.getByRole("menuitem", { name: /^Normal Summon/ }).click();
  await pickLegalZone(alice.page, "mz");
  await expect(alice.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]')).toHaveCount(1);
});

test("sustained background read failures eventually show Reconnecting", async ({ player }) => {
  const alice = await player("p1"), bob = await player("p2");
  const { slug } = await startDuel(alice, bob, "sustained-read-outage",
    { main: withFiller([FILLER], 14) }, { main: withFiller([FILLER], 14) });
  let reads = 0;
  await alice.page.route(`**/api/duels/${slug}`, async route => {
    if (++reads <= 5) return route.fulfill({ status: 503, body: "web restarting" });
    return route.continue();
  });
  const started = Date.now();
  await alice.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(alice.page.getByRole("status").filter({ hasText: "Reconnecting" })).toBeVisible();
  expect(Date.now() - started).toBeGreaterThanOrEqual(2900);
  await expect.poll(() => reads).toBeGreaterThanOrEqual(6);
  await expect(alice.page.getByRole("status").filter({ hasText: "Live duel" })).toBeVisible();
});

test("a fast background engine error keeps the live room quiet", async ({ player }) => {
  const alice = await player("p1"), bob = await player("p2");
  const { slug } = await startDuel(alice, bob, "background-engine-error",
    { main: withFiller([FILLER], 14) }, { main: withFiller([FILLER], 14) });
  await expectReadyToAct(alice.page);
  await handCard(alice.page, FILLER).click();
  const menu = alice.page.getByRole("menu");
  await expect(menu).toBeVisible();
  let reads = 0;
  await alice.page.route(`**/api/duels/${slug}`, route => {
    reads++;
    return route.fulfill({ status: 502, contentType: "application/json",
      body: JSON.stringify({ error: "Invalid engine response", code: "DUEL_ENGINE_ERROR" }) });
  });
  await alice.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => reads).toBe(1);
  await alice.page.waitForTimeout(750); // Observe the settled background failure.
  await expect(menu).toBeVisible();
  await expect(alice.page.getByRole("status").filter({ hasText: "Live duel" })).toBeVisible();
  await expect(alice.page.getByRole("status").filter({ hasText: "Reconnecting" })).toHaveCount(0);
  expect(reads).toBe(1);
  await alice.page.unroute(`**/api/duels/${slug}`);
  await menu.getByRole("menuitem", { name: /^Normal Summon/ }).click();
  await pickLegalZone(alice.page, "mz");
  await expect(alice.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]')).toHaveCount(1);
});

test("leaving the room cancels background retry attempts", async ({ player }) => {
  const alice = await player("p1"), bob = await player("p2"), eve = await player("p5");
  const { slug } = await startDuel(alice, bob, "cancel-read-retry",
    { main: withFiller([FILLER], 14) }, { main: withFiller([FILLER], 14) });
  await watchDuel(eve, slug);
  let reads = 0;
  await eve.page.route(`**/api/duels/${slug}`, route => {
    reads++;
    return route.fulfill({ status: 503, body: "web restarting" });
  });
  await eve.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => reads).toBeGreaterThanOrEqual(3);
  // SPA navigation unmounts the room while the browser stays alive.
  eve.page.once("dialog", dialog => dialog.accept());
  await eve.page.getByRole("link", { name: "Dueling Domain", exact: true }).click();
  await expect(eve.page).toHaveURL(/\/duels$/);
  const stoppedAt = reads;
  await eve.page.waitForTimeout(4000); // Observe beyond the longest retry delay.
  expect(reads).toBe(stoppedAt);
});

test("an aborted accepted response body retries and never installs an empty room", async ({ player }) => {
  const alice = await player("p1"), bob = await player("p2");
  const { slug } = await startDuel(alice, bob, "aborted-body",
    { main: withFiller([FILLER], 14) }, { main: withFiller([FILLER], 14) });
  await useCard(alice.page, handCard(alice.page, FILLER), "Normal Summon");
  await alice.page.evaluate(() => {
    const json = Response.prototype.json;
    let aborted = false;
    Response.prototype.json = function () {
      if (!aborted && this.url.endsWith("/actions")) {
        aborted = true;
        return Promise.reject(new DOMException("Body read aborted", "AbortError"));
      }
      return json.call(this);
    };
  });
  const commands: DuelCommand[] = [];
  await alice.page.route(`**/api/duels/${slug}/actions`, route => {
    commands.push(route.request().postDataJSON() as DuelCommand);
    return route.continue();
  });
  await pickLegalZone(alice.page, "mz");
  await expect.poll(() => commands.length).toBe(2);
  await expect(alice.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]')).toHaveCount(1);
  expect(commands[1]).toEqual(commands[0]);
  expect(acceptedCount(slug, commands[0]!)).toBe(1);
  await expect(alice.page.getByRole("main").getByRole("alert")).toHaveCount(0);
});

test("an action held beyond thirty seconds completes without a client timeout", async ({ player }) => {
  const alice = await player("p1"), bob = await player("p2");
  const { slug } = await startDuel(alice, bob, "held-action",
    { main: withFiller([FILLER], 14) }, { main: withFiller([FILLER], 14) });
  await useCard(alice.page, handCard(alice.page, FILLER), "Normal Summon");
  let attempts = 0;
  await alice.page.route(`**/api/duels/${slug}/actions`, async route => {
    attempts++;
    await new Promise(resolve => setTimeout(resolve, 31_000)); // Caddy hold plus engine work.
    await route.continue();
  });
  await pickLegalZone(alice.page, "mz");
  await expect(alice.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]')).toHaveCount(1, { timeout: 40_000 });
  expect(attempts).toBe(1);
  await expect(alice.page.getByRole("main").getByRole("alert")).toHaveCount(0);
});

test("an action timeout re-fetches the accepted state instead of showing an error", async ({ player }) => {
  const alice = await player("p1"), bob = await player("p2");
  const { slug } = await startDuel(alice, bob, "action-timeout-state",
    { main: withFiller([FILLER], 14) }, { main: withFiller([FILLER], 14) });
  await useCard(alice.page, handCard(alice.page, FILLER), "Normal Summon");
  // Simulate expiry after the real POST commits, without waiting a minute.
  await alice.page.evaluate(slug => {
    let pendingTimeout: AbortController | undefined;
    let timedOut = false;
    document.documentElement.dataset.timeoutRecoveryReads = "0";
    const timeout = AbortSignal.timeout;
    AbortSignal.timeout = ms => {
      if (ms === 60_000) {
        pendingTimeout = new AbortController();
        return pendingTimeout.signal;
      }
      return timeout(ms);
    };
    const fetch = window.fetch;
    window.fetch = async (...args) => {
      const attemptTimeout = pendingTimeout;
      if (timedOut && String(args[0]) === `/api/duels/${slug}`) {
        document.documentElement.dataset.timeoutRecoveryReads = String(
          Number(document.documentElement.dataset.timeoutRecoveryReads) + 1,
        );
      }
      const response = await fetch(...args);
      if (String(args[0]).endsWith("/actions")) {
        timedOut = true;
        attemptTimeout?.abort(new DOMException("Request timed out", "TimeoutError"));
        args[1]?.signal?.throwIfAborted();
      }
      return response;
    };
  }, slug);
  await pickLegalZone(alice.page, "mz");
  await expect(alice.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]')).toHaveCount(1);
  await expect.poll(() => alice.page.evaluate(() => Number(document.documentElement.dataset.timeoutRecoveryReads))).toBeGreaterThan(0);
  await expect(alice.page.getByRole("main").getByRole("alert")).toHaveCount(0);
});

test("retry exhaustion shows the existing error and the room recovers without reloading", async ({ player }) => {
  const alice = await player("p1"), bob = await player("p2");
  const { slug } = await startDuel(alice, bob, "retry-budget",
    { main: withFiller([FILLER], 14) }, { main: withFiller([FILLER], 14) });
  await useCard(alice.page, handCard(alice.page, FILLER), "Normal Summon");
  let attempts = 0;
  const started = Date.now();
  await alice.page.route(`**/api/duels/${slug}/actions`, async route => {
    attempts++;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "web still restarting" }) });
  });
  await pickLegalZone(alice.page, "mz");
  await expect(alice.page.getByRole("main").getByRole("alert").filter({ hasText: "web still restarting" })).toBeVisible({ timeout: 40_000 });
  expect(Date.now() - started).toBeGreaterThanOrEqual(29_000);
  expect(Date.now() - started).toBeLessThan(40_000);
  const finalAttempts = attempts;
  await alice.page.unroute(`**/api/duels/${slug}/actions`);
  await pickLegalZone(alice.page, "mz");
  await expect(alice.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]')).toHaveCount(1);
  expect(finalAttempts).toBeGreaterThan(3);
});

test("socket credentials and state recover when web returns during a reconnect", async ({ player }) => {
  const alice = await player("p1"), bob = await player("p2");
  await alice.page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    const sockets: WebSocket[] = [];
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
      }
    };
    Object.assign(window, { disconnectDuelSockets: () => sockets.splice(0).forEach(socket => socket.close()) });
  });
  const { slug } = await startDuel(alice, bob, "socket-recovery",
    { main: withFiller([FILLER], 14) }, { main: withFiller([FILLER], 14) });
  const live = alice.page.getByRole("status").filter({ hasText: "Live duel" });
  await expect(live).toBeVisible();
  let navigations = 0, credentials = 0;
  alice.page.on("framenavigated", frame => { if (frame === alice.page.mainFrame()) navigations++; });
  await alice.page.route(`**/api/duels/${slug}/connection`, async route => {
    if (++credentials <= 2) return route.fulfill({ status: 503, body: "web restarting" });
    return route.continue();
  });
  await alice.context.setOffline(true);
  // Offline emulation can leave existing sockets open until their heartbeat.
  await alice.page.evaluate(() => {
    const disconnect = Reflect.get(window, "disconnectDuelSockets");
    if (typeof disconnect !== "function") throw new Error("Socket outage hook was not installed");
    disconnect();
  });
  await expect(live).toHaveCount(0);
  await alice.context.setOffline(false);
  await expect.poll(() => credentials, { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
  await expect(live).toBeVisible();
  expect(navigations).toBe(0);
  await useCard(alice.page, handCard(alice.page, FILLER), "Normal Summon");
  await pickLegalZone(alice.page, "mz");
  await expect(alice.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]')).toHaveCount(1);
});

for (const { status, code } of [
  ...[200, 400, 401, 403, 409].map(status => ({ status, code: undefined })),
  { status: 503, code: "ACCESS_UNAVAILABLE" },
  { status: 503, code: "DUEL_ENGINE_CONFIG" },
  { status: 502, code: "DUEL_ENGINE_ERROR" },
  { status: 503, code: "DUEL_ENGINE_ERROR" },
  { status: 504, code: "DUEL_ENGINE_ERROR" },
]) {
  test(`a rejected action (${status}/${code ?? "no code"}) is not retried`, async ({ player }) => {
    const alice = await player("p1"), bob = await player("p2");
    const { slug } = await startDuel(alice, bob, "retry-rejection",
      { main: withFiller([FILLER], 14) }, { main: withFiller([FILLER], 14) });
    await useCard(alice.page, handCard(alice.page, FILLER), "Normal Summon");
    let attempts = 0;
    await alice.page.route(`**/api/duels/${slug}/actions`, async route => {
      attempts++;
      if (status === 200) return route.fulfill({ status, body: "invalid successful response" });
      return route.fulfill({ status, contentType: "application/json", body: JSON.stringify({
        error: "Action refused", ...(code ? { code } : {}),
      }) });
    });
    await pickLegalZone(alice.page, "mz");
    const message = status === 200 ? "The server returned an invalid response" : "Action refused";
    await expect(alice.page.getByRole("main").getByRole("alert").filter({ hasText: message })).toBeVisible();
    expect(attempts).toBe(1);
  });
}
