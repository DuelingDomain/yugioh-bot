import { installOrderedDiceOpening } from "../helpers/dice-opening";
import { test, expect } from "../helpers/fixtures";
import { handCard, pickLegalZone, useCard } from "../helpers/board";
import { createTable, enterDuelRoom, importDeckUploadAndReady, uniqueTableName } from "../helpers/duel";
import { actionAt, castFromHand, chooseEliminationResponse, declineUntil, expectDomainCore, legalDomainUpload, pickEliminationOpponent, recordElimination } from "../helpers/elimination";
import { collectTableErrors, expectRealCore, observeTable, readTable, readTableTrace, startTablePreset, tableField, tableGrave, tableLp, tableLpValue, tableTurns } from "../helpers/table";
import type { DuelEngineView } from "@yugidraft/shared/duels";
import type { Page } from "@playwright/test";

const monsters = (page: Page, seat: number) => tableField(page, seat).locator("[data-kind='mz'][data-occupied='true']");
const spells = (page: Page, seat: number) => tableField(page, seat).locator("[data-kind='st'][data-occupied='true']");
const cardNames = (view: DuelEngineView, seat: number, pile: "monsters" | "graveyard" | "banished" | "spells") =>
  view.seats[seat]![pile].filter(Boolean).map((card) => card!.name);

async function expectOut(page: Page, seat: number): Promise<void> {
  await expect(page.locator(`[data-holo='${seat}']`)).toHaveAttribute("data-status", "eliminated");
  await expect(page.locator(`[data-ring-seat='${seat}']`)).toHaveAttribute("data-status", "eliminated");
  await expect(monsters(page, seat)).toHaveCount(0);
  await expect(spells(page, seat)).toHaveCount(0);
}

async function burnSeat(page: Page, slug: string, seat: number): Promise<void> {
  await castFromHand(page, slug, "Hinotama");
  await pickEliminationOpponent(page, slug, seat);
}

async function endWithWindows(page: Page, slug: string, turn: number): Promise<void> {
  await declineUntil(page, slug, actionAt());
  await page.getByRole("button", { name: "End Turn", exact: true }).click();
  await declineUntil(page, slug, actionAt(turn));
}

function firstActions(log: Awaited<ReturnType<typeof readTableTrace>>["promptLog"]): number[][] {
  const seen = new Set<number>();
  return log.filter((entry) => entry.promptType === "action" && !seen.has(entry.turn) && seen.add(entry.turn))
    .map((entry) => [entry.turn, entry.turnSeat]);
}

