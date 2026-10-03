import { test, expect, type Seat } from "../helpers/fixtures";
import { expectReadyToAct, handCard, startTable, useCard } from "../helpers/board";
import { cardCode } from "../helpers/cards";
import { FILLER, withFiller } from "../helpers/decks";
import { collectTableErrors, expectRealCore, readTable, tableShot } from "../helpers/table";
import { expectRooftop, tagField, tagPriorityChips, teamLpValue, turnNumber } from "../helpers/tag";
import type { DuelRoom } from "@yugidraft/shared/duels";
import type { Page } from "@playwright/test";

// Tag visibility and response order in real browsers. Seats 0 and 2 are team 0 (p1, p3), seats 1 and 3 are team 1 (p2, p4).
// Partners see each other's hand and Set cards (R-TAG-VISIBILITY); the rival team sees neither.
// After a Chain Link the opposing team answers first (R-TAG-RESPONSE).
const options = { ordered: true, looseDecks: true, noBanlist: true, format: "tag" as const };
const teamOf = (seat: number) => seat % 2;
// The opening hand is the first five cards of the main deck (ordered). Every seat holds different cards.
const HANDS: string[][] = [
  ["Pot of Greed", "Mirror Force", "Hinotama", FILLER, FILLER],
  ["Ash Blossom & Joyous Spring", "Gemini Elf", "Mystical Elf", FILLER, FILLER],
  ["Dark Hole", "Heavy Storm", "Sangan", FILLER, FILLER],
  ["Ash Blossom & Joyous Spring", "Battle Ox", "Silver Fang", FILLER, FILLER],
];
const decks = HANDS.map((hand) => ({ main: withFiller(hand, 40) }));
const partnerHand = (page: Page) => page.getByRole("group", { name: /hand \(partner\)/i });
const chainNo = (page: Page) => page.locator("[data-prompt-panel]").getByRole("button", { name: "No", exact: true }).or(page.getByRole("button", { name: "No", exact: true })).first();

async function pickLegalZone(page: Page, slug: string, kind: "mz" | "st"): Promise<void> {
  await expect.poll(async () => (await readTable(page, slug)).engine!.prompt?.kind).toBe("places");
  await tagField(page, "self").locator(`[data-kind="${kind}"][data-legal="true"][data-occupied="false"] button`).first().click();
}

/** Codes of the cards a seat holds in hand, as that seat sees them. */
function handCodes(room: DuelRoom, seat: number): number[] {
  return room.engine!.seats.find((entry) => entry.seat === seat)!.hand.map((card) => card.code).filter((code): code is number => code != null);
}

/**
 * Looks for the codes in the room JSON that the viewer gets (its seated view and the public spectate view).
 * A code in the viewer's own deck or hand is never a leak, so `own` removes those.
 */
async function expectNoLeak(page: Page, slug: string, secret: Iterable<number>, own: Set<number>, label: string): Promise<void> {
  const seated = JSON.stringify(await readTable(page, slug));
  const response = await page.request.get(`/api/duels/${slug}?spectate=1`);
  expect(response.ok(), `${label}: ${response.status()}`).toBe(true);
  const publicJson = await response.text();
  for (const code of secret) {
    if (own.has(code)) continue;
    const pattern = new RegExp(`(?<![0-9])${code}(?![0-9])`);
    expect(pattern.test(seated), `${label}: seated room JSON leaks code ${code}`).toBe(false);
    expect(pattern.test(publicJson), `${label}: public room JSON leaks code ${code}`).toBe(false);
  }
}

