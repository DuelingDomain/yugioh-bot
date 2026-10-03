import { test, expect, type Seat } from "../helpers/fixtures";
import { expectReadyToAct, handCard, startTable, useCard } from "../helpers/board";
import { FILLER, withFiller } from "../helpers/decks";
import { collectTableErrors, expectRealCore, readTable, tableShot } from "../helpers/table";
import { expectRooftop, tagField, teamLpPlate, teamLpValue, turnNumber } from "../helpers/tag";
import type { DuelEngineView, DuelEvent } from "@yugidraft/shared/duels";
import type { Page } from "@playwright/test";

// Tag battle rules in real browsers. Seats 0 and 2 are team 0 (p1, p3), seats 1 and 3 are team 1 (p2, p4); turn order 1A, 2A, 1B, 2B.
// The first Battle Phase is turn 4 (seat 3, p4). Team LP is shared: 2 x 8,000 = 16,000.
const TEAM_LP = 16_000;
const options = { ordered: true, looseDecks: true, noBanlist: true, format: "tag" as const };
const normalDeck = () => ({ main: withFiller([FILLER], 40) });
const toBattle = (page: Page) => page.getByRole("button", { name: /^To Battle/ });
const attackLock = (page: Page) => page.getByTestId("tag-attack-lock");
const teamOf = (seat: number) => seat % 2;

async function normalSummon(seat: Seat, slug: string): Promise<void> {
  await useCard(seat.page, handCard(seat.page, FILLER), "Normal Summon");
  await expect.poll(async () => (await readTable(seat.page, slug)).engine!.prompt?.kind).toBe("places");
  await tagField(seat.page, "self").locator('[data-kind="mz"][data-legal="true"][data-occupied="false"] button').first().click();
  await expect(tagField(seat.page, "self").locator('[data-kind="mz"][data-occupied="true"]')).toHaveCount(1);
}

async function endTurn(page: Page, next: number): Promise<void> {
  await expectReadyToAct(page);
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await expect.poll(() => turnNumber(page), { timeout: 60_000 }).toBe(next);
}

const teamLp = (engine: DuelEngineView, team: number): number => engine.seats.find((seat) => teamOf(seat.seat) === team)!.lp;

/** Damage events that hit one team, in log order. */
const teamHits = (events: DuelEvent[], team: number): DuelEvent[] =>
  events.filter((event) => event.kind === "damage" && event.seat != null && teamOf(event.seat) === team && (event.amount ?? 0) > 0);

/**
 * The attacker picks the rival to hit directly. The engine may ask for it (a choice that names rival seats), or may
 * attack at once. The pick goes through the rival chip of the team plate, then a confirm button if the table has one.
 */
async function pickDirectTarget(page: Page, slug: string, attackerSeat: number, targetSeat: number): Promise<void> {
  const outcome = await expect.poll(async () => {
    const engine = (await readTable(page, slug)).engine!;
    if (teamLp(engine, 1 - teamOf(attackerSeat)) < TEAM_LP) return "done";
    const prompt = engine.prompt;
    const asks = prompt && prompt.seat === attackerSeat && prompt.context?.type !== "action" && prompt.options.some((option) => option.controller === targetSeat);
    return asks ? "pick" : "wait";
  }, { timeout: 30_000 }).not.toBe("wait").then(async () => {
    const engine = (await readTable(page, slug)).engine!;
    return teamLp(engine, 1 - teamOf(attackerSeat)) < TEAM_LP ? "done" : "pick";
  });
  if (outcome === "done") return;
  await page.locator(`[data-lp-seat='${targetSeat}'][data-pickable='true']`).click();
  const confirm = page.getByTestId("aim-confirm");
  if (await confirm.waitFor({ state: "visible", timeout: 3_000 }).then(() => true, () => false)) await confirm.click();
}