test.describe("FFA3 elimination, Domain and UI rule gaps", () => {
  test("R-FFA-ELIMINATION: the eliminated owner's monster leaves another duelist's field; LP and clockwise UI stay independent", async ({ player }, info) => {
    const { page } = await player("p1");
    const errors = collectTableErrors(page);
    const slug = await startTablePreset(page, "ffa3-elimination-owned-elsewhere");
    await expectRealCore(page, slug, "scripted", info);
    await observeTable(page);
    await expect(page.locator("[data-lp-seat]")).toHaveCount(3);
    for (const [seat, lp] of [[0, "8,000"], [1, "500"], [2, "8,000"]] as const) await expect(tableLpValue(page, seat)).toHaveText(lp);
    await expect(page.getByTestId("who-pill")).toHaveText("Your turn");
    await castFromHand(page, slug, "Change of Heart");
    await expect(page.getByRole("group", { name: "Select a zone for Gemini Elf", exact: true })).toBeVisible();
    await pickLegalZone(page, "mz");
    await expect.poll(async () => cardNames((await readTable(page, slug)).engine!, 0, "monsters")).toEqual(["Gemini Elf"]);
    const taken = (await readTable(page, slug)).engine!.seats[0]!.monsters.find(Boolean)!;
    expect(taken).toMatchObject({ controller: 0, position: 1 });
    await expect(monsters(page, 0)).toHaveCount(1);
    await expect(monsters(page, 1)).toHaveCount(0);
    await recordElimination(page, slug, info, "owned-card-before-loss");
    await burnSeat(page, slug, 1);
    await expect.poll(async () => (await readTable(page, slug)).engine!.seats[1]!.eliminated).toBe(true);
    const after = (await readTable(page, slug)).engine!;
    expect(after.seats.map((seat) => seat.lp)).toEqual([8000, 0, 8000]);
    for (const seat of [0, 2]) {
      for (const pile of ["monsters", "graveyard", "banished"] as const) expect(cardNames(after, seat, pile)).not.toContain("Gemini Elf");
      expect(after.seats[seat]!.deckCount).toBe(20);
    }
    expect(after.seats[0]!.hand.map((card) => card.name)).not.toContain("Gemini Elf");
    const departed = await readTableTrace(page, slug);
    expect(departed.seats[2]!.view.seats[2]!.hand.map((card) => card.name)).not.toContain("Gemini Elf");
    expect(after.result).toBeNull();
    await expect(monsters(page, 0)).toHaveCount(0);
    await expectOut(page, 1);
    for (const [seat, lp] of [[0, "8,000"], [1, "0"], [2, "8,000"]] as const) await expect(tableLpValue(page, seat)).toHaveText(lp);
    await endWithWindows(page, slug, 3);
    expect(firstActions((await readTableTrace(page, slug)).promptLog)).toEqual([[1, 0], [2, 2], [3, 0]]);
    const painted = await tableTurns(page);
    expect(painted.some((entry) => entry.turn === 2 && entry.seat === 2)).toBe(true);
    expect(painted.some((entry) => entry.turn === 2 && entry.seat === 1)).toBe(false);
    await page.reload();
    await enterDuelRoom(page);
    await expectOut(page, 1);
    await expect(monsters(page, 0)).toHaveCount(0);
    await recordElimination(page, slug, info, "owned-card-left-game");
    expect(errors).toEqual([]);
  });

  for (const adr of [false, true]) {
    test(adr
      ? "R-FFA-RETURN-OWNED-CARDS: a survivor's stolen monster returns to its monster zone with its position kept"
      : "current engine: a survivor's stolen monster goes to its owner's Graveyard when the controller is eliminated", async ({ player }, info) => {
      const { page } = await player("p1");
      const slug = await startTablePreset(page, "ffa3-elimination-return-owned");
      await expectRealCore(page, slug, "scripted", info);
      expect((await readTable(page, slug)).engine!.seats[0]!.monsters.find(Boolean)).toMatchObject({ name: "Gemini Elf", controller: 0, position: 4 });
      await declineUntil(page, slug, actionAt(1));
      await page.getByRole("button", { name: "End Turn", exact: true }).click();
      await declineUntil(page, slug, (view) => view.prompt?.seat === 0 && view.chain.length === 0 && view.seats[1]!.monsters.some((card) => card?.name === "Gemini Elf"));
      expect((await readTable(page, slug)).engine!.seats[1]!.monsters.find(Boolean)).toMatchObject({ name: "Gemini Elf", controller: 1, position: 4 });
      await expect(monsters(page, 0)).toHaveCount(0);
      await expect(monsters(page, 1)).toHaveCount(1);
      await recordElimination(page, slug, info, "survivor-card-before-controller-loss");
      await chooseEliminationResponse(page, slug, "Just Desserts");
      await pickEliminationOpponent(page, slug, 1);
      await declineUntil(page, slug, (view) => view.seats[1]!.eliminated === true);
      const after = (await readTable(page, slug)).engine!;
      await recordElimination(page, slug, info, "survivor-card-after-controller-loss");
      await expectOut(page, 1);
      expect(after.result).toBeNull();
      if (adr) {
        test.fail(true, "R-FFA-RETURN-OWNED-CARDS pending engine change");
        expect(after.seats[0]!.monsters.filter(Boolean)).toEqual([expect.objectContaining({ name: "Gemini Elf", controller: 0, position: 4 })]);
        expect(cardNames(after, 0, "graveyard")).not.toContain("Gemini Elf");
      } else {
        expect(cardNames(after, 0, "monsters")).toEqual([]);
        expect(cardNames(after, 0, "graveyard")).toEqual(expect.arrayContaining(["Gemini Elf", "Just Desserts"]));
        await expect(monsters(page, 0)).toHaveCount(0);
        await expect(tableGrave(page, 0)).toHaveAccessibleName(/ (GY|Graveyard) \(2\)$/);
      }
    });
  }

  for (const adr of [false, true]) {
    test(adr
      ? "R-FFA-RETURN-OWNED-CARDS: an exchanged card returns to its living owner's hand while the loser's card leaves"
      : "current engine: the loser's exchanged card leaves a living hand, but the survivor's card goes to its Graveyard", async ({ player }, info) => {
      const { page } = await player("p1");
      const slug = await startTablePreset(page, "ffa3-elimination-exchanged-hand");
      await expectRealCore(page, slug, "scripted", info);
      await castFromHand(page, slug, "Exchange");
      // The core auto-selects the only rival with cards and its sole card; bot 1 picks Axe Raider.
      await expect.poll(async () => (await readTable(page, slug)).engine!.seats[0]!.hand.map((card) => card.name)).toContain("Celtic Guardian");
      const exchanged = await readTableTrace(page, slug);
      expect(exchanged.seats[1]!.view.seats[1]!.hand.map((card) => card.name)).toEqual(["Axe Raider"]);
      await expect(handCard(page, "Celtic Guardian")).toBeVisible();
      await expect(handCard(page, "Axe Raider")).toHaveCount(0);
      await recordElimination(page, slug, info, "exchanged-cards-before-loss");
      await burnSeat(page, slug, 1);
      await expect.poll(async () => (await readTable(page, slug)).engine!.seats[1]!.eliminated).toBe(true);
      const after = (await readTable(page, slug)).engine!;
      expect(after.seats[0]!.hand.map((card) => card.name)).not.toContain("Celtic Guardian");
      expect(cardNames(after, 0, "graveyard")).not.toContain("Celtic Guardian");
      expect(cardNames(after, 0, "banished")).not.toContain("Celtic Guardian");
      await expect(handCard(page, "Celtic Guardian")).toHaveCount(0);
      await recordElimination(page, slug, info, "exchanged-cards-after-loss");
      await expectOut(page, 1);
      expect(after.result).toBeNull();
      if (adr) {
        test.fail(true, "R-FFA-RETURN-OWNED-CARDS pending engine change");
        expect(after.seats[0]!.hand.map((card) => card.name)).toEqual(["Axe Raider"]);
        expect(cardNames(after, 0, "graveyard")).not.toContain("Axe Raider");
      } else {
        expect(after.seats[0]!.hand).toEqual([]);
        expect(cardNames(after, 0, "graveyard")).toEqual(expect.arrayContaining(["Axe Raider", "Exchange", "Hinotama"]));
        await expect(handCard(page, "Axe Raider")).toHaveCount(0);
        await expect(tableGrave(page, 0)).toHaveAccessibleName(/ (GY|Graveyard) \(3\)$/);
      }
    });
  }

  for (const survives of [false, true]) {
    test(survives
      ? "R-FFA-ELIMINATION control: a living duelist's continuous Swords still prevents an attack"
      : "R-FFA-ELIMINATION: continuous Swords stops immediately and an attack works in the same turn", async ({ player }, info) => {
      const { page } = await player("p1");
      const slug = await startTablePreset(page, `ffa3-elimination-ongoing-${survives ? "control" : "loss"}`);
      await expectRealCore(page, slug, "scripted", info);
      await endWithWindows(page, slug, 4);
      expect(cardNames((await readTable(page, slug)).engine!, 1, "spells")).toEqual(["Swords of Revealing Light"]);
      await burnSeat(page, slug, 1);
      await declineUntil(page, slug, actionAt(4));
      await page.getByRole("button", { name: /^To Battle/ }).click();
      await expect.poll(async () => (await readTable(page, slug)).engine!.prompt?.context).toMatchObject({ type: "action", phase: "battle" });
      const battle = (await readTable(page, slug)).engine!;
      expect(battle.turn).toBe(4);
      expect(battle.seats[1]!.lp).toBe(survives ? 4500 : 0);
      const attacks = battle.prompt!.options.filter((option) => option.id.startsWith("attack:"));
      if (survives) {
        expect(attacks).toEqual([]);
        expect(cardNames(battle, 1, "spells")).toEqual(["Swords of Revealing Light"]);
        await expect(spells(page, 1)).toHaveCount(1);
        await expect(tableLpValue(page, 1)).toHaveText("4,500");
      } else {
        expect(attacks).toHaveLength(1);
        await expectOut(page, 1);
        await useCard(page, monsters(page, 0).locator("button"), "Attack");
        await expect.poll(async () => (await readTable(page, slug)).engine!.seats[2]!.lp).toBe(6100);
        await expect(tableLpValue(page, 2)).toHaveText("6,100");
        expect((await readTable(page, slug)).engine!.turn).toBe(4);
      }
      await recordElimination(page, slug, info, survives ? "living-swords-control" : "ongoing-stops-same-turn");
    });
  }

  test("R-FFA-ELIMINATION: an empty Deck stays live until a required draw eliminates only that seat", async ({ player }, info) => {
    const { page } = await player("p1");
    const slug = await startTablePreset(page, "ffa3-elimination-deck-out");
    await expectRealCore(page, slug, "scripted", info);
    await observeTable(page);
    await endWithWindows(page, slug, 4);
    const empty = (await readTableTrace(page, slug)).promptLog.filter((entry) => entry.turn === 2 && entry.promptType === "action");
    expect(empty.some((entry) => entry.seats[1]!.deckCount === 0)).toBe(true);
    const alive = (await readTable(page, slug)).engine!;
    expect(alive.seats[1]!.deckCount).toBe(0);
    expect(alive.seats[1]!.eliminated).not.toBe(true);
    await expect(page.locator("[data-holo='1']")).not.toHaveAttribute("data-status", "eliminated");
    await recordElimination(page, slug, info, "empty-deck-before-must-draw");
    await endWithWindows(page, slug, 7);
    const after = (await readTable(page, slug)).engine!;
    expect(after.seats.map((seat) => seat.eliminated === true)).toEqual([false, true, false]);
    expect(after.seats.map((seat) => seat.lp)).toEqual([8000, 8000, 8000]);
    expect(after.result).toBeNull();
    const log = (await readTableTrace(page, slug)).promptLog;
    expect(firstActions(log)).toEqual([[1, 0], [2, 1], [3, 2], [4, 0], [6, 2], [7, 0]]);
    expect(log.filter((entry) => entry.turn === 5 && entry.promptType === "action")).toEqual([]);
    await expectOut(page, 1);
    for (const seat of [0, 1, 2]) await expect(tableLpValue(page, seat)).toHaveText("8,000");
    await expect(page.getByTestId("who-pill")).toHaveText("Your turn");
    await expect(page.locator("[data-arc='0'][data-lit='true']")).toHaveCount(1);
    await recordElimination(page, slug, info, "deck-out-only-one-seat");
  });

  test("R-FFA-ELIMINATION: a turn cut short by its duelist's loss starts the next live seat and expires Steelcage", async ({ player }, info) => {
    const { page } = await player("p1");
    const slug = await startTablePreset(page, "ffa3-elimination-cut-turn");
    await expectRealCore(page, slug, "scripted", info);
    await observeTable(page);
    await castFromHand(page, slug, "Nightmare's Steelcage");
    await expect.poll(async () => cardNames((await readTable(page, slug)).engine!, 0, "spells")).toEqual(["Nightmare's Steelcage"]);
    await endWithWindows(page, slug, 4);
    const after = (await readTable(page, slug)).engine!;
    expect(after.seats.map((seat) => seat.eliminated === true)).toEqual([false, false, true]);
    expect(after.seats.map((seat) => seat.lp)).toEqual([7000, 7000, 0]);
    expect(cardNames(after, 0, "spells")).toEqual([]);
    expect(cardNames(after, 0, "graveyard")).toContain("Nightmare's Steelcage");
    expect(firstActions((await readTableTrace(page, slug)).promptLog)).toEqual([[1, 0], [2, 1], [3, 2], [4, 0]]);
    await expectOut(page, 2);
    await expect(spells(page, 0)).toHaveCount(0);
    await expect(tableLpValue(page, 0)).toHaveText("7,000");
    await expect(tableLpValue(page, 1)).toHaveText("7,000");
    await expect(page.getByTestId("who-pill")).toHaveText("Your turn");
    await expect(page.locator("[data-arc='0'][data-lit='true']")).toHaveCount(1);
    await recordElimination(page, slug, info, "cut-turn-and-counter");
  });

  for (const survives of [false, true]) {
    test(survives
      ? "R-FFA-ELIMINATION control: a living duelist's open Heavy Storm link resolves"
      : "R-FFA-ELIMINATION: a duelist eliminated mid-chain has its already-open Heavy Storm link resolve without effect", async ({ player }, info) => {
      const { page } = await player("p1");
      const slug = await startTablePreset(page, `ffa3-elimination-chain-${survives ? "control" : "loss"}`);
      await expectRealCore(page, slug, "scripted", info);
      await declineUntil(page, slug, actionAt(1));
      await page.getByRole("button", { name: "End Turn", exact: true }).click();
      await declineUntil(page, slug, (view) => view.prompt?.seat === 0 && view.chain.some((link) => link.name === "Heavy Storm"));
      const open = (await readTable(page, slug)).engine!;
      expect(open.turnSeat).toBe(1);
      expect(open.chain.map((link) => link.seat)).toEqual([1]);
      await expect(page.getByRole("list", { name: "Current chain" }).getByRole("listitem")).toHaveCount(1);
      await chooseEliminationResponse(page, slug, "Just Desserts");
      await pickEliminationOpponent(page, slug, 1);
      await expect.poll(async () => (await readTable(page, slug)).engine!.chain.map((link) => link.seat)).toEqual([1, 0]);
      await recordElimination(page, slug, info, "chain-before-lethal-response");
      await declineUntil(page, slug, (view) => view.chain.length === 0 && (survives ? view.seats[1]!.lp === 7500 : view.seats[1]!.eliminated === true));
      const after = (await readTable(page, slug)).engine!;
      expect(after.seats[1]!.lp).toBe(survives ? 7500 : 0);
      expect(cardNames(after, 2, "spells")).toEqual(survives ? [] : ["Burden of the Mighty"]);
      expect(cardNames(after, 2, "graveyard")).toEqual(survives ? ["Burden of the Mighty"] : []);
      await expect(spells(page, 2)).toHaveCount(survives ? 0 : 1);
      if (!survives) await expectOut(page, 1);
      expect(after.result).toBeNull();
      await recordElimination(page, slug, info, survives ? "living-link-resolved" : "eliminated-link-no-effect");
    });
  }

  test("R-FFA-ELIMINATION control: a living Dust Tornado destroys its target in the same chain setup", async ({ player }, info) => {
    const { page } = await player("p1");
    const slug = await startTablePreset(page, "ffa3-elimination-pending-chain-control");
    await expectRealCore(page, slug, "scripted", info);
    await castFromHand(page, slug, "Pot of Greed");
    await expect.poll(async () => (await readTable(page, slug)).engine!.chain.map((link) => link.seat)).toEqual([0, 1]);
    await declineUntil(page, slug, (view) => view.chain.length === 0 && view.seats[0]!.hand.length === 2);
    const after = (await readTable(page, slug)).engine!;
    expect(after.seats[1]!.eliminated).not.toBe(true);
    expect(cardNames(after, 0, "spells")).toEqual(["Jar of Greed"]);
    expect(cardNames(after, 0, "graveyard")).toEqual(expect.arrayContaining(["Burden of the Mighty", "Pot of Greed"]));
    expect(after.seats[0]!.monsters.find(Boolean)).toMatchObject({ name: "Gemini Elf", attack: 1500 });
    await expect(spells(page, 0)).toHaveCount(1);
    await recordElimination(page, slug, info, "living-dust-tornado-control");
  });

  for (const adr of [true]) {
    test(adr
      ? "R-COMMON-SURRENDER-EOT: a surrender keeps cards until its open Dust Tornado link resolves"
      : "current engine: another chain link eliminates the surrendered seat early, and its Dust Tornado has no effect", async ({ player }, info) => {
      const { page } = await player("p1");
      const slug = await startTablePreset(page, "ffa3-elimination-pending-chain");
      await expectRealCore(page, slug, "scripted", info);
      expect((await readTable(page, slug)).engine!.seats[0]!.monsters.find(Boolean)).toMatchObject({ name: "Gemini Elf", attack: 1500 });
      await castFromHand(page, slug, "Pot of Greed");
      await expect.poll(async () => (await readTable(page, slug)).engine!.chain.map((link) => link.seat)).toEqual([0, 1]);
      await recordElimination(page, slug, info, "surrender-open-link");
      // Pass the turn-player window; bot 1 now has its guaranteed second Dust Tornado window and gives up.
      const no = page.locator("[data-prompt-panel]").getByRole("button", { name: "No", exact: true });
      const pass = page.locator("[data-prompt-panel]").getByRole("button", { name: /^Pass/ });
      await expect(no.or(pass)).toBeVisible();
      await (await no.isVisible() ? no : pass).click();
      await expect.poll(async () => (await readTable(page, slug)).engine!.chain.map((link) => link.seat)).toEqual([0, 1, 2]);
      const flagged = (await readTable(page, slug)).engine!;
      expect(flagged.chain.map((link) => link.seat)).toEqual([0, 1, 2]);
      // Seat 2's new link holds a human response window. Capture the engine's actual state
      // here: the ADR requires a pending loss, with cards and continuous effects still present.
      await recordElimination(page, slug, info, "surrender-state-with-three-links-open");
      await declineUntil(page, slug, (view) => view.chain.length === 0 && view.seats[1]!.eliminated === true);
      const after = (await readTable(page, slug)).engine!;
      expect(cardNames(after, 0, "spells")).toEqual(["Jar of Greed"]);
      expect(after.seats[0]!.hand).toHaveLength(2);
      expect(cardNames(after, 0, "graveyard")).toEqual(["Burden of the Mighty", "Pot of Greed"]);
      expect(after.seats[0]!.monsters.find(Boolean)).toMatchObject({ name: "Gemini Elf", attack: 1900 });
      await expectOut(page, 1);
      await expect(spells(page, 0)).toHaveCount(1);
      await recordElimination(page, slug, info, "flagged-link-no-effect");
      if (adr) {
        expect({
          pending: flagged.seats[1]!.pendingElimination === true,
          eliminated: flagged.seats[1]!.eliminated === true,
          monsters: cardNames(flagged, 1, "monsters"),
          survivorAttack: flagged.seats[0]!.monsters.find(Boolean)!.attack,
        }).toEqual({ pending: true, eliminated: false, monsters: ["Gemini Elf"], survivorAttack: 1500 });
      }
    });
  }

  test("R-FFA-WINNER: the last two duelists reach zero LP together and the persisted result screen says DRAW with no winner", async ({ player }, info) => {
    const { page } = await player("p1");
    const slug = await startTablePreset(page, "ffa3-elimination-last-two-draw");
    await expectRealCore(page, slug, "scripted", info);
    await burnSeat(page, slug, 2);
    await declineUntil(page, slug, actionAt(1));
    const lastTwo = (await readTable(page, slug)).engine!;
    expect(lastTwo.seats.map((seat) => seat.eliminated === true)).toEqual([false, false, true]);
    expect(lastTwo.seats.map((seat) => seat.lp)).toEqual([1000, 1000, 0]);
    await recordElimination(page, slug, info, "last-two-before-simultaneous-loss");
    await useCard(page, spells(page, 0).locator("button"), "Activate");
    await expect.poll(async () => (await readTable(page, slug)).session.status).toBe("completed");
    const result = await readTable(page, slug);
    expect(result.engine!.seats.map((seat) => seat.lp)).toEqual([0, 0, 0]);
    expect(result.engine!.seats.map((seat) => seat.eliminated === true)).toEqual([true, true, true]);
    expect(result.engine!.result?.winnerSeat).toBeNull();
    expect(result.engine!.eliminationOrder).toEqual([[2], [0, 1]]);
    expect(result.session.winnerSeat).toBeNull();
    expect(result.session.winnerPlayerId).toBeNull();
    const screen = page.getByTestId("duel-result");
    await expect(screen).toHaveAttribute("data-outcome", "draw");
    await expect(screen).toContainText("DRAW");
    await page.reload();
    await enterDuelRoom(page);
    await expect(screen).toHaveAttribute("data-outcome", "draw");
    await expect(screen).toContainText("DRAW");
    const restored = (await readTable(page, slug)).engine!;
    expect(restored.result?.winnerSeat).toBeNull();
    expect(restored.eliminationOrder).toEqual([[2], [0, 1]]);
    await recordElimination(page, slug, info, "simultaneous-draw-persisted");
  });

  test("Domain FFA3: a legal singleton deck starts on the Domain core with three Deck Masters; the human summons and reloads", async ({ player }, info) => {
    const { page } = await player("p1");
    const slug = await createTable(page, uniqueTableName("ffa3 Domain smoke"), { domain: true, format: "ffa3", ordered: true, noBanlist: true });
    await importDeckUploadAndReady(page, legalDomainUpload(), 60);
    for (const count of [2, 3]) {
      await page.getByRole("button", { name: /^Add bot/ }).first().click();
      await expect.poll(async () => (await readTable(page, slug)).session.seats.length).toBe(count);
    }
    await expect(page.getByRole("button", { name: /^Start duel/ })).toBeEnabled();
    await installOrderedDiceOpening(page, slug);
    await page.getByRole("button", { name: /^Start duel/ }).click();
    await enterDuelRoom(page);
    await expectDomainCore(page, slug, info);
    const room = await readTable(page, slug);
    expect(room.session.mode).toBe("domain");
    expect(room.session.format).toBe("ffa3");
    expect(room.session.settings.validateDeck).toBe(true);
    expect(room.engine!.seats.map((seat) => seat.deckMaster?.inZone)).toEqual([true, true, true]);
    expect(room.engine!.seats.map((seat) => seat.deckMaster?.card.name)).toEqual(["Axe Raider", "Axe Raider", "Axe Raider"]);
    await expect(page.locator("[data-master-dock='0']")).toHaveCount(1);
    for (const seat of [1, 2]) {
      await expect(page.locator(`[data-master-thumb='${seat}']`)).toHaveCount(1);
      await expect(page.locator(`[data-master-thumb='${seat}']`)).toHaveAccessibleName(/Master: Axe Raider$/);
    }
    await page.getByRole("button", { name: "Normal Summon Axe Raider", exact: true }).click();
    await pickLegalZone(page, "mz");
    await expect.poll(async () => (await readTable(page, slug)).engine!.seats[0]!.deckMaster?.inZone).toBe(false);
    expect(cardNames((await readTable(page, slug)).engine!, 0, "monsters")).toEqual(["Axe Raider"]);
    await expect(monsters(page, 0)).toHaveCount(1);
    await page.reload();
    await enterDuelRoom(page);
    await expect(monsters(page, 0)).toHaveCount(1);
    await expect(page.getByRole("complementary", { name: "Deck Masters" })).toContainText("On field");
    await recordElimination(page, slug, info, "domain-ffa3-master-summon-persisted");
  });
});
