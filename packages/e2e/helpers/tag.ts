import { expect, type Locator, type Page } from "@playwright/test";

// Helpers for the live Tag 2v2 table (the "Rooftop"). The DOM hooks are the TAG_DOM contract in
// packages/web/src/components/duel/tag/live-tag.ts: stage `data-table-stage="tag"` (and `data-tag-stage`), a
// `data-seat-field={seat}` per field with `data-side` "you" (self) or "partner", and `data-relation` on each field.
// Shared helpers of table.ts (tableField, tableLp, tableLpValue) work on a Tag table too. The generic ownZone /
// attackWithFirstMonster of board.ts can hit a partner zone if a partner zone carries data-side="you"; use ownZoneTag.

export type TagRelation = "self" | "partner" | "opponent" | "other";
export type TagZoneKind = "mz" | "st" | "emz" | "field";

/** The root of the Tag shell. FFA tables carry `data-table-shell` with no value. */
export const tagShell = (page: Page): Locator => page.locator("[data-table-shell='tag']");

/** The roof stage root inside the shell. */
export const tagStage = (page: Page): Locator => page.locator("[data-table-stage='tag'][data-tag-stage]");

/** A seat field seen from the viewer's side. Pass `seat` to pick one field when two share a relation (opponents). */
export const tagField = (page: Page, relation: TagRelation, seat?: number): Locator =>
  page.locator(`[data-table-stage='tag'] [data-seat-field${seat == null ? "" : `='${seat}'`}][data-relation='${relation}']`);

/** The seats that hold priority now: chain chips with `data-now` (`data-seat` is the seat). */
export const tagPriorityChips = (page: Page): Locator =>
  page.locator("[data-chain-fx] [data-testid='priority-chips'] [data-seat][data-now]");

/** Tag teams alternate by seat: team 0 holds seats 0 and 2, team 1 holds seats 1 and 3 (teamOfSeat: seat % 2). */
const teamSeats = (team: number): number[] => [team, team + 2];

/** The life plate of a team: the plate that holds the chips of that team's seats. */
export const teamLpPlate = (page: Page, team: number): Locator =>
  page.locator("[data-team-plate]").filter({ has: page.locator(`[data-lp-seat='${teamSeats(team)[0]}']`) });

/** The shared LP of a team, read from the plate's live-region text ("8,000"). */
export async function teamLpValue(page: Page, team: number): Promise<number> {
  const text = (await teamLpPlate(page, team).locator("[data-lp-value]").first().textContent())?.trim() ?? "";
  const value = Number(text.replace(/[,\s]/g, ""));
  expect(Number.isFinite(value), `team ${team} LP is not a number: "${text}"`).toBe(true);
  return value;
}

/** A zone on the partner's field. */
export const partnerZone = (page: Page, kind: TagZoneKind, index = 0): Locator =>
  tagField(page, "partner").locator(`[data-kind="${kind}"]`).nth(index);

/** A zone on your own field only (relation "self"), unlike ownZone of board.ts. */
export const ownZoneTag = (page: Page, kind: TagZoneKind, index = 0): Locator =>
  tagField(page, "self").locator(`[data-kind="${kind}"]`).nth(index);

/** The Tag Rooftop is mounted: the tag shell is visible and the old MultiSeatStage is gone. */
export async function expectRooftop(page: Page): Promise<void> {
  await expect(tagShell(page)).toBeVisible();
  await expect(tagStage(page)).toBeVisible();
  await expect(page.getByTestId("multi-seat-stage")).toHaveCount(0);
}

/** The turn count from the header text "Turn N". */
export async function turnNumber(page: Page): Promise<number> {
  const text = (await tagShell(page).getByText(/\bTurn \d+\b/).first().textContent()) ?? "";
  const match = /\bTurn (\d+)\b/.exec(text);
  expect(match, `no "Turn N" text in the header: "${text}"`).not.toBeNull();
  return Number(match![1]);
}
