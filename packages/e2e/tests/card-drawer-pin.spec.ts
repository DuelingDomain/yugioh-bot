import type { Page } from "@playwright/test";
import { test, expect, type Seat } from "../helpers/fixtures";
import { attackWithFirstMonster, chainList, endTurn, expectReadyToAct, handCard, pickLegalZone, startDuel, startTable, turnLabel, useCard } from "../helpers/board";
import { FILLER, withFiller } from "../helpers/decks";
import { pickLegalZone as pickTagZone } from "../helpers/tag";

// The card drawer pins a clicked card and keeps it through effects, chains and prompts. A prompt of the viewer must never find the drawer (or its
// "Pinned" handle) on top of its buttons or targets: the drawer steps aside or tucks away, and the pin comes back when the prompt ends.

const KEYS = ["p1", "p2", "p3", "p4"] as const;
const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1366, height: 768 };

const drawer = (page: Page) => page.locator('[data-testid="hover-preview"]');
/** The pinned drawer, in any state. */
const pinnedAny = (page: Page) => page.locator('[data-testid="hover-preview"][data-pinned="true"]');
/** The pinned drawer, on screen. A hidden drawer keeps `data-pinned` while it slides out or tucks away, so a count of `data-pinned` alone proves nothing. */
const pinnedOpen = (page: Page) => page.locator('[data-testid="hover-preview"][data-pinned="true"][data-open="true"]');
const handle = (page: Page) => page.getByTestId("hover-preview-handle");

/**
 * The controls of the viewer that lie under the drawer or its handle. `selector` picks the controls: the answer buttons of a panel, or the legal
 * zones. A control counts when the element at its center is inside the drawer (or is the handle).
 */
async function coveredControls(page: Page, selector: string): Promise<{ checked: number; covered: string[] }> {
  return page.evaluate((query) => {
    const covered: string[] = [];
    let checked = 0;
    for (const el of document.querySelectorAll<HTMLElement>(query)) {
      const target = el.matches("button") ? el : (el.querySelector<HTMLElement>("button") ?? el);
      const rect = target.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      checked += 1;
      const top = document.elementFromPoint(x, y);
      if (top?.closest('[data-testid="hover-preview"], [data-testid="hover-preview-handle"]')) {
        covered.push(`${(target.textContent ?? target.getAttribute("aria-label") ?? el.getAttribute("data-kind") ?? "").trim().slice(0, 30)}@${Math.round(x)},${Math.round(y)}`);
      }
    }
    return { checked, covered };
  }, selector);
}

const LEGAL_ZONES = '[data-legal="true"][data-occupied="false"]';
const PANEL_BUTTONS = "[data-prompt-panel] button, [data-prompt-surface] button";

/** Waits until the drawer stops changing, so a check does not run in the middle of its slide. */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(900);
}

