import { expect, test, type Page } from "@playwright/test";
import { authenticatePlayer } from "../stack/login-auth.mjs";
import { startTwoPlayerTable } from "./remote-table";
import { pickSelect } from "../helpers/themed-select";

const SHOTS = process.env.E2E_SHOTS ?? "";
const shot = async (page: Page, name: string) => { if (SHOTS) { await page.waitForTimeout(450); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };

test("empty zone menu on the opponent's field, and the follow-up chip after a card is played", async ({ browser }) => {
  test.setTimeout(300_000);
  const url = process.env.E2E_REMOTE_UI_URL!;
  const alice = await browser.newContext({ baseURL: url }); const bob = await browser.newContext({ baseURL: url });
  try {
    for (const [who, userId] of [[alice, 101], [bob, 102]] as const) {
      await authenticatePlayer(who.request, { userId }, process.env.E2E_AUTH_SECRET!, url);
      await who.addInitScript(() => { if (localStorage.getItem("dd-remote-webcam-only") === null) localStorage.setItem("dd-remote-webcam-only", "0"); });
    }
    const slug = await startTwoPlayerTable(alice.request, bob.request), path = `/api/remote/${slug}`;
    const a = await alice.newPage();
    await expect(async () => { await a.goto(`/duels/remote/${slug}`); await expect(a.getByTestId("rail")).toBeVisible({ timeout: 15_000 }); }).toPass({ timeout: 150_000 });
    const act = async (action: Record<string, unknown>) => {
      const room = await (await alice.request.get(path)).json();
      const response = await alice.request.post(`${path}/actions`, { data: { baseSeq: room.lastSeq, action: { idempotencyKey: crypto.randomUUID(), ...action } } });
      expect(response.status(), await response.text()).toBe(200);
    };
    const seatTwin = async (seat: number) => ((await (await alice.request.get(path)).json()).state.seats[seat].twin as { name?: string; zone: string; slot?: number; token?: unknown }[]);

    // The dev server compiles a route on its first request, which can pass the page's 10 second limit: compile the card lookup first.
    await alice.request.post("/api/cards/resolve", { data: { fuzzyName: "Gameciel", includeExtra: true }, timeout: 120_000 });
    // 1. An empty Monster Zone on the opponent's field: Add token here + Give a card from my hand here.
    await shot(a, "1-table");
    await a.locator('[data-zone="m2"][data-seat="1"]').first().click();
    await expect(a.getByTestId("zone-token")).toHaveText("Add token here");
    await expect(a.getByTestId("zone-give-hand")).toBeVisible();
    await shot(a, "2-menu");
    await a.getByTestId("zone-give-hand").click();
    await a.getByTestId("give-search").fill("Gameciel");
    await a.getByTestId("give-pick").first().click();
    await shot(a, "3-give-dialog");
    await expect(a.getByTestId("give-choose-zone")).toHaveText("Give here");
    await a.getByTestId("give-choose-zone").click();
    // The card lands in that zone at once: no second pick.
    await expect.poll(async () => (await seatTwin(1)).filter(c => c.zone === "monster" && c.slot === 2).map(c => c.name)).toEqual(["Gameciel, the Sea Turtle Kaiju"]);
    await shot(a, "4-given");

    // 2. Dandylion played: one chip with the usual next step. A click starts the placing mode, nothing is sent by itself.
    await act({ type: "twin.place", actorSeat: 0, seat: 0, zone: "monster", card: { ref: "dl", cardId: 15341821, name: "Dandylion", slot: 1, faceUp: true, position: "attack" } });
    const chip = a.getByTestId("next-step");
    await expect(chip).toContainText("Add 2 Fluff Tokens");
    await shot(a, "5-chip-tokens");
    expect((await seatTwin(0)).filter(c => c.token)).toHaveLength(0);
    await a.getByTestId("next-step-go").click();
    await expect(a.getByTestId("token-bar")).toBeVisible();
    await expect(chip).toHaveCount(0);
    await shot(a, "6-placing");
    await a.keyboard.press("Escape");

    // 3. A Kaiju played from my hand onto my field: the chip offers it to the opponent; Esc dismisses it.
    await act({ type: "twin.place", actorSeat: 0, seat: 0, zone: "monster", card: { ref: "gm", cardId: 55063751, name: "Gameciel, the Sea Turtle Kaiju", slot: 3, faceUp: true, position: "attack" } });
    await expect(chip).toContainText("Place on opponent's field");
    await shot(a, "7-chip-give");
    await a.keyboard.press("Escape");
    await expect(chip).toHaveCount(0);
    // A chip also leaves by itself after a few seconds.
    await a.waitForTimeout(4500);
    if (SHOTS) await a.setViewportSize({ width: 360, height: 740 });
    await act({ type: "twin.place", actorSeat: 0, seat: 0, zone: "monster", card: { ref: "dl2", cardId: 15341821, name: "Dandylion", slot: 4, faceUp: true, position: "attack" } });
    await expect(chip).toBeVisible(); await shot(a, "8-chip-360");
    expect(await chip.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; })).toBe(true);
    await expect(chip).toHaveCount(0, { timeout: 8000 });
    if (SHOTS) { const zone = a.locator('[data-zone="m4"][data-seat="1"]').first(); await zone.scrollIntoViewIfNeeded(); await shot(a, "9-scrolled-360"); await zone.click({ timeout: 5000 }).catch(() => undefined); await shot(a, "9-menu-360"); }
  } finally { await alice.close(); await bob.close(); }
});