test.describe("Tag battle", () => {
  // Four live boards can render slowly when other stack slots share headless Chromium resources.
  test.use({ actionTimeout: 60_000, navigationTimeout: 60_000 });

  test("no attack on turns 1-3, a direct attack on turn 4 hits the team LP once", async ({ player }, info) => {
    test.setTimeout(300_000);
    const seats = await Promise.all((["p1", "p2", "p3", "p4"] as const).map((key) => player(key)));
    const [alice, bob, carol, dave] = seats as [Seat, Seat, Seat, Seat];
    await Promise.all(seats.map((seat) => seat.context.addInitScript(() => {
      for (const name of ["AudioContext", "webkitAudioContext"]) Object.defineProperty(window, name, { value: undefined, configurable: true });
    })));
    const errors = collectTableErrors(alice.page, [bob.page, carol.page, dave.page]);
    const { slug } = await startTable(seats, "tag battle", seats.map(normalDeck), options);
    await expectRealCore(alice.page, slug, "practice", info, 0);
    for (const seat of seats) await expectRooftop(seat.page);

    // Turns 1 to 3: the lock marker names turn 4 on every page and the turn player is offered no Battle Phase.
    for (const turn of [1, 2, 3]) {
      const mover = seats[turn - 1]!;
      await expect.poll(() => turnNumber(mover.page), { timeout: 60_000 }).toBe(turn);
      await expectReadyToAct(mover.page);
      for (const seat of seats) {
        await expect(attackLock(seat.page)).toBeVisible();
        await expect(attackLock(seat.page)).toContainText(/turn 4/i);
      }
      await expect(toBattle(mover.page)).toHaveCount(0);
      if (turn === 2) {
        // Even with a monster on the field, turn 2 has no Battle Phase.
        await normalSummon(bob, slug);
        await expect(toBattle(bob.page)).toHaveCount(0);
        await expect(attackLock(bob.page)).toBeVisible();
        await tableShot(bob.page, slug, info, "tag-battle-locked");
      }
      await endTurn(mover.page, turn + 1);
    }

    // Turn 4 (seat 3, p4): the lock is gone and both rivals are open to a direct attack.
    await expect.poll(() => turnNumber(dave.page), { timeout: 60_000 }).toBe(4);
    await expectReadyToAct(dave.page);
    for (const seat of seats) await expect(attackLock(seat.page)).toHaveCount(0);
    await normalSummon(dave, slug);
    for (const seat of seats) {
      expect(await teamLpValue(seat.page, 0)).toBe(TEAM_LP);
      expect(await teamLpValue(seat.page, 1)).toBe(TEAM_LP);
    }
    await tableShot(dave.page, slug, info, "tag-battle-open");
    // The hit equals the attack of p4's only monster, read from the engine view.
    const attacker = (await readTable(dave.page, slug)).engine!.seats[3]!.monsters.find((card) => card != null);
    const attack = attacker?.attack ?? 0;
    expect(attack).toBeGreaterThan(0);

    await expect(toBattle(dave.page)).toBeVisible();
    await toBattle(dave.page).click();
    await expect.poll(async () => (await readTable(dave.page, slug)).engine!.phase).toMatch(/battle/i);
    await expectReadyToAct(dave.page);
    await tagField(dave.page, "self").locator('[data-kind="mz"][data-occupied="true"] button').first().click();
    await dave.page.getByRole("menu").getByRole("menuitem", { name: /Attack/ }).first().click();
    // p4 hits seat 2 (p3), the partner of the first duelist. The team shares one LP total.
    await pickDirectTarget(dave.page, slug, 3, 2);

    for (const seat of seats) {
      await expect.poll(() => teamLpValue(seat.page, 0)).toBe(TEAM_LP - attack);
      expect(await teamLpValue(seat.page, 1)).toBe(TEAM_LP);
    }
    // Both member chips sit on the one hit plate, and the plate shows the loss once.
    for (const seat of seats) {
      const plate = teamLpPlate(seat.page, 0);
      await expect(plate.locator("[data-lp-seat='0']")).toBeVisible();
      await expect(plate.locator("[data-lp-seat='2']")).toBeVisible();
      await expect(plate.locator("[data-damage-chip]")).toHaveCount(1);
      await expect(plate.locator("[data-damage-chip]")).toContainText(attack.toLocaleString("en-US"));
      await expect(teamLpPlate(seat.page, 1).locator("[data-damage-chip]")).toHaveCount(0);
    }
    const room = await readTable(dave.page, slug);
    expect(room.engine!.seats.filter((seat) => teamOf(seat.seat) === 0).map((seat) => seat.lp)).toEqual([TEAM_LP - attack, TEAM_LP - attack]);
    expect(room.engine!.seats.filter((seat) => teamOf(seat.seat) === 1).map((seat) => seat.lp)).toEqual([TEAM_LP, TEAM_LP]);

    // The retained event log holds exactly one raw damage event for the team: the engine takes team LP once per core message.
    const hits = teamHits(room.engine!.events, 0);
    await info.attach("team-0-damage-events", { body: JSON.stringify(hits, null, 2), contentType: "application/json" });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ amount: attack, cause: "battle" });
    expect(teamHits(room.engine!.events, 1)).toHaveLength(0);
    await tableShot(dave.page, slug, info, "tag-battle-damage");
    expect(errors).toEqual([]);
  });
});