test("phone: a pinned card tucks away for a chain window, and every answer button stays reachable", async ({ player }) => {
  test.setTimeout(300_000);
  const alice = await player("p1");
  const bob = await player("p2");
  await startDuel(alice, bob, "pin phone chain",
    { main: withFiller(["Reinforcement of the Army", "Pot of Greed", FILLER, FILLER, FILLER, "Celtic Guardian"]) },
    { main: withFiller(["Ash Blossom & Joyous Spring", "Mirror Force", "Celtic Guardian"]) });
  const a = alice.page;
  const b = bob.page;
  await a.setViewportSize(PHONE);
  await b.setViewportSize(PHONE);
  await expectReadyToAct(a);

  // Alice pins a monster and starts a Normal Summon: the zone prompt keeps its zones clear of the drawer.
  await handCard(a, FILLER).click();
  await expect(a.getByRole("menu")).toBeVisible();
  await expect(pinnedOpen(a)).toHaveCount(1);
  await a.getByRole("menu").getByRole("menuitem", { name: /^Normal Summon/ }).click();
  await expect(a.getByRole("group", { name: /^Select a zone/ })).toBeVisible();
  await settle(a);
  const zones = await coveredControls(a, LEGAL_ZONES);
  expect(zones.checked, "legal zones found").toBeGreaterThan(0);
  expect(zones.covered, "zones under the drawer").toEqual([]);
  await expect(drawer(a)).toHaveAttribute("data-open", "false");
  await expect(handle(a)).toBeVisible();
  await expect(handle(a)).toContainText(`Pinned: ${FILLER}`);
  await pickLegalZone(a, "mz");
  // The prompt is over: the pin comes back, and the handle goes.
  await expect(pinnedOpen(a)).toHaveCount(1);
  await expect(handle(a)).toHaveCount(0);

  // Bob pins his Mirror Force; Alice activates Reinforcement; Bob gets the hand-trap window with the pin tucked away.
  await handCard(b, "Mirror Force").click();
  await expect(pinnedOpen(b)).toHaveCount(1);
  await handCard(a, "Reinforcement of the Army").click();
  await a.getByRole("menu").getByRole("menuitem", { name: /^Activate/ }).click();
  await pickLegalZone(a, "st");
  const ash = b.getByRole("group", { name: /^Activate its effect\? Ash Blossom/ });
  await expect(ash).toBeVisible();
  await settle(b);
  await expect(drawer(b)).toHaveAttribute("data-open", "false");
  const buttons = await coveredControls(b, PANEL_BUTTONS);
  expect(buttons.checked, "answer buttons found").toBeGreaterThan(0);
  expect(buttons.covered, "answer buttons under the drawer or the handle").toEqual([]);
  await expect(handle(b)).toBeVisible();
  // The handle shows the pin on request, and hides it again.
  await handle(b).click();
  await expect(pinnedOpen(b)).toHaveCount(1);
  await handle(b).click();
  await expect(pinnedOpen(b)).toHaveCount(0);

  // Bob answers: the chain window ends, the pin stays and shows again.
  await ash.getByRole("button", { name: "No", exact: true }).click();
  await expect(chainList(a)).toHaveCount(0);
  await expect(pinnedOpen(b)).toHaveCount(1);
  await expect(handle(b)).toHaveCount(0);
});

test("FFA4 at 1366x768: a Normal Summon pick leaves the zones clear, and the handle keeps the tucked pin one click away", async ({ player }) => {
  test.setTimeout(300_000);
  const seats: Seat[] = await Promise.all(KEYS.map((key) => player(key)));
  await startTable(seats, "pin ffa4 pick", Array.from({ length: 4 }, () => ({ main: withFiller([FILLER], 14) })));
  const page = seats[0]!.page;
  await page.setViewportSize(LAPTOP);
  await page.waitForTimeout(800);
  await handCard(page, FILLER).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(pinnedOpen(page)).toHaveCount(1);
  await page.getByRole("menu").getByRole("menuitem", { name: /^Normal Summon/ }).click();
  await expect(page.getByRole("group", { name: /^Select a zone/ })).toBeVisible();
  await settle(page);
  const zones = await coveredControls(page, LEGAL_ZONES);
  expect(zones.checked, "legal zones found").toBeGreaterThan(0);
  expect(zones.covered, "zones under the drawer").toEqual([]);
  const tucked = (await drawer(page).getAttribute("data-open")) === "false";
  // The handle shows exactly while the pin is tucked, and it covers no zone and no bar of the prompt.
  await expect(handle(page)).toHaveCount(tucked ? 1 : 0);
  if (tucked) {
    await expect(handle(page)).toContainText(`Pinned: ${FILLER}`);
    const box = await handle(page).boundingBox();
    expect(box).not.toBeNull();
    const clash = await page.evaluate((spot) => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('[data-legal="true"], [data-prompt-panel], [data-prompt-surface]')) {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        if (r.left < spot.x + spot.width && spot.x < r.right && r.top < spot.y + spot.height && spot.y < r.bottom) out.push(el.getAttribute("data-kind") ?? el.tagName);
      }
      return out;
    }, box!);
    expect(clash, "boxes under the handle").toEqual([]);
  }
  await pickLegalZone(page, "mz");
  await expect(pinnedOpen(page)).toHaveCount(1);
  await expect(handle(page)).toHaveCount(0);
});

