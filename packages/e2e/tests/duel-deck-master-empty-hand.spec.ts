import { test, expect, type Page } from "@playwright/test";

/**
 * The Deck Master emblem keeps its place and size beside your hand when the hand is empty, also after the master went to
 * the field and came back. Before the fix an empty hand dropped the emblem onto the name plate as a tiny portrait.
 * The real 1v1 room on a fixture duel (no engine, no login): `window.__previewEditRoom` changes the served room.
 */

type Box = { emblem: string | null; x: number; y: number; w: number; h: number };

const emblemBox = (page: Page): Promise<Box | null> => page.evaluate(() => {
  const wrap = document.querySelector('[data-testid="dm-badge-wrap"][data-local="true"]');
  if (!wrap) return null;
  const r = wrap.getBoundingClientRect();
  return { emblem: wrap.getAttribute("data-emblem"), x: r.left, y: r.top, w: r.width, h: r.height };
});

type PreviewSeat = { seat: number; hand: unknown[]; monsters?: unknown[]; deckMaster?: { card: object; inZone: boolean; returns: number; nextCost: number } };
type PreviewRoom = { mySeat: number; engine: { seats: PreviewSeat[] } };

/** "leave": the master goes to the field and the hand is played out. "return": the master comes back to its zone. */
const editRoom = (page: Page, step: "leave" | "return") => page.evaluate((which) => {
  (window as unknown as { __previewEditRoom: (edit: (room: PreviewRoom) => void) => void }).__previewEditRoom((room) => {
    const me = room.engine.seats.find((seat) => seat.seat === room.mySeat)!;
    const monsters = (me.monsters ??= []);
    if (which === "leave") {
      me.hand = [];
      if (me.deckMaster) {
        me.deckMaster.inZone = false;
        monsters[2] = { ...me.deckMaster.card, controller: me.seat, location: 4, sequence: 2, position: 1 };
      }
    } else if (me.deckMaster) {
      Object.assign(me.deckMaster, { inZone: true, returns: 1, nextCost: 500 });
      monsters[2] = null;
    }
  });
}, step);

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
  test(`1v1: the Deck Master emblem stays beside an empty hand at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const response = await page.goto("/dev/table-preview/classic/room?state=m1");
    expect(response?.ok()).toBe(true);
    const wrap = page.locator('[data-testid="dm-badge-wrap"][data-local="true"]');
    await expect(wrap).toHaveAttribute("data-emblem", "docked");
    const start = (await emblemBox(page))!;

    await editRoom(page, "leave");
    await expect(page.locator('[data-hand-seat][data-side="you"] [data-hand-card]')).toHaveCount(0);
    await expect(wrap.getByTestId("dm-badge-state")).toHaveText("On field");
    await editRoom(page, "return");
    await expect(wrap.getByTestId("dm-badge-state")).toHaveText("In zone");

    // Still the full emblem in the hand row, at the same size and height as at the start, not a portrait on the plate.
    await expect(wrap).toHaveAttribute("data-emblem", "docked");
    const back = (await emblemBox(page))!;
    expect(Math.abs(back.w - start.w), "same width").toBeLessThanOrEqual(3);
    expect(Math.abs(back.h - start.h), "same height").toBeLessThanOrEqual(4);
    expect(Math.abs(back.y - start.y), "same row").toBeLessThanOrEqual(6);
    const row = (await page.locator('[data-hand-seat][data-side="you"]').boundingBox())!;
    expect(back.x, "inside the hand row").toBeGreaterThanOrEqual(row.x);
    expect(back.x + back.w, "inside the hand row").toBeLessThanOrEqual(row.x + row.width);
    await info.attach("empty-hand", { body: await page.screenshot(), contentType: "image/png" });
  });
}