test.describe("Tag chain and visibility", () => {
  // Four live boards can render slowly when other stack slots share headless Chromium resources.
  test.use({ actionTimeout: 60_000, navigationTimeout: 60_000 });

  test("partners see hand and Set cards, rivals see none, the opposing team answers first, digits pick a rival", async ({ player }, info) => {
    test.setTimeout(300_000);
    const seats = await Promise.all((["p1", "p2", "p3", "p4"] as const).map((key) => player(key)));
    const [alice, bob, carol, dave] = seats as [Seat, Seat, Seat, Seat];
    await Promise.all(seats.map((seat) => seat.context.addInitScript(() => {
      for (const name of ["AudioContext", "webkitAudioContext"]) Object.defineProperty(window, name, { value: undefined, configurable: true });
    })));
    const errors = collectTableErrors(alice.page, [bob.page, carol.page, dave.page]);
    const { slug } = await startTable(seats, "tag chain", decks, options);
    await expectRealCore(alice.page, slug, "practice", info, 0);
    for (const seat of seats) await expectRooftop(seat.page);
    await expect.poll(() => turnNumber(alice.page)).toBe(1);

    // Turn 1: p1 Sets Mirror Force.
    await expectReadyToAct(alice.page);
    await useCard(alice.page, handCard(alice.page, "Mirror Force"), "Set Spell/Trap");
    await pickLegalZone(alice.page, slug, "st");
    await expect(tagField(alice.page, "self").locator("[data-kind='st'][data-occupied='true']")).toHaveCount(1);

    await test.step("partner sees hand and Set card", async () => {
      // p3 (seat 2) is the partner of p1 (seat 0).
      const room = await readTable(carol.page, slug);
      const seatZero = room.engine!.seats.find((entry) => entry.seat === 0)!;
      expect(seatZero.hand.map((card) => card.name).sort()).toEqual([...HANDS[0]!].sort());
      const set = seatZero.spells.find((card) => card != null);
      expect(set?.code).toBe(cardCode("Mirror Force"));
      await expect(partnerHand(carol.page)).toBeVisible();
      for (const name of ["Pot of Greed", "Mirror Force", "Hinotama"]) {
        // Mirror Force is on the field now, so it is not in the hand any more.
        const card = partnerHand(carol.page).getByRole("button", { name, exact: true });
        if (name === "Mirror Force") await expect(card).toHaveCount(0);
        else await expect(card).toBeVisible();
      }
      await expect(tagField(carol.page, "partner").locator("[data-kind='st'][data-occupied='true']")).toHaveCount(1);
      await tableShot(carol.page, slug, info, "tag-chain-partner-view");
      // The partner of p2 (p4) sees the other hand the same way.
      await expect(partnerHand(dave.page)).toBeVisible();
      await expect(partnerHand(dave.page).getByRole("button", { name: "Gemini Elf", exact: true })).toBeVisible();
    });

    await test.step("rivals see no hand and no Set card face", async () => {
      for (const rival of [bob, dave]) {
        const room = await readTable(rival.page, slug);
        for (const seat of [0, 2]) {
          const view = room.engine!.seats.find((entry) => entry.seat === seat)!;
          expect(view.hand.length).toBeGreaterThan(0);
          expect(view.hand.every((card) => card.code == null && card.name == null), `seat ${seat} hand shown to ${rival.key}`).toBe(true);
        }
        const set = room.engine!.seats.find((entry) => entry.seat === 0)!.spells.find((card) => card != null);
        expect(set, "the Set card is on the board for rivals").toBeDefined();
        expect(set!.code, "the Set card is face down for rivals").toBeUndefined();
        for (const name of ["Pot of Greed", "Hinotama", "Mirror Force", "Dark Hole", "Heavy Storm"]) {
          await expect(rival.page.getByRole("button", { name, exact: true })).toHaveCount(0);
        }
        await expect(tagField(rival.page, "opponent", 0).locator("[data-kind='st'][data-occupied='true']")).toHaveCount(1);
      }
      await tableShot(bob.page, slug, info, "tag-chain-rival-view");
    });

    await test.step("no rival hand card code in any room JSON", async () => {
      const rooms = await Promise.all(seats.map((seat) => readTable(seat.page, slug)));
      // The codes each seat holds in hand, from that seat's own view, plus the Set Mirror Force.
      const hand = seats.map((_, seat) => handCodes(rooms[seat]!, seat));
      const filler = cardCode(FILLER);
      for (const [index, seat] of seats.entries()) {
        const team = teamOf(index);
        const rivalCodes = new Set(hand.flatMap((codes, other) => (teamOf(other) === team ? [] : codes)));
        if (team === 1) rivalCodes.add(cardCode("Mirror Force"));
        // Own team cards and the shared filler are in the viewer's deck or view: not a leak.
        const own = new Set([filler, ...hand.flatMap((codes, other) => (teamOf(other) === team ? codes : []))]);
        if (team === 0) own.add(cardCode("Mirror Force"));
        await expectNoLeak(seat.page, slug, rivalCodes, own, `${seat.key} (team ${team})`);
      }
    });

    await test.step("the opposing team answers first and the chips follow it", async () => {
      // p1 activates Pot of Greed. p2 and p4 hold Ash Blossom, so the opposing team is asked in turn order: seat 1, then seat 3.
      await useCard(alice.page, handCard(alice.page, "Pot of Greed"), "Activate");
      await pickLegalZone(alice.page, slug, "st");
      await expect.poll(async () => {
        const prompt = (await readTable(bob.page, slug)).engine!.prompt;
        return prompt ? [prompt.seat, prompt.context?.type] : null;
      }).toEqual([1, "chain"]);
      const order = (page: Page) => page.locator("[data-chain-fx] [data-testid='priority-chips']").first().locator("[data-seat]")
        .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("data-seat"))));
      for (const seat of seats) {
        // The responding team (1 and 3) is listed before the turn team (0 and 2), on every page.
        await expect.poll(() => order(seat.page)).toEqual([1, 3, 0, 2]);
        await expect(tagPriorityChips(seat.page)).toHaveAttribute("data-seat", "1");
      }
      await tableShot(bob.page, slug, info, "tag-chain-priority-p2");
      await chainNo(bob.page).click();
      // Passing is a team act: p4 is asked next, before the turn team gets a chance.
      await expect.poll(async () => {
        const prompt = (await readTable(dave.page, slug)).engine!.prompt;
        return prompt ? [prompt.seat, prompt.context?.type] : null;
      }).toEqual([3, "chain"]);
      for (const seat of seats) await expect(tagPriorityChips(seat.page)).toHaveAttribute("data-seat", "3");
      await tableShot(dave.page, slug, info, "tag-chain-priority-p4");
      await chainNo(dave.page).click();
      // The chain resolves: p1 draws two cards.
      await expect.poll(async () => (await readTable(alice.page, slug)).engine!.chain.length).toBe(0);
      await expect.poll(async () => (await readTable(alice.page, slug)).engine!.prompt?.context?.type).toBe("action");
      await expect(tagPriorityChips(alice.page)).toHaveCount(0);
    });

    await test.step("digit keys choose the rival seat during a seat pick", async () => {
      await expectReadyToAct(alice.page);
      await useCard(alice.page, handCard(alice.page, "Hinotama"), "Activate");
      await pickLegalZone(alice.page, slug, "st");
      await expect.poll(async () => (await readTable(alice.page, slug)).engine!.prompt?.context?.type).toBe("opponent");
      const prompt = (await readTable(alice.page, slug)).engine!.prompt!;
      const chips = alice.page.locator("[data-lp-seat][data-pickable='true']");
      await expect(chips).toHaveCount(2);
      // Each pickable rival shows its digit; read which seat holds "2" and expect that seat's option in the answer.
      const hotkeys = await chips.evaluateAll((nodes) => nodes.map((node) => ({
        seat: Number(node.getAttribute("data-lp-seat")),
        key: node.querySelector("kbd")?.textContent?.trim() ?? "",
      })));
      expect(hotkeys.map((entry) => entry.key).sort()).toEqual(["1", "2"]);
      const second = hotkeys.find((entry) => entry.key === "2")!;
      const expected = prompt.options.find((option) => option.controller === second.seat);
      expect(expected, `option for seat ${second.seat}`).toBeDefined();
      await tableShot(alice.page, slug, info, "tag-chain-seat-pick");
      const posted = alice.page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === `/api/duels/${slug}/actions`);
      await alice.page.keyboard.press("2");
      const body = (await posted).postDataJSON() as { promptId?: string; answer?: { choice?: unknown } };
      expect(body.promptId).toBe(prompt.id);
      expect(body.answer?.choice).toBe(expected!.id);
      // Hinotama hits the rival team's shared LP once: 16,000 - 500.
      for (const seat of seats) await expect.poll(() => teamLpValue(seat.page, 1)).toBe(15_500);
      for (const seat of seats) expect(await teamLpValue(seat.page, 0)).toBe(16_000);
    });
    expect(errors).toEqual([]);
  });
});
