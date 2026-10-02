import { test, expect, type Seat } from "../helpers/fixtures";
import { endTurn, handCard, pickLegalZone, startTable, turnLabel, useCard } from "../helpers/board";
import { FILLER, withFiller } from "../helpers/decks";
import { enterDuelRoom, surrender } from "../helpers/duel";
import { actionPosts, collectTableErrors, expectRealCore, readTable, readTableTrace, tableField, tableShot } from "../helpers/table";
import type { DuelRoom } from "@yugidraft/shared/duels";
import type { Page, TestInfo } from "@playwright/test";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const options = { ordered: true, looseDecks: true, noBanlist: true, format: "ffa3" as const };
const occupied = (page: Page, seat: number) => tableField(page, seat).locator("[data-kind='mz'][data-occupied='true']");
const normalDeck = () => ({ main: withFiller([FILLER], 40) });
const viewSeat = (room: DuelRoom, seat: number) => room.engine!.seats.find(entry => entry.seat === seat)!;

async function humans(player: (key: "p1" | "p2" | "p3" | "p4") => Promise<Seat>, format: "ffa3" | "ffa4") {
  return Promise.all((format === "ffa3" ? ["p1", "p2", "p3"] as const : ["p1", "p2", "p3", "p4"] as const).map(key => player(key)));
}
async function summon(page: Page) {
  await useCard(page, handCard(page, FILLER), "Normal Summon");
  await pickLegalZone(page, "mz");
}
async function evidence(page: Page, slug: string, info: TestInfo, name: string, snapshots: DuelRoom[] = []) {
  const trace = await readTableTrace(page, slug);
  await info.attach(name, { body: JSON.stringify({ snapshots, trace }, null, 2), contentType: "application/json" });
  return trace.promptLog;
}
async function shot(page: Page, slug: string, info: TestInfo, name: string) {
  await tableShot(page, slug, info, `r3-surrender-${name}`);
  const directory = process.env.E2E_SURRENDER_SHOT_DIR;
  if (info.repeatEachIndex === 1 && directory) {
    mkdirSync(directory, { recursive: true });
    copyFileSync(info.outputPath(`live-ffa3-r3-surrender-${name}.png`), join(directory, `live-ffa3-r3-surrender-${name}.png`));
  }
}
async function publicRoom(page: Page, slug: string): Promise<DuelRoom> {
  const response = await page.request.get(`/api/duels/${slug}?spectate=1`);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

// Moved from duel-3p-ffa-table.spec.ts; extended with the explicit spectator choice.
test.describe("FFA surrender and spectators", () => {
  test("current engine: queued surrender reaches a turn boundary, then the eliminated player watches live turns and placings", async ({ player }, info) => {
    const [alice, bob, carol] = await humans(player, "ffa3") as [Seat, Seat, Seat];
    const errors = collectTableErrors(alice.page, [bob.page, carol.page]);
    const { slug } = await startTable([alice, bob, carol], "ffa3 leaving and watching", [normalDeck(), normalDeck(), normalDeck()], options);
    await expectRealCore(alice.page, slug, "practice", info, 0);
    await summon(alice.page);
    await endTurn(alice.page, 2);
    const before = await readTable(alice.page, slug);
    expect(before.engine!.chain).toHaveLength(0);
    const response = alice.page.waitForResponse(reply => reply.url().endsWith(`/api/duels/${slug}/surrender`) && reply.request().method() === "POST");
    await surrender(alice.page);
    const pending = await (await response).json() as DuelRoom;
    expect(viewSeat(pending, 0)).toMatchObject({ eliminated: false, pendingElimination: true });
    expect(pending.engine!.turn).toBe(2);
    await expect(alice.page.locator("[data-holo='0']")).toHaveAttribute("data-leaving", "true");
    await expect(alice.page.getByRole("button", { name: "Surrender", exact: true })).toHaveCount(0);
    await expect(alice.page.getByRole("button", { name: "Stay and watch" })).toHaveCount(0);
    await shot(alice.page, slug, info, "leaving");
    // Ending the turn is the next adjustment in this focused path. The intermediate-summon
    // tests below show why this path alone is not proof of the new owner timing rule.
    await endTurn(bob.page, 3);
    const after = await readTable(alice.page, slug);
    expect(after.engine!.turn).toBe(3);
    expect(viewSeat(after, 0).eliminated).toBe(true);
    for (const location of ["hand", "monsters", "spells", "graveyard", "banished"] as const) expect(viewSeat(after, 0)[location].filter(Boolean)).toHaveLength(0);
    await expect(alice.page.locator("[data-holo='0']")).toHaveAttribute("data-elim", "true");
    await expect(occupied(alice.page, 0)).toHaveCount(0);
    await expect(alice.page.getByTestId("self-eliminated")).toBeVisible();
    await alice.page.reload();
    await enterDuelRoom(alice.page);
    await expect(alice.page.getByTestId("seat-out")).toContainText("3rd");
    await expect(alice.page.getByRole("region", { name: "You are eliminated" })).toBeVisible();
    await shot(alice.page, slug, info, "choice");
    const posts = actionPosts(alice.page, slug);
    await alice.page.getByRole("button", { name: "Stay and watch" }).click();
    await expect(alice.page).toHaveURL(/spectate=1/);
    await expect(alice.page.getByText("You are spectating", { exact: true })).toBeVisible();
    await expect(alice.page.getByText("Live duel · watching", { exact: true })).toBeVisible();
    await expect(alice.page.locator("[data-table-shell]")).toHaveAttribute("data-can-act", "false");
    await expect(alice.page.getByRole("group", { name: "Your hand" })).toHaveCount(0);
    await expect(alice.page.locator("[data-prompt-panel]")).toHaveCount(0);
    const watched = await publicRoom(alice.page, slug);
    expect(watched).toMatchObject({ role: "spectator", mySeat: null, myDeck: null, mySide: null, engine: { prompt: null, eliminationOrder: [[0]] } });
    const connection = await alice.page.request.get(`/api/duels/${slug}/connection?spectate=1`);
    expect(connection.ok()).toBe(true);
    const credentials = await connection.json() as { token: string };
    expect(JSON.parse(Buffer.from(credentials.token.split(".")[0]!, "base64url").toString()).seat).toBeNull();
    for (const seat of watched.engine!.seats) expect(seat.hand.every(card => card.code == null && card.name == null)).toBe(true);
    await expect.poll(async () => {
      const trace = await readTableTrace(bob.page, slug);
      return trace.seats.find(entry => entry.seat === 2)?.view.turn;
    }).toBe(3);
    await endTurn(carol.page, 4);
    await expect(turnLabel(alice.page)).toHaveText("Turn 4");
    await expect(alice.page.locator("[data-arc='1']")).toHaveAttribute("data-lit", "true");
    const log = await evidence(bob.page, slug, info, "surrender-ordered-live-turns", [before, pending, after, watched]);
    expect(log.filter(entry => entry.promptType === "action").map(entry => [entry.turn, entry.turnSeat]).filter((entry, index, entries) => index === 0 || entry[0] !== entries[index - 1]![0])).toEqual([[1, 0], [2, 1], [3, 2], [4, 1]]);
    await alice.page.reload();
    await expect(alice.page.getByText("You are spectating", { exact: true })).toBeVisible();
    expect((await publicRoom(alice.page, slug)).engine!.prompt).toBeNull();
    await surrender(bob.page);
    const result = alice.page.getByTestId("duel-result");
    await expect(result).toHaveAttribute("data-outcome", "spectator");
    const rows = result.getByRole("list", { name: "Final standings" }).getByRole("listitem");
    await expect(rows).toHaveCount(3);
    expect(await rows.evaluateAll(nodes => nodes.map(node => Number(node.getAttribute("data-seat"))))).toEqual([2, 1, 0]);
    await expect(result.locator("[data-place]")).toHaveText(["1st", "2nd", "3rd"]);
    await shot(alice.page, slug, info, "spectator-result");
    await alice.page.reload();
    await expect(result).toHaveAttribute("data-outcome", "spectator");
    await expect(rows).toHaveCount(3);
    expect((await publicRoom(alice.page, slug)).engine!.prompt).toBeNull();
    expect(posts.count).toBe(0);
    expect(errors).toEqual([]);
  });

  test("an eliminated player can leave the room while the other duelists keep playing", async ({ player }, info) => {
    const [alice, bob, carol] = await humans(player, "ffa3") as [Seat, Seat, Seat];
    const { slug } = await startTable([alice, bob, carol], "ffa3 leave room", [normalDeck(), normalDeck(), normalDeck()], options);
    await endTurn(alice.page, 2);
    await surrender(alice.page);
    await endTurn(bob.page, 3);
    await expect(alice.page.getByRole("region", { name: "You are eliminated" })).toBeVisible();
    await alice.page.getByRole("button", { name: "Leave room", exact: true }).click();
    await expect(alice.page).toHaveURL(/\/duels$/);
    await endTurn(carol.page, 4);
    expect((await readTable(bob.page, slug)).session.status).toBe("active");
    expect((await readTable(bob.page, slug)).session.seats.map(seat => seat.seat)).toEqual([0, 1, 2]);
    await evidence(bob.page, slug, info, "leave-room-next-live-seat");
  });

  for (const format of ["ffa3", "ffa4"] as const) {
    for (const ownerRule of [false, true]) {
      test(ownerRule
        ? `${format}: owner rule 2026-10-02: surrender at end of turn keeps Leaving through a summon`
        : `current engine: ${format} no-chain surrender lands after summon placement in the same Main Phase`, async ({ player }, info) => {
        const seats = await humans(player, format);
        const errors = collectTableErrors(seats[0]!.page, seats.slice(1).map(seat => seat.page));
        const { slug } = await startTable(seats, `${format} surrender timing`, seats.map(normalDeck), { ...options, format });
        const alice = seats[0]!, leaver = seats.at(-1)!, leavingSeat = seats.length - 1;
        await expectRealCore(alice.page, slug, "practice", info, 0);
        const before = await readTable(alice.page, slug);
        expect(before.engine!.chain).toHaveLength(0);
        await surrender(leaver.page);
        const pending = await readTable(alice.page, slug);
        expect(viewSeat(pending, leavingSeat)).toMatchObject({ eliminated: false, pendingElimination: true });
        await expect(leaver.page.locator(`[data-holo='${leavingSeat}']`)).toHaveAttribute("data-leaving", "true");
        await useCard(alice.page, handCard(alice.page, FILLER), "Normal Summon");
        const placement = await readTable(alice.page, slug);
        expect(placement.engine!.prompt?.kind).toBe("places");
        expect(viewSeat(placement, leavingSeat)).toMatchObject({ eliminated: false, pendingElimination: true });
        await pickLegalZone(alice.page, "mz");
        const adjusted = await readTable(alice.page, slug);
        const log = await evidence(alice.page, slug, info, "no-chain-surrender-adjustment", [before, pending, placement, adjusted]);
        expect(adjusted.engine).toMatchObject({ turn: 1, turnSeat: 0, phase: "main1" });
        expect(adjusted.engine!.prompt?.context?.type).toBe("action");
        expect(log.filter(entry => entry.turn === 1).map(entry => entry.kind)).toContain("places");
        if (ownerRule) {
          test.fail(true, "owner rule 2026-10-02: surrender at end of turn pending engine change");
          expect(viewSeat(adjusted, leavingSeat).eliminated, "surrender must stay queued through Main Phase actions").toBe(false);
          expect(viewSeat(adjusted, leavingSeat).pendingElimination).toBe(true);
          await expect(leaver.page.locator(`[data-holo='${leavingSeat}']`)).toHaveAttribute("data-leaving", "true");
        } else {
          expect(viewSeat(adjusted, leavingSeat).eliminated).toBe(true);
          expect(viewSeat(adjusted, leavingSeat).pendingElimination).not.toBe(true);
          await expect(leaver.page.locator(`[data-holo='${leavingSeat}']`)).toHaveAttribute("data-elim", "true");
        }
        await endTurn(alice.page, 2);
        expect(viewSeat(await readTable(alice.page, slug), leavingSeat).eliminated).toBe(true);
        expect(errors).toEqual([]);
      });
    }

    test(`${format}: surrender during your own turn passes to the next live seat in order`, async ({ player }, info) => {
      const seats = await humans(player, format);
      const { slug } = await startTable(seats, `${format} own turn surrender`, seats.map(normalDeck), { ...options, format });
      const alice = seats[0]!;
      const nextSeat = format === "ffa4" ? 2 : 1;
      if (format === "ffa4") {
        await surrender(seats[1]!.page);
        await summon(alice.page);
        expect(viewSeat(await readTable(alice.page, slug), 1).eliminated).toBe(true);
      }
      await surrender(alice.page);
      await expect.poll(async () => (await readTable(seats[nextSeat]!.page, slug)).engine!.turnSeat).toBe(nextSeat);
      const room = await readTable(seats[nextSeat]!.page, slug);
      expect(room.engine!.turn).toBe(2);
      expect(room.engine!.prompt?.seat).toBe(nextSeat);
      expect(viewSeat(room, 0).eliminated).toBe(true);
      const log = await evidence(seats[nextSeat]!.page, slug, info, "own-turn-surrender-handoff", [room]);
      expect(log.filter(entry => entry.promptType === "action" && entry.turn === 2).map(entry => entry.promptSeat)).toEqual([nextSeat]);
      await expect(alice.page.locator("[data-table-shell]")).toHaveAttribute("data-can-act", "false");
    });
  }

  for (const format of ["ffa3", "ffa4"] as const) {
    test(`${format}: R-FFA-ELIMINATION: surrender during an open chain suppresses the flagged duelist's link and eliminates after the chain`, async ({ player }, info) => {
      const seats = await humans(player, format);
      const [alice, bob] = seats as [Seat, Seat, ...Seat[]];
      const { slug } = await startTable(seats, `${format} surrender in chain`, [
        { main: withFiller(["Pot of Greed", FILLER], 40) },
        { main: withFiller(["Ash Blossom & Joyous Spring"], 40) }, ...seats.slice(2).map(normalDeck),
      ], { ...options, format });
      await summon(alice.page);
      await useCard(alice.page, handCard(alice.page, "Pot of Greed"), "Activate");
      await pickLegalZone(alice.page, "st");
      await expect.poll(async () => (await readTable(bob.page, slug)).engine!.prompt?.context?.type).toBe("chain");
      const before = await readTable(bob.page, slug);
      expect(before.engine!.chain.map(link => link.seat)).toEqual([0]);
      await surrender(alice.page);
      const pending = await readTable(bob.page, slug);
      expect(pending.engine!.prompt?.id).toBe(before.engine!.prompt?.id);
      expect(pending.engine!.chain.map(link => link.seat)).toEqual([0]);
      expect(viewSeat(pending, 0)).toMatchObject({ eliminated: false, pendingElimination: true });
      expect(viewSeat(pending, 0).monsters.filter(Boolean)).toHaveLength(1);
      await expect(occupied(alice.page, 0)).toHaveCount(1);
      await expect(alice.page.locator("[data-holo='0']")).toHaveAttribute("data-leaving", "true");
      // Decline rather than negate: Pot's missing draw must come from the flagged link.
      await bob.page.locator("[data-prompt-panel]").getByRole("button", { name: "No", exact: true }).click();
      await expect.poll(async () => viewSeat(await readTable(bob.page, slug), 0).eliminated).toBe(true);
      const after = await readTable(bob.page, slug);
      expect(after.engine!.chain).toHaveLength(0);
      expect(after.engine!.log.some(entry => entry.text === "Player 1 drew 2 card(s)")).toBe(false);
      expect(viewSeat(after, 0).monsters.filter(Boolean)).toHaveLength(0);
      await expect(occupied(alice.page, 0)).toHaveCount(0);
      expect(after.session.status).toBe("active");
      await evidence(bob.page, slug, info, "open-chain-surrender", [before, pending, after]);
    });
  }
});
