import { test, expect, type Seat } from "../helpers/fixtures";
import { endTurn, handCard, pickLegalZone, startTable, turnLabel, useCard } from "../helpers/board";
import { FILLER, withFiller } from "../helpers/decks";
import { surrender } from "../helpers/duel";
import { actionPosts, collectTableErrors, expectAutoSpectating, expectRealCore, readTable, readTableTrace, tableField, tableShot } from "../helpers/table";
import type { DuelRoom } from "@yugidraft/shared/duels";
import type { Page, TestInfo } from "@playwright/test";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const options = { ordered: true, looseDecks: true, noBanlist: true, format: "ffa3" as const };
const occupied = (page: Page, seat: number) => tableField(page, seat).locator("[data-kind='mz'][data-occupied='true']");
const normalDeck = () => ({ main: withFiller([FILLER], 40) });
const viewSeat = (room: DuelRoom, seat: number) => room.engine!.seats.find(entry => entry.seat === seat)!;

async function humans(player: (key: "p1" | "p2" | "p3" | "p4") => Promise<Seat>, format: "ffa3" | "ffa4") {
  const seats = await Promise.all((format === "ffa3" ? ["p1", "p2", "p3"] as const : ["p1", "p2", "p3", "p4"] as const).map(key => player(key)));
  // Surrender tests exclude audio-device behavior; keep console errors observable without a headless audio sink.
  await Promise.all(seats.map(seat => seat.context.addInitScript(() => {
    for (const name of ["AudioContext", "webkitAudioContext"]) Object.defineProperty(window, name, { value: undefined, configurable: true });
  })));
  return seats;
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
  if (info.repeatEachIndex === 0 && directory) {
    mkdirSync(directory, { recursive: true });
    copyFileSync(info.outputPath(`live-ffa3-r3-surrender-${name}.png`), join(directory, `surrender-${name}.png`));
  }
}
// After the duel ends, spectate=1 returns the seated reader's own seat room, not the spectator copy.
const ownSeatRoomAfterSpectate = (page: Page, slug: string) => readTable(page, slug, true);

