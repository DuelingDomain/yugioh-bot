import { describe, expect, it } from "vitest";
import { CARD_RATIO, FIT_GAP, fitDeckLayout } from "@/components/decks/deck-fit";

const full = { main: 60, extra: 15, side: 15, master: false, sideUsed: true };

/** Height the layout needs, to prove the picked tile size fits. */
function needed(fit: ReturnType<typeof fitDeckLayout>, master: boolean) {
  const rows = [fit.rows.main, fit.rows.extra, fit.rows.side].filter((count) => count > 0);
  const tileRows = rows.reduce((sum, count) => sum + count, 0) + (master ? 1 : 0);
  return tileRows * fit.tile * CARD_RATIO + rows.reduce((sum, count) => sum + (count - 1) * FIT_GAP, 0);
}

describe("fitDeckLayout", () => {
  it.each([
    [1180, 760],
    [1820, 1180],
    [697, 500],
  ])("fits a full deck in a %ipx by %ipx area", (width, free) => {
    const fit = fitDeckLayout({ ...full, width, free });
    expect(fit.tile).toBeGreaterThan(0);
    expect(fit.cols * fit.tile + (fit.cols - 1) * FIT_GAP).toBeLessThanOrEqual(width);
    expect(needed(fit, false)).toBeLessThanOrEqual(free);
  });

  it("keeps a row for the Deck Master", () => {
    const fit = fitDeckLayout({ ...full, master: true, sideUsed: false, width: 1180, free: 700 });
    expect(needed(fit, true)).toBeLessThanOrEqual(700);
    expect(fit.rows.side).toBe(0);
  });

  it("does not resize tiles while cards are added", () => {
    const empty = fitDeckLayout({ ...full, main: 0, extra: 0, side: 0, width: 1180, free: 760 });
    expect(empty).toEqual(fitDeckLayout({ ...full, width: 1180, free: 760 }));
  });

  it("makes room for a deck over the size limits", () => {
    const fit = fitDeckLayout({ ...full, main: 80, width: 1180, free: 760 });
    expect(fit.rows.main * fit.cols).toBeGreaterThanOrEqual(80);
  });

  it("never picks a tile wider than the cap", () => {
    expect(fitDeckLayout({ ...full, width: 4000, free: 4000 }).tile).toBeLessThanOrEqual(150);
  });
});
