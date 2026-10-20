import Database from "better-sqlite3";
import type { DuelReplayV2 } from "@yugidraft/shared/duels";
import { test, expect } from "@playwright/test";
import { authFile } from "../helpers/players";
import { createReplayFixture } from "../helpers/replay";
import { dbPath } from "../stack/env.mjs";
import { compressStoredSnapshot, STORED_BOARD_COLUMNS, type StoredDuelBoards } from "@yugidraft/shared/services";

// Encrypted owner cursors use a fresh nonce on each response.
function replayContent(replay: DuelReplayV2) {
  return { ...replay, frames: replay.frames.map(({ cursor: _cursor, ...frame }) => frame) };
}

test("compressed replays keep private seats, owner access, and identity fallback", async ({ browser }) => {
  const fixture = await createReplayFixture("ffa3", 12, "private");
  const own = await browser.newContext({ storageState: authFile("p1"), reducedMotion: "reduce" });
  const watcher = await browser.newContext({ storageState: authFile("p5") });
  const url = `/api/duels/${fixture.slug}/replay?version=2&visibility=mine`;
  try {
    const compressed = await own.request.get(url, { headers: { "accept-encoding": "gzip" } });
    expect(compressed.status()).toBe(200);
    expect(compressed.headers()["content-encoding"]).toBe("gzip");
    expect(compressed.headers()["cache-control"]).toBe("private, no-store");
    expect(compressed.headers().vary).toContain("Accept-Encoding");
    const replay = await compressed.json();
    expect(replay.verification).toBe("verified");
    const opening = replay.frames[0].view;
    expect(opening.seats[0].hand.some((card: any) => card?.code)).toBe(true);
    expect(opening.seats.slice(1).every((seat: any) => seat.hand.every((card: any) => !card?.code))).toBe(true);
    for (const encoding of ["identity", "gzip;q=0"]) {
      const identity = await own.request.get(url, { headers: { "accept-encoding": encoding } });
      expect(identity.headers()["content-encoding"]).toBeUndefined();
      expect(replayContent(await identity.json())).toEqual(replayContent(replay));
    }
    const other = await browser.newContext({ storageState: authFile("p2") });
    try {
      const ownOther = await (await other.request.get(url)).json();
      expect(ownOther.dataSeat).toBe(1);
      expect(ownOther.frames[0].view.seats[1].hand.some((card: any) => card?.code)).toBe(true);
      expect(ownOther.frames[0].view.seats[0].hand.every((card: any) => !card?.code)).toBe(true);
    } finally { await other.close(); }
    expect((await watcher.request.get(url)).status()).toBe(403);
    expect((await watcher.request.get(`/api/admin/duels/${fixture.slug}/replay?version=2&reveal=1`)).status()).toBe(404);
    const publicView = await own.request.get(url.replace("mine", "public"));
    expect((await publicView.json()).frames[0].view.seats.every((seat: any) => seat.hand.every((card: any) => !card?.code))).toBe(true);
    // Exercise the same cached replay after final snapshot gzip/legacy-column compaction.
    const db = new Database(dbPath);
    try {
      const row = db.prepare(`select ${STORED_BOARD_COLUMNS} from duels where web_slug=?`).get(fixture.slug) as StoredDuelBoards;
      const compacted = await Promise.all(Object.values(row).map(raw => compressStoredSnapshot(raw)));
      db.prepare("update duels set snapshot_public_json=?,snapshot_seat0_json=?,snapshot_seat1_json=?,snapshot_seats_json=? where web_slug=?")
        .run(...compacted, fixture.slug);
    } finally { db.close(); }
    expect(replayContent(await (await own.request.get(url)).json())).toEqual(replayContent(replay));
    if (process.env.E2E_OWNER_USER_IDS?.split(",").includes("101")) {
      const admin = await own.request.get(`/api/admin/duels/${fixture.slug}/replay?version=2&visibility=mine&seat=2&reveal=1`);
      expect(admin.status()).toBe(200);
      expect(admin.headers()["content-encoding"]).toBe("gzip");
      const data = await admin.json();
      expect(data.capabilities.canFork).toBe(true);
      expect(data.frames[0].view.seats.every((seat: any) => seat.hand.some((card: any) => card?.code))).toBe(true);
    }
    if (process.env.E2E_OWNER_USER_IDS?.split(",").includes("104")) {
      const unseated = await browser.newContext({ storageState: authFile("p4") });
      try {
        const response = await unseated.request.get(`/api/admin/duels/${fixture.slug}/replay?version=2&visibility=public&seat=2&reveal=1`);
        expect(response.status()).toBe(200);
        const data = await response.json();
        expect(data.mySeat).toBeNull();
        expect(data.capabilities.canFork).toBe(true);
        expect(data.frames[0].view.seats.every((seat: any) => seat.hand.some((card: any) => card?.code))).toBe(true);
      } finally { await unseated.close(); }
    }
  } finally { await own.close(); await watcher.close(); }
});