// Real-core surrender state, automatic spectator data and owner timing contracts.
test.describe("FFA surrender and spectators", () => {
  // Four live boards can render slowly when other stack slots share headless Chromium resources.
  test.use({ actionTimeout: 60_000, navigationTimeout: 60_000 });

  test("queued surrender shows Leaving, then automatically spectates live turns and placings", async ({ player }, info) => {
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
    await expect(alice.page.getByTestId("self-leaving")).toHaveText("Leaving — you surrendered; you leave at the end of this turn");
    for (const seat of [alice, bob, carol]) await expect(seat.page.locator("[data-holo='0']")).toContainText("Leaving");
    const posts = actionPosts(alice.page, slug);
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
    const watched = await expectAutoSpectating(alice.page, slug);
    await expect(alice.page.getByTestId("seat-out")).toContainText("3rd");
    expect(watched.engine!.eliminationOrder).toEqual([[0]]);
    const connection = await alice.page.request.get(`/api/duels/${slug}/connection?spectate=1`);
    expect(connection.ok()).toBe(true);
    const credentials = await connection.json() as { token: string };
    expect(JSON.parse(Buffer.from(credentials.token.split(".")[0]!, "base64url").toString()).seat).toBeNull();
    for (const seat of watched.engine!.seats) expect(seat.hand.every(card => card.code == null && card.name == null)).toBe(true);
    await expect.poll(async () => {
      const trace = await readTableTrace(bob.page, slug);
      return trace.seats.find(entry => entry.seat === 2)?.view.turn;
    }).toBe(3);
    await shot(alice.page, slug, info, "auto-spectator");
    await endTurn(carol.page, 4);
    await expect(turnLabel(alice.page)).toHaveText("Turn 4");
    await expect(alice.page.locator("[data-arc='1']")).toHaveAttribute("data-lit", "true");
    const log = await evidence(bob.page, slug, info, "surrender-ordered-live-turns", [before, pending, after, watched]);
    expect(log.filter(entry => entry.promptType === "action").map(entry => [entry.turn, entry.turnSeat]).filter((entry, index, entries) => index === 0 || entry[0] !== entries[index - 1]![0])).toEqual([[1, 0], [2, 1], [3, 2], [4, 1]]);
    await alice.page.reload();
    await expectAutoSpectating(alice.page, slug);
    await surrender(bob.page);
    const result = alice.page.getByTestId("duel-result");
    // The eliminated seat spectated during the duel; once it ends the room shows its own loss and its own row.
    await expect(result).toHaveAttribute("data-outcome", "lose");
    await expect(result.locator("[data-tag='you']")).toHaveCount(1);
    const rows = result.getByRole("list", { name: "Final standings" }).getByRole("listitem");
    await expect(rows).toHaveCount(3);
    expect(await rows.evaluateAll(nodes => nodes.map(node => Number(node.getAttribute("data-seat"))))).toEqual([2, 1, 0]);
    await expect(result.locator("[data-place]")).toHaveText(["1st", "2nd", "3rd"]);
    await shot(alice.page, slug, info, "spectator-result");
    await alice.page.reload();
    await expect(result).toHaveAttribute("data-outcome", "lose");
    await expect(rows).toHaveCount(3);
    const ownRoom = await ownSeatRoomAfterSpectate(alice.page, slug);
    expect(ownRoom).toMatchObject({ role: "player", mySeat: 0 });
    expect(ownRoom.engine!.prompt).toBeNull();
    expect(posts.count).toBe(0);
    expect(errors).toEqual([]);
  });

  test("FFA4: an eliminated player automatically spectates live turns and persisted four-seat placings", async ({ player }, info) => {
    const [alice, bob, carol, dan] = await humans(player, "ffa4") as [Seat, Seat, Seat, Seat];
    const errors = collectTableErrors(alice.page, [bob.page, carol.page, dan.page]);
    const { slug } = await startTable([alice, bob, carol, dan], "ffa4 leaving and watching", Array.from({ length: 4 }, normalDeck), { ...options, format: "ffa4" });
    await expectRealCore(alice.page, slug, "practice", info, 0);
    await endTurn(alice.page, 2);
    await surrender(alice.page);
    await expect(alice.page.getByTestId("self-leaving")).toBeVisible();
    await shot(alice.page, slug, info, "ffa4-leaving");
    await endTurn(bob.page, 3);
    const posts = actionPosts(alice.page, slug);
    const watched = await expectAutoSpectating(alice.page, slug);
    expect(watched.engine!.eliminationOrder).toEqual([[0]]);
    expect(watched.engine!.seats).toHaveLength(4);
    await shot(alice.page, slug, info, "ffa4-spectating");
    await endTurn(carol.page, 4);
    await expect(turnLabel(alice.page)).toHaveText("Turn 4");
    await expect(alice.page.locator("[data-arc='3']")).toHaveAttribute("data-lit", "true");
    await alice.page.reload();
    await expectAutoSpectating(alice.page, slug);
    await surrender(dan.page);
    await expect.poll(async () => (await readTable(bob.page, slug)).engine!.turnSeat).toBe(1);
    await surrender(bob.page);
    const result = alice.page.getByTestId("duel-result");
    // The eliminated seat spectated during the duel; once it ends the room shows its own loss and its own row.
    await expect(result).toHaveAttribute("data-outcome", "lose");
    await expect(result.locator("[data-tag='you']")).toHaveCount(1);
    const rows = result.getByRole("list", { name: "Final standings" }).getByRole("listitem");
    await expect(rows).toHaveCount(4);
    expect(await rows.evaluateAll(nodes => nodes.map(node => Number(node.getAttribute("data-seat"))))).toEqual([2, 1, 3, 0]);
    await expect(result.locator("[data-place]")).toHaveText(["1st", "2nd", "3rd", "4th"]);
    await alice.page.reload();
    await expect(result).toHaveAttribute("data-outcome", "lose");
    await expect(rows).toHaveCount(4);
    await evidence(carol.page, slug, info, "ffa4-spectator-live-turns", [watched]);
    expect(posts.count).toBe(0);
    expect(errors).toEqual([]);
  });

  test("an eliminated player can leave the room while the other duelists keep playing", async ({ player }, info) => {
    const [alice, bob, carol] = await humans(player, "ffa3") as [Seat, Seat, Seat];
    const { slug } = await startTable([alice, bob, carol], "ffa3 leave room", [normalDeck(), normalDeck(), normalDeck()], options);
    await endTurn(alice.page, 2);
    await surrender(alice.page);
    await endTurn(bob.page, 3);
    await expectAutoSpectating(alice.page, slug);
    alice.page.once("dialog", dialog => dialog.accept());
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
        await expect.poll(async () => (await readTable(alice.page, slug)).engine!.prompt?.kind).toBe("places");
        const placement = await readTable(alice.page, slug);
        expect(placement.engine!.prompt?.kind).toBe("places");
        expect(viewSeat(placement, leavingSeat)).toMatchObject({ eliminated: false, pendingElimination: true });
        await pickLegalZone(alice.page, "mz");
        await expect.poll(async () => (await readTable(alice.page, slug)).engine!.prompt?.context?.type).toBe("action");
        const adjusted = await readTable(alice.page, slug);
        const log = await evidence(alice.page, slug, info, "no-chain-surrender-adjustment", [before, pending, placement, adjusted]);
        expect(adjusted.engine).toMatchObject({ turn: 1, turnSeat: 0, phase: "main1" });
        expect(adjusted.engine!.prompt?.context?.type).toBe("action");
        expect(log.filter(entry => entry.turn === 1).map(entry => entry.kind)).toContain("places");
        if (ownerRule) {
          test.fail(true, "R-COMMON-SURRENDER-EOT pending engine change");
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

  }
  for (const format of ["ffa3", "ffa4"] as const) {
    for (const ownerRule of [false, true]) {
      test(ownerRule ? `${format}: owner rule: an offered Leaving opponent selection is accepted`
        : `current engine: ${format}: Leaving remains selectable but the core rejects its opponent choice`, async ({ player }, info) => {
        const seats = await humans(player, format);
        const alice = seats[0]!, leaver = seats[1]!;
        const { slug } = await startTable(seats, `${format} choose Leaving opponent`, [
          { main: withFiller(["Hinotama"], 40) }, ...seats.slice(1).map(normalDeck),
        ], { ...options, format });
        await useCard(alice.page, handCard(alice.page, "Hinotama"), "Activate");
        await pickLegalZone(alice.page, "st");
        await expect.poll(async () => (await readTable(alice.page, slug)).engine!.prompt?.context?.type).toBe("opponent");
        await surrender(leaver.page);
        const pending = await readTable(alice.page, slug);
        expect(viewSeat(pending, 1)).toMatchObject({ eliminated: false, pendingElimination: true });
        const option = pending.engine!.prompt!.options.find(option => option.controller === 1);
        expect(option).toBeDefined();
        const posts = actionPosts(leaver.page, slug);
        await expect(leaver.page.getByTestId("self-leaving")).toBeVisible();
        await expect(leaver.page.locator("[data-prompt-panel]")).toHaveCount(0);
        await expect(leaver.page.locator("[data-table-shell]")).toHaveAttribute("data-can-act", "false");
        await expect(alice.page.locator("[data-holo='1']")).toContainText("Leaving");
        const answered = alice.page.waitForResponse(reply => reply.url().endsWith(`/api/duels/${slug}/actions`) && reply.request().method() === "POST");
        await alice.page.getByTestId("holo-pick-1").click();
        const reply = await answered;
        const submitted = reply.request().postDataJSON();
        expect(submitted).toEqual({ revision: pending.engine!.revision, promptId: pending.engine!.prompt!.id, answer: { choice: option!.id } });
        expect(posts.count).toBe(0);
        await info.attach("Leaving-opponent-request", { body: JSON.stringify(submitted), contentType: "application/json" });
        await evidence(alice.page, slug, info, "Leaving-opponent-selected", [pending]);
        if (ownerRule) {
          test.fail(true, "R-COMMON-SURRENDER-EOT pending engine change");
          expect(reply.ok(), "the engine must accept an offered Leaving opponent").toBe(true);
        } else {
          expect(reply.status()).toBe(400);
          expect(await reply.json()).toEqual({ error: "Invalid answer" });
          const unchanged = await readTable(alice.page, slug);
          expect(unchanged.engine!.prompt).toEqual(pending.engine!.prompt);
          expect(viewSeat(unchanged, 1)).toMatchObject({ eliminated: false, pendingElimination: true });
          const fallback = alice.page.waitForResponse(reply => reply.url().endsWith(`/api/duels/${slug}/actions`) && reply.request().method() === "POST");
          await alice.page.getByTestId("holo-pick-2").click();
          expect((await fallback).ok()).toBe(true);
        }
        await expect.poll(async () => (await readTable(alice.page, slug)).engine!.prompt?.context?.type).toBe("action");
      });
    }

    // The current engine settles this path by auto-passing the open action prompt.
    // Own-turn surrender while another seat owns a chain prompt is covered below.
    test(`current engine: ${format}: own action-prompt surrender auto-passes and hands off to the next live seat`, async ({ player }, info) => {
      const seats = await humans(player, format);
      const { slug } = await startTable(seats, `${format} immediate own-turn surrender`, seats.map(normalDeck), { ...options, format });
      const alice = seats[0]!;
      const nextSeat = format === "ffa4" ? 2 : 1;
      if (format === "ffa4") {
        await surrender(seats[1]!.page);
        expect(viewSeat(await readTable(alice.page, slug), 1)).toMatchObject({ eliminated: false, pendingElimination: true });
      }
      const posts = actionPosts(alice.page, slug);
      const response = alice.page.waitForResponse(reply => reply.url().endsWith(`/api/duels/${slug}/surrender`) && reply.request().method() === "POST");
      await surrender(alice.page);
      const accepted = await (await response).json() as DuelRoom;
      await evidence(seats[1]!.page, slug, info, "immediate-own-turn-acceptance", [accepted]);
      expect(viewSeat(accepted, 0).eliminated).toBe(true);
      expect(viewSeat(accepted, 0).pendingElimination).not.toBe(true);
      expect(accepted.engine).toMatchObject({ turn: 2, turnSeat: nextSeat });
      expect(accepted.engine!.prompt).toBeNull();
      if (format === "ffa4") expect(viewSeat(accepted, 1).eliminated).toBe(true);
      await expectAutoSpectating(alice.page, slug);
      expect(posts.count).toBe(0);
    });

    test(`current engine: ${format}: surrender at an offered chain response auto-passes without a browser answer`, async ({ player }, info) => {
      const seats = await humans(player, format);
      const [alice, bob] = seats as [Seat, Seat, ...Seat[]];
      const { slug } = await startTable(seats, `${format} auto-pass Leaving response`, [
        { main: withFiller(["Pot of Greed"], 40) },
        { main: withFiller(["Ash Blossom & Joyous Spring"], 40) }, ...seats.slice(2).map(normalDeck),
      ], { ...options, format });
      await expectRealCore(alice.page, slug, "practice", info, 0);
      const posts = actionPosts(bob.page, slug);
      await useCard(alice.page, handCard(alice.page, "Pot of Greed"), "Activate");
      await pickLegalZone(alice.page, "st");
      await expect(bob.page.locator("[data-prompt-panel]").getByRole("button", { name: "No", exact: true })).toBeVisible();
      const offered = await readTable(bob.page, slug);
      expect(offered.engine!.prompt).toMatchObject({ seat: 1, context: { type: "chain" } });
      expect(offered.engine!.prompt!.options.some(option => option.card?.name === "Ash Blossom & Joyous Spring")).toBe(true);
      await surrender(bob.page);
      await expect.poll(async () => (await readTable(alice.page, slug)).engine!.prompt?.context?.type).toBe("action");
      const after = await readTable(alice.page, slug);
      expect(after.engine).toMatchObject({ turn: 1, turnSeat: 0, chain: [] });
      expect(viewSeat(after, 1).eliminated).toBe(true);
      expect(viewSeat(after, 0).hand).toHaveLength(viewSeat(offered, 0).hand.length + 2);
      expect(after.engine!.log.some(entry => entry.text === "Player 1 drew 2 card(s)")).toBe(true);
      await expectAutoSpectating(bob.page, slug);
      expect(posts.count).toBe(0);
      const log = await evidence(alice.page, slug, info, "Leaving-response-auto-passed", [offered, after]);
      expect(log.some(entry => entry.promptId === offered.engine!.prompt!.id && entry.promptSeat === 1 && entry.promptType === "chain")).toBe(true);
    });

    for (const reason of ["LP", "deck-out"] as const) {
      test(`${format}: ${reason} elimination automatically spectates without a choice panel`, async ({ player }, info) => {
        const seats = await humans(player, format);
        const alice = seats[0]!, loser = seats[1]!;
        const decks = reason === "LP"
          ? [{ main: withFiller(["Hinotama", "Hinotama"], 40) }, ...seats.slice(1).map(normalDeck)]
          : [normalDeck(), { main: Array(5).fill(FILLER) as string[] }, ...seats.slice(2).map(normalDeck)];
        const { slug } = await startTable(seats, `${format} automatic ${reason} spectator`, decks,
          { ...options, format, ...(reason === "LP" ? { startingLP: 1000 } : {}) });
        const posts = actionPosts(loser.page, slug);
        if (reason === "LP") {
          for (const lp of [500, 0]) {
            await useCard(alice.page, handCard(alice.page, "Hinotama"), "Activate");
            await pickLegalZone(alice.page, "st");
            await expect.poll(async () => (await readTable(alice.page, slug)).engine!.prompt?.context?.type).toBe("opponent");
            await alice.page.getByTestId("holo-pick-1").click();
            await expect.poll(async () => viewSeat(await readTable(alice.page, slug), 1).lp).toBe(lp);
          }
        } else {
          await alice.page.getByRole("button", { name: "End Turn", exact: true }).click();
        }
        await expect.poll(async () => viewSeat(await readTable(alice.page, slug), 1).eliminated).toBe(true);
        const watched = await expectAutoSpectating(loser.page, slug);
        expect(watched.session.status).toBe("active");
        await loser.page.reload();
        await expectAutoSpectating(loser.page, slug);
        expect(posts.count).toBe(0);
        await evidence(alice.page, slug, info, `${reason}-auto-spectator`, [watched]);
      });
    }
  }

  for (const ownerRule of [false, true]) {
    test(ownerRule
      ? "R-FFA-SURRENDER: a seat already Leaving stays live through later responses while its UI blocks answers"
      : "current engine: a seat already Leaving is eliminated before a later Ash Blossom response can be offered", async ({ player }, info) => {
      const [alice, bob, carol] = await humans(player, "ffa3") as [Seat, Seat, Seat];
      const { slug } = await startTable([alice, bob, carol], "ffa3 later Leaving response", [
        { main: withFiller(["Pot of Greed"], 40) },
        { main: withFiller(["Ash Blossom & Joyous Spring"], 40) }, normalDeck(),
      ], options);
      await expectRealCore(alice.page, slug, "practice", info, 0);
      const before = await readTable(alice.page, slug);
      expect(before.engine!.chain).toHaveLength(0);
      expect(viewSeat(await readTable(bob.page, slug), 1).hand.some(card => card.name === "Ash Blossom & Joyous Spring")).toBe(true);
      await surrender(bob.page);
      const pending = await readTable(alice.page, slug);
      expect(viewSeat(pending, 1)).toMatchObject({ eliminated: false, pendingElimination: true });
      await useCard(alice.page, handCard(alice.page, "Pot of Greed"), "Activate");
      await pickLegalZone(alice.page, "st");
      // The host auto-passes for Leaving seats; their UI cannot answer a response.
      await expect.poll(async () => {
        const prompt = (await readTableTrace(alice.page, slug)).promptLog.at(-1);
        return (prompt?.promptSeat === 0 && prompt.promptType === "action")
          || (prompt?.promptSeat === 1 && prompt.promptType === "chain");
      }).toBe(true);
      const offered = await readTable(alice.page, slug);
      const log = await evidence(alice.page, slug, info, "later-leaving-response-policy", [before, pending, offered]);
      if (ownerRule) {
        await expect(bob.page.locator("[data-table-shell]")).toHaveAttribute("data-can-act", "false");
        await expect(bob.page.locator("[data-prompt-panel]")).toHaveCount(0);
        test.fail(true, "R-COMMON-SURRENDER-EOT pending engine change");
        expect(viewSeat(offered, 1)).toMatchObject({ eliminated: false, pendingElimination: true });
        await expect.poll(async () => (await readTable(alice.page, slug)).engine!.prompt?.context?.type).toBe("action");
        expect(viewSeat(await readTable(alice.page, slug), 1)).toMatchObject({ eliminated: false, pendingElimination: true });
        await endTurn(alice.page, 2);
        const after = await readTable(carol.page, slug);
        expect(after.engine!.turnSeat).toBe(2);
        expect(viewSeat(after, 1).eliminated).toBe(true);
      } else {
        expect(viewSeat(offered, 1).eliminated).toBe(true);
        expect(log.some(entry => entry.promptSeat === 1 && entry.options.some(option => option.card?.name === "Ash Blossom & Joyous Spring"))).toBe(false);
        expect(offered.engine!.prompt?.context?.type).toBe("action");
        expect(offered.engine!.seats[0]!.hand).toHaveLength(before.engine!.seats[0]!.hand.length + 1);
        await expect(bob.page.locator("[data-table-shell]")).toHaveAttribute("data-can-act", "false");
        await expect(bob.page.locator("[data-prompt-panel]")).toHaveCount(0);
      }
    });
  }

  for (const format of ["ffa3", "ffa4"] as const) {
    for (const ownerRule of [false, true]) {
      test(ownerRule ? `${format}: owner rule: own-turn surrender during an open chain hands off immediately`
        : `current engine: ${format}: surrender during an open chain suppresses the flagged duelist's link and eliminates after the chain`, async ({ player }, info) => {
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
        if (ownerRule) {
          await evidence(bob.page, slug, info, "own-turn-open-chain-immediate", [before, pending]);
          test.fail(true, "R-COMMON-SURRENDER-EOT pending engine change");
          expect(viewSeat(pending, 0).eliminated).toBe(true);
          expect(pending.engine).toMatchObject({ turn: 2, turnSeat: 1 });
          await expectAutoSpectating(alice.page, slug);
          return;
        }
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
  }
});