test("a hover on a target shows that card over the pin, and the pin returns afterwards", async ({ player }) => {
  test.setTimeout(300_000);
  const alice = await player("p1");
  const bob = await player("p2");
  await startDuel(alice, bob, "pin hover target",
    { main: withFiller(["Mystical Space Typhoon", "Pot of Greed", "Mirror Force", FILLER, FILLER, "Celtic Guardian"]) },
    { main: withFiller(["Celtic Guardian"]) });
  const a = alice.page;
  await a.setViewportSize(LAPTOP);
  await expectReadyToAct(a);
  // Set two cards, then pin the Typhoon and start it: its targets are the two set cards, and the owner can read both.
  for (const name of ["Pot of Greed", "Mirror Force"]) {
    await expectReadyToAct(a);
    await handCard(a, name).click();
    await a.getByRole("menu").getByRole("menuitem", { name: /^Set/ }).click();
    await pickLegalZone(a, "st");
    await expect(a.locator('[data-kind="st"][data-side="you"][data-occupied="true"]')).toHaveCount(name === "Pot of Greed" ? 1 : 2);
  }
  await expectReadyToAct(a);
  await handCard(a, "Mystical Space Typhoon").click();
  await expect(pinnedOpen(a)).toContainText("Mystical Space Typhoon");
  await a.getByRole("menu").getByRole("menuitem", { name: /^Activate/ }).click();
  await pickLegalZone(a, "st");
  const targets = a.locator('[data-kind="st"][data-side="you"][data-legal="true"][data-occupied="true"]');
  await expect(targets).toHaveCount(2);
  await settle(a);
  // The pin is the Typhoon; a hover on a target shows the target.
  await targets.nth(0).locator("button").hover();
  await expect(drawer(a).filter({ hasText: /Pot of Greed|Mirror Force/ }).first()).toHaveAttribute("data-open", "true");
  await expect(drawer(a)).not.toContainText("Mystical Space Typhoon");
  // A hover that moves to the other target switches to that card.
  await targets.nth(1).locator("button").hover();
  await expect(drawer(a).filter({ hasText: /Pot of Greed|Mirror Force/ }).first()).toHaveAttribute("data-open", "true");
  // The pointer leaves the targets: the pin shows again (or stays tucked, with its handle).
  await a.mouse.move(683, 40);
  await a.waitForTimeout(700);
  const back = (await pinnedOpen(a).count()) === 1 ? pinnedOpen(a) : handle(a);
  await expect(back).toContainText("Mystical Space Typhoon");
});

test("FFA4 at 1366x768: the attack aim keeps its rival buttons clear of the pinned card", async ({ player }) => {
  test.setTimeout(420_000);
  const seats: Seat[] = await Promise.all(KEYS.map((key) => player(key)));
  await startTable(seats, "pin ffa4 aim", Array.from({ length: 4 }, () => ({ main: withFiller([FILLER], 14) })));
  const [alice, bob, carol, dave] = seats as [Seat, Seat, Seat, Seat];
  const page = alice.page;
  await page.setViewportSize(LAPTOP);
  await useCard(page, handCard(page, FILLER), "Normal Summon");
  await pickLegalZone(page, "mz");
  await expect(page.locator('[data-seat-field][data-side="you"] [data-kind="mz"][data-occupied="true"]')).toHaveCount(1);
  await endTurn(page, 2);
  await endTurn(bob.page, 3);
  await endTurn(carol.page, 4);
  await endTurn(dave.page, 5);
  await expect(turnLabel(page)).toHaveText("Turn 5");
  // The attacker is pinned by the click that opens its menu; the aim then offers every living rival.
  const rivals = page.locator("[data-opponent-bar='direct'] [data-rival-seat]");
  await attackWithFirstMonster(page);
  await expect(pinnedAny(page)).toHaveCount(1);
  await expect(rivals).toHaveCount(3);
  await settle(page);
  const report = await coveredControls(page, "[data-opponent-bar='direct'] [data-rival-seat]");
  expect(report.checked, "rival buttons found").toBe(3);
  expect(report.covered, "rival buttons under the drawer or the handle").toEqual([]);
  // The pin stays through the aim: it is still there when the aim is cancelled.
  await page.keyboard.press("Escape");
  await expect(rivals).toHaveCount(0);
  await expect(pinnedAny(page)).toHaveCount(1);
});