test("healthy replay defers field geometry and seeking still shows damage", async ({ browser }) => {
  const fixture = await createReplayFixture("1v1", 40, "public", true);
  const context = await browser.newContext({ storageState: authFile("p1"), reducedMotion: "reduce" });
  try {
    const page = await context.newPage();
    await page.goto(`/duels/${fixture.slug}/replay`);
    await expect(page.getByRole("group", { name: "Replay controls" })).toBeVisible();
    const healthy = page.locator('[data-field-cracks][data-stage="0"]');
    await expect(healthy).toHaveCount(2);
    expect(await healthy.evaluateAll(nodes => nodes.every(node => !(node as HTMLElement).style.getPropertyValue("--u")))).toBe(true);
    await page.getByRole("button", { name: "Last move", exact: true }).click();
    await expect(page.locator('[data-field-cracks]:not([data-stage="0"]) svg').first()).toBeVisible();
    await page.getByRole("button", { name: "First move", exact: true }).click();
    await expect(healthy).toHaveCount(2);
    await expect.poll(() => healthy.evaluateAll(nodes => nodes.every(node => !(node as HTMLElement).style.getPropertyValue("--u")))).toBe(true);
    await expect(healthy.locator("svg")).toHaveCount(0);
  } finally { await context.close(); }
});

test("three-seat replay keeps the fly camera when seeking", async ({ browser }) => {
  const fixture = await createReplayFixture("ffa3", 12);
  const context = await browser.newContext({ storageState: authFile("p1"), reducedMotion: "reduce" });
  try {
    const page = await context.newPage();
    await page.goto(`/duels/${fixture.slug}/replay`);
    await expect(page.getByRole("group", { name: "Replay controls" })).toBeVisible();
    const stage = page.locator('[data-table-stage="ffa3"]');
    await expect(stage).toHaveAttribute("data-ready", "true");
    await expect(stage.locator("[data-seat-slot]")).toHaveCount(3);
    await stage.focus();
    await page.keyboard.press("0");
    await expect(stage).toHaveAttribute("data-camera-mode", "fly");
    const world = stage.locator("[data-world]");
    await expect.poll(() => world.evaluate(node => (node as HTMLElement).style.transform)).not.toBe("");
    const overview = await world.evaluate(node => (node as HTMLElement).style.transform);
    await page.keyboard.press("2");
    await expect.poll(() => world.evaluate(node => (node as HTMLElement).style.transform)).not.toBe(overview);
    const pose = await world.evaluate(node => (node as HTMLElement).style.transform);
    const ring = stage.locator("[data-turn-ring]");
    const rotation = await ring.evaluate(node => (node as HTMLElement).style.getPropertyValue("--ry"));
    expect(rotation).not.toBe("");
    await page.getByRole("button", { name: "Next move", exact: true }).click();
    await expect(stage).toHaveAttribute("data-camera-mode", "fly");
    await expect.poll(() => world.evaluate(node => (node as HTMLElement).style.transform)).toBe(pose);
    await expect.poll(() => ring.evaluate(node => (node as HTMLElement).style.getPropertyValue("--ry"))).toBe(rotation);
    await expect(stage.locator("[data-seat-slot]")).toHaveCount(3);
  } finally { await context.close(); }
});
