import { test, expect, type Seat } from "../helpers/fixtures";
import { activateSingleResponse, attackWithFirstMonster, endTurn, expectOpponentBoards, handCard, pickLegalZone, startTable, useCard } from "../helpers/board";
import { FILLER, withFiller } from "../helpers/decks";
import { enterDuelRoom, surrender } from "../helpers/duel";
import { expectAutoSpectating } from "../helpers/table";
import type { Page } from "@playwright/test";
import type { DuelRoom } from "@yugidraft/shared/duels";

function actions(page: Page, slug: string) {
  const sent: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === `/api/duels/${slug}/actions`) sent.push(request.postDataJSON());
  });
  return sent;
}
const readRoom = async (seat: Seat, slug: string): Promise<DuelRoom> => (await seat.page.request.get(`/api/duels/${slug}`)).json();

test.describe("3-player live FFA table", () => {
  test("picks an opponent from the seat strip with the real Mind Crush prompt", async ({ player }) => {
    const seats = await Promise.all([player("p1"), player("p2"), player("p3")]);
    const [alice] = seats;
    const { slug } = await startTable(seats, "ffa3 opponent", seats.map((_, seat) => ({
      main: withFiller(seat === 0 ? ["Mind Crush", FILLER, FILLER, FILLER, FILLER] : [FILLER], 14),
    })), { ordered: true, looseDecks: true, noBanlist: true, format: "ffa3" });
    await alice.page.setViewportSize({ width: 1280, height: 720 });
    await expectOpponentBoards(alice.page, 2);
    await useCard(alice.page, handCard(alice.page, "Mind Crush"), "Set Spell/Trap");
    await pickLegalZone(alice.page, "st");
    await endTurn(alice.page, 2);
    await activateSingleResponse(alice.page);
    await expect(alice.page.getByTestId("seat-strip-pick-2")).toBeVisible();
    const before = await readRoom(alice, slug);
    expect(before.engine!.prompt!.context?.type).toBe("opponent");
    const choice = before.engine!.prompt!.options.find((option) => option.controller === 2)!.id;
    const sent = actions(alice.page, slug);
    await alice.page.getByTestId("seat-strip-pick-2").click();
    await expect(alice.page.getByLabel("Search card name")).toBeVisible();
    expect(sent).toEqual([{ promptId: before.engine!.prompt!.id, revision: before.engine!.revision, answer: { choice } }]);
    await alice.page.getByLabel("Search card name").fill(FILLER);
    await alice.page.locator("#announce-card ~ ul button").filter({ hasText: FILLER }).click();
    await expect(alice.page.getByRole("button", { name: /^E2E Carol (GY|Graveyard) \(5\)$/ })).toBeVisible();
  });

  test("locks and confirms one direct attack, eliminates a seat, restores placings, and keeps a spectator passive", async ({ player }) => {
    const [alice, bob, carol, spectator] = await Promise.all([player("p1"), player("p2"), player("p3"), player("p4")]);
    const seats = [alice, bob, carol];
    const { slug } = await startTable(seats, "ffa3 full duel", seats.map(() => ({ main: withFiller([FILLER], 14) })),
      { ordered: true, looseDecks: true, noBanlist: true, format: "ffa3" });
    const spectatorActions = actions(spectator.page, slug);
    await spectator.page.goto(`/duels/${slug}?window=1`);
    await enterDuelRoom(spectator.page);
    await expect(spectator.page.locator("[data-table-stage] [data-lp-seat]")).toHaveCount(3);
    expect((await readRoom(spectator, slug)).mySeat).toBeNull();
    await useCard(alice.page, handCard(alice.page, FILLER), "Normal Summon");
    await pickLegalZone(alice.page, "mz");
    await endTurn(alice.page, 2);
    await endTurn(bob.page, 3);
    await endTurn(carol.page, 4);
    await attackWithFirstMonster(alice.page);
    const target = alice.page.locator("[data-opponent-bar='direct'] [data-rival-seat='2']");
    await expect(target).toBeVisible();
    const before = await readRoom(alice, slug);
    expect(before.engine!.prompt!.options.find((option) => option.controller === 2)!.id).toBe("opt:1");
    const sent = actions(alice.page, slug);
    await target.click();
    await expect(target).toHaveAttribute("data-locked", "true");
    expect(sent).toHaveLength(0);
    await expect(spectator.page.getByTestId("seat-strip-pick-1")).toHaveCount(0);
    await expect(spectator.page.getByTestId("aim-confirm")).toHaveCount(0);
    await spectator.page.keyboard.press("1");
    await spectator.page.locator("[data-zones='0:4:0'] button").click();
    await expect(spectator.page.getByRole("menu")).toHaveCount(0);
    await alice.page.getByTestId("aim-confirm").click();
    for (const seat of [...seats, spectator]) await expect(seat.page.locator("[data-lp-seat='2']")).toContainText("6,000");
    expect(sent).toEqual([{ promptId: before.engine!.prompt!.id, revision: before.engine!.revision, answer: { choice: "opt:1" } }]);
    await surrender(carol.page);
    await expect(alice.page.getByTestId("seat-strip-leaving-2")).toBeVisible();
    await endTurn(alice.page, 5);
    // The eliminated duelist switches to spectating without a choice panel.
    await expectAutoSpectating(carol.page, slug);
    await expect(alice.page.getByTestId("seat-strip-2")).toHaveAttribute("data-eliminated", "true");
    await surrender(bob.page);
    for (const seat of [...seats, spectator]) {
      const result = seat.page.getByTestId("duel-result");
      await expect(result).toBeVisible();
      await expect(result.locator("[data-place]")).toHaveText(["1st", "2nd", "3rd"]);
      await expect(result.getByRole("listitem").filter({ hasText: "E2E Carol" }).locator("[data-place]")).toHaveText("3rd");
      expect((await readRoom(seat, slug)).engine!.eliminationOrder).toEqual([[2], [1]]);
    }
    await alice.page.reload();
    await expect(alice.page.getByTestId("duel-result").locator("[data-place]")).toHaveText(["1st", "2nd", "3rd"]);
    expect(spectatorActions).toHaveLength(0);
  });
});