test("1v1 at 1366x768: the pin closes only by the user, and a Normal Summon pick stays clear of it", async ({ player }) => {
  test.setTimeout(300_000);
  const alice = await player("p1");
  const bob = await player("p2");
  await startDuel(alice, bob, "pin 1v1 close",
    { main: withFiller([FILLER, FILLER, FILLER, FILLER, FILLER, "Celtic Guardian"]) },
    { main: withFiller(["Celtic Guardian"]) });
  const a = alice.page;
  await a.setViewportSize(LAPTOP);
  await expectReadyToAct(a);

  // A pin made by a click on a hand card (the Normal Summon is spent after the first pick, so later clicks open no menu).
  const pin = async () => {
    await handCard(a, FILLER).click();
    await expect(pinnedOpen(a)).toHaveCount(1);
  };
  await pin();
  await expect(a.getByRole("menu")).toBeVisible();
  // Normal Summon pick: zones stay clear of the drawer, and the pin comes back after the pick.
  await a.getByRole("menu").getByRole("menuitem", { name: /^Normal Summon/ }).click();
  await expect(a.getByRole("group", { name: /^Select a zone/ })).toBeVisible();
  await settle(a);
  const zones = await coveredControls(a, LEGAL_ZONES);
  expect(zones.checked, "legal zones found").toBeGreaterThan(0);
  expect(zones.covered, "zones under the drawer").toEqual([]);
  await pickLegalZone(a, "mz");
  await expect(pinnedAny(a)).toHaveCount(1);
  await settle(a);

  // Right-click inside the drawer closes the pin (H1).
  await expect(pinnedOpen(a)).toHaveCount(1);
  await pinnedOpen(a).click({ button: "right", position: { x: 80, y: 200 } });
  await expect(pinnedOpen(a)).toHaveCount(0);
  await expect(handle(a)).toHaveCount(0);

  // The X button closes it.
  await pin();
  await expect(pinnedOpen(a)).toHaveCount(1);
  await a.getByTestId("hover-preview-close").click();
  await expect(pinnedOpen(a)).toHaveCount(0);
  await expect(handle(a)).toHaveCount(0);

  // Escape with no prompt open closes the pin.
  await pin();
  await a.keyboard.press("Escape");
  await expect(pinnedOpen(a)).toHaveCount(0);
  await expect(handle(a)).toHaveCount(0);
});

test("FFA4 at 1366x768: opening and closing the Log flyout keeps the pin", async ({ player }) => {
  test.setTimeout(300_000);
  const seats: Seat[] = await Promise.all(KEYS.map((key) => player(key)));
  await startTable(seats, "pin ffa4 flyout", Array.from({ length: 4 }, () => ({ main: withFiller([FILLER], 14) })));
  const page = seats[0]!.page;
  await page.setViewportSize(LAPTOP);
  await page.waitForTimeout(800);
  await handCard(page, FILLER).click();
  await expect(pinnedOpen(page)).toHaveCount(1);
  const log = page.locator('[data-rail="log"]');
  const flyout = page.locator('[data-rail="log"][aria-expanded="true"]');
  // The tab opens the flyout, the tab closes it: the pin is untouched.
  await log.click();
  await expect(flyout).toBeVisible();
  await settle(page);
  await log.click();
  await expect(flyout).toHaveCount(0);
  await settle(page);
  await expect(pinnedOpen(page)).toHaveCount(1);
  // Escape closes the open flyout first, and only the flyout.
  await log.click();
  await expect(flyout).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(flyout).toHaveCount(0);
  await settle(page);
  await expect(pinnedOpen(page)).toHaveCount(1);
});

test("1v1 at 1366x768: a deck search keeps its card grid clear of the pinned card", async ({ player }) => {
  test.setTimeout(300_000);
  const alice = await player("p1");
  const bob = await player("p2");
  await startDuel(alice, bob, "pin deck search",
    { main: withFiller(["Reinforcement of the Army", FILLER, FILLER, FILLER, FILLER, "Celtic Guardian", "Axe Raider"], 14) },
    { main: withFiller(["Celtic Guardian"]) });
  const a = alice.page;
  await a.setViewportSize(LAPTOP);
  await expectReadyToAct(a);
  await handCard(a, "Reinforcement of the Army").click();
  await expect(pinnedOpen(a)).toContainText("Reinforcement of the Army");
  await a.getByRole("menu").getByRole("menuitem", { name: /^Activate/ }).click();
  await pickLegalZone(a, "st");
  // The search shows the cards of the Deck that can be added (an off-board grid).
  await expect(a.getByRole("group", { name: /^Select the card/ })).toBeVisible();
  await expect(a.locator("[data-card-strip] li")).toHaveCount(2);
  await settle(a);
  const report = await coveredControls(a, "[data-prompt-panel] button, [data-prompt-surface] button, [data-card-strip] button, [data-card-strip] li");
  expect(report.checked, "grid cards and panel buttons found").toBeGreaterThan(1);
  expect(report.covered, "grid cards or buttons under the drawer or the handle").toEqual([]);
  // The pin is kept, tucked or aside, and shows again once the search is answered.
  await expect(pinnedAny(a)).toHaveCount(1);
});