test("Roll your own dice: the host sets it in the lobby, no dice screen, a player says I go second and the other seat starts, Change works until the first turn action", async ({ browser }) => {
  test.setTimeout(300_000);
  const url = process.env.E2E_REMOTE_UI_URL!;
  const alice = await browser.newContext({ baseURL: url }); const bob = await browser.newContext({ baseURL: url });
  try {
    for (const [who, userId] of [[alice, 101], [bob, 102]] as const) {
      await authenticatePlayer(who.request, { userId }, process.env.E2E_AUTH_SECRET!, url);
      await who.addInitScript(() => { if (localStorage.getItem("dd-remote-webcam-only") === null) localStorage.setItem("dd-remote-webcam-only", "0"); });
    }
    const created = await alice.request.post("/api/remote", { data: { gameId: "ygo", seatCount: 2 } });
    expect(created.status(), await created.text()).toBe(201);
    const slug = (await created.json()).slug as string, path = `/api/remote/${slug}`;
    expect((await bob.request.post(`${path}/seat`, { data: { seat: 1 } })).ok()).toBe(true);
    const a = await alice.newPage(); const b = await bob.newPage();
    // The host sets "Roll your own dice" in the lobby; the other player sees it read-only.
    await a.goto(`/duels/remote/${slug}`); await b.goto(`/duels/remote/${slug}`);
    await pickSelect(a, "Who goes first", { value: "own" });
    await a.getByTestId("apply-rules").click();
    await expect(b.getByTestId("room-first-player-chip")).toBeVisible();
    await expect(b.getByRole("combobox", { name: "Who goes first", exact: true })).toBeDisabled();
    for (const api of [alice.request, bob.request]) {
      const decks = (await (await api.get("/api/decks")).json()).decks as { id: number }[];
      expect((await api.post(`${path}/deck`, { data: { savedDeckId: decks[0]!.id } })).ok()).toBe(true);
      expect((await api.post(`${path}/ready`, { data: { ready: true } })).ok()).toBe(true);
    }
    expect((await alice.request.post(`${path}/start`, { data: {} })).ok()).toBe(true);
    const room = async () => (await (await alice.request.get(path)).json());
    // No dice were rolled and nobody has the turn yet. The webcams are not covered.
    const started = await room();
    expect(started.state.match.opening).toBeUndefined();
    expect(started.state.match.ownFirst).toEqual({});
    for (const page of [a, b]) {
      await expect(async () => { await page.goto(`/duels/remote/${slug}`); await expect(page.getByTestId("first-pick")).toBeVisible({ timeout: 15_000 }); }).toPass({ timeout: 150_000 });
      await expect(page.getByTestId("remote-opening-roll")).toHaveCount(0);
      await expect(page.getByTestId("surrender-button")).toBeVisible();
    }
    await expect(b.getByTestId("first-pick")).toContainText("Roll your dice on camera");
    // A click on the strip sends match.first. The page retries it when a camera write moved the table first.
    const say = async (page: Page, button: string, seat: number) => {
      await page.getByTestId(button).click();
      await expect.poll(async () => (await room()).state.match.ownFirst?.chosenSeat).toBe(seat);
      expect((await room()).state.turnSeat).toBe(seat);
    };
    // Bob says "I go second": Alice (seat 0) starts, and both see who goes first.
    await say(b, "first-second", 0);
    for (const page of [a, b]) await expect(page.getByTestId("first-chosen")).toContainText("E2E Alice goes first");
    // Change: Bob goes first instead. Then Alice changes it back.
    await b.getByTestId("first-change").click();
    await say(b, "first-me", 1);
    await expect(a.getByTestId("first-chosen")).toContainText("E2E Bob goes first");
    await a.getByTestId("first-change").click();
    await say(a, "first-me", 0);
    // The first turn action locks the choice: the strip goes and the server refuses a change.
    const advance = await alice.request.post(`${path}/actions`, { data: { baseSeq: (await room()).lastSeq, action: { idempotencyKey: crypto.randomUUID(), type: "phase.advance", actorSeat: 0 } } });
    expect(advance.status(), await advance.text()).toBe(200);
    for (const page of [a, b]) await expect(page.getByTestId("first-pick")).toHaveCount(0);
    const late = await bob.request.post(`${path}/actions`, { data: { baseSeq: (await room()).lastSeq, action: { idempotencyKey: crypto.randomUUID(), type: "match.first", actorSeat: 1, seatGoesFirst: 1 } } });
    expect(late.status()).toBe(409);
    expect((await room()).state.turnSeat).toBe(0);
  } finally { await alice.close(); await bob.close(); }
});
