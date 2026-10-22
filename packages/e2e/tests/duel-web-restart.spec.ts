import Database from "better-sqlite3";
import type { DuelCommand } from "@yugidraft/shared/duels";
import { test, expect } from "../helpers/fixtures";
import { handCard, pickLegalZone, startDuel as startLiveDuel, useCard } from "../helpers/board";
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

test("room reads recover after web returns while the socket remains connected", async ({ player }) => {
  const alice = await player("p1"), bob = await player("p2");
  const { slug } = await startDuel(alice, bob, "read-recovery",
    { main: withFiller([FILLER], 14) }, { main: withFiller([FILLER], 14) });
  let reads = 0;
  await alice.page.route(`**/api/duels/${slug}`, async route => {
    if (++reads <= 3) return route.fulfill({ status: 503, body: "web restarting" });
    return route.continue();
  });
  await alice.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(alice.page.getByRole("status").filter({ hasText: "Reconnecting" })).toBeVisible();
  await expect.poll(() => reads).toBeGreaterThanOrEqual(4);
  await expect(alice.page.getByRole("status").filter({ hasText: "Live duel" })).toBeVisible();
  await useCard(alice.page, handCard(alice.page, FILLER), "Normal Summon");
  await pickLegalZone(alice.page, "mz");
  await expect(alice.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]')).toHaveCount(1);
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
  await expect(live).toHaveCount(0);
  await alice.context.setOffline(false);
  await expect.poll(() => credentials, { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
  await expect(live).toBeVisible();
  expect(navigations).toBe(0);
  await useCard(alice.page, handCard(alice.page, FILLER), "Normal Summon");
  await pickLegalZone(alice.page, "mz");
  await expect(alice.page.locator('[data-kind="mz"][data-side="you"][data-occupied="true"]')).toHaveCount(1);
});

for (const status of [200, 400, 401, 403, 409, 503]) {
  test(`a rejected action (${status}) is not retried`, async ({ player }) => {
    const alice = await player("p1"), bob = await player("p2");
    const { slug } = await startDuel(alice, bob, "retry-rejection",
      { main: withFiller([FILLER], 14) }, { main: withFiller([FILLER], 14) });
    await useCard(alice.page, handCard(alice.page, FILLER), "Normal Summon");
    let attempts = 0;
    await alice.page.route(`**/api/duels/${slug}/actions`, async route => {
      attempts++;
      if (status === 200) return route.fulfill({ status, body: "invalid successful response" });
      return route.fulfill({ status, contentType: "application/json", body: JSON.stringify({
        error: "Action refused", ...(status === 503 ? { code: "ACCESS_UNAVAILABLE" } : {}),
      }) });
    });
    await pickLegalZone(alice.page, "mz");
    const message = status === 200 ? "The server returned an invalid response" : "Action refused";
    await expect(alice.page.getByRole("main").getByRole("alert").filter({ hasText: message })).toBeVisible();
    expect(attempts).toBe(1);
  });
}