test("1v1 at 1366x768: a Tribute Summon keeps its dock and buttons clear of the pinned card", async ({ player }) => {
  test.setTimeout(300_000);
  const alice = await player("p1");
  const bob = await player("p2");
  await startDuel(alice, bob, "pin tribute",
    { main: withFiller(["Summoned Skull", FILLER, FILLER, FILLER, FILLER, "Celtic Guardian"], 14) },
    { main: withFiller(["Celtic Guardian"]) });
  const a = alice.page;
  await a.setViewportSize(LAPTOP);
  await expectReadyToAct(a);
  await useCard(a, handCard(a, FILLER), "Normal Summon");
  await pickLegalZone(a, "mz");
  await endTurn(a, 2);
  await endTurn(bob.page, 3);
  await expect(turnLabel(a)).toHaveText("Turn 3");
  await expectReadyToAct(a);
  await handCard(a, "Summoned Skull").click();
  await expect(pinnedOpen(a)).toContainText("Summoned Skull");
  await a.getByRole("menu").getByRole("menuitem", { name: /^Normal Summon/ }).click();
  await settle(a);
  await expect(a.getByText("Tribute 1 monster")).toBeVisible();
  const report = await coveredControls(a, "[data-prompt-panel] button, [data-prompt-surface] button, [data-legal='true']");
  expect(report.checked, "dock buttons and legal tributes found").toBeGreaterThan(1);
  expect(report.covered, "dock buttons or tributes under the drawer or the handle").toEqual([]);
  await expect(pinnedAny(a)).toHaveCount(1);
});

// A pinned card and a Normal Summon pick on the big screens: the zones stay hit-testable. With PIN_SHOTS=<dir> the test also saves a screenshot.
for (const format of ["ffa4", "tag"] as const) {
  for (const view of [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
    test(`${format} at ${view.width}x${view.height}: a pinned card and a Normal Summon pick leave every legal zone reachable`, async ({ player }) => {
      test.setTimeout(300_000);
      const seats: Seat[] = await Promise.all(KEYS.map((key) => player(key)));
      const decks = Array.from({ length: 4 }, () => ({ main: withFiller([FILLER], 40) }));
      const { slug } = format === "tag"
        ? await startTable(seats, "pin tag big", decks, { ordered: true, looseDecks: true, noBanlist: true, format: "tag" })
        : await startTable(seats, "pin ffa4 big", decks);
      const page = seats[0]!.page;
      await page.setViewportSize(view);
      await page.waitForTimeout(800);
      await expectReadyToAct(page);
      await handCard(page, FILLER).click();
      await expect(pinnedOpen(page)).toHaveCount(1);
      await page.getByRole("menu").getByRole("menuitem", { name: /^Normal Summon/ }).click();
      await expect(page.getByRole("group", { name: /^Select a zone/ })).toBeVisible();
      await settle(page);
      if (process.env.PIN_SHOTS) await page.screenshot({ path: `${process.env.PIN_SHOTS}/${format}-${view.width}.png` });
      const zones = await coveredControls(page, LEGAL_ZONES);
      expect(zones.checked, "legal zones found").toBeGreaterThan(0);
      expect(zones.covered, "zones under the drawer or the handle").toEqual([]);
      await expect(pinnedAny(page)).toHaveCount(1);
      if (format === "tag") await pickTagZone(page, slug, "mz");
      else await pickLegalZone(page, "mz");
      await expect(pinnedOpen(page)).toHaveCount(1);
    });
  }
}
