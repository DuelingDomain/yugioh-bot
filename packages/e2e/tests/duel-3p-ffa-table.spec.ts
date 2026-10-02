import { test, expect } from "../helpers/fixtures";
import { activateSingleResponse, attackWithFirstMonster, endTurn, expectReadyToAct, handCard, pickLegalZone, startTable, turnLabel, useCard } from "../helpers/board";
import { FILLER, withFiller } from "../helpers/decks";
import { enterDuelRoom, openOptions, surrender } from "../helpers/duel";
import { decide } from "../helpers/multi";
import { actionPosts, answerTable, collectTableErrors, expectRealCore, observeTable, readTable, readTableTrace, startTablePreset, tableField, tableGrave, tableLp, tableLpValue, tableShot, tableTurns } from "../helpers/table";
import type { DuelEngineView } from "@yugidraft/shared/duels";
import type { Page } from "@playwright/test";

const options = { ordered: true, looseDecks: true, noBanlist: true, format: "ffa3" as const, bots: [1, 2] };
const battle = (page: Page) => page.getByRole("button", { name: /^To Battle/ });
const occupied = (page: Page, seat: number) => tableField(page, seat).locator("[data-kind='mz'][data-occupied='true']");

async function attackNext(page: Page, sequence: number): Promise<void> {
  await expectReadyToAct(page);
  await useCard(page, tableField(page, 0).locator(`[data-zones='0:4:${sequence}'] button`), "Attack");
}

test.describe("FFA3 real-engine table rules", () => {
  test("current engine: mounts three own-EMZ fields, draws first, and has no BP on turns 1-3", async ({ player }, info) => {
    const alice = await player("p1");
    const errors = collectTableErrors(alice.page);
    const { slug } = await startTable([alice], "ffa3 first round", [{ main: withFiller([FILLER], 40) }], options);
    await expectRealCore(alice.page, slug, "practice", info);
    const room = await readTable(alice.page, slug);
    expect(room.session.mode).toBe("normal");
    expect(room.session.seats.map((seat) => seat.isBot)).toEqual([false, true, true]);
    await expect(alice.page.locator("[data-table-stage='ffa3'] [data-seat-field]")).toHaveCount(3);
    await expect(alice.page.locator("[data-lp-seat]")).toHaveCount(3);
    expect(room.engine!.seats.map((seat) => seat.lp)).toEqual([8000, 8000, 8000]);
    for (const seat of [0, 1, 2]) {
      await expect(tableLp(alice.page, seat)).toHaveCount(1);
      await expect(tableLpValue(alice.page, seat)).toHaveText("8,000");
      const emz = tableField(alice.page, seat).locator("[data-kind='emz']");
      await expect(emz).toHaveCount(2);
      expect(await emz.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-zones")))).toEqual([`${seat}:4:5`, `${seat}:4:6`]);
    }
    const first = (await readTableTrace(alice.page, slug)).promptLog.find((entry) => entry.turn === 1 && entry.promptType === "action");
    expect(first, "first turn-1 action prompt must be recorded").toBeDefined();
    expect(first!.seats[0]).toMatchObject({ handCount: 6, deckCount: 34 });
    expect(room.engine!.seats[0]!.hand).toHaveLength(6);
    expect(room.engine!.seats[0]!.deckCount).toBe(34);
    await expect(alice.page.locator("[data-holo='0'] [title='Cards in hand']")).toHaveText("6");
    await expect(alice.page.locator("[data-holo='0'] [title='Cards in Deck']")).toHaveText("34");
    await observeTable(alice.page);
    await useCard(alice.page, handCard(alice.page, FILLER), "Normal Summon");
    await pickLegalZone(alice.page, "mz");
    await expect(battle(alice.page)).toHaveCount(0);
    await endTurn(alice.page, 4);
    const traces = (await readTableTrace(alice.page, slug)).promptLog;
    await expectReadyToAct(alice.page);
    await expect(battle(alice.page)).toBeEnabled();
    const seen = await tableTurns(alice.page);
    await info.attach("clockwise-first-round", { body: JSON.stringify({ seen, traces }, null, 2), contentType: "application/json" });
    for (const [turn, seat] of [[1, 0], [2, 1], [3, 2], [4, 0]]) {
      const name = seat === 0 ? "Your turn" : `${room.session.seats[seat]!.displayName} (seat ${seat + 1})'s turn`;
      const painted = seen.filter((entry) => entry.turn === turn);
      expect(painted.length, `browser painted turn ${turn}`).toBeGreaterThan(0);
      expect(painted.every((entry) => entry.seat === seat && entry.who === name)).toBe(true);
      const engineTurns = traces.filter((entry) => entry.turn === turn && entry.turnSeat === seat && entry.promptType === "action");
      expect(engineTurns.length, `engine action prompt on turn ${turn}`).toBeGreaterThan(0);
      expect(engineTurns.every((entry) => entry.options.some((option) => option.id === "to_bp") === (turn >= 4))).toBe(true);
    }
    expect(seen.filter((entry) => entry.turn <= 3).every((entry) => !entry.battleOffered)).toBe(true);
    await tableShot(alice.page, slug, info, "first-round-complete");
    expect(errors).toEqual([]);
  });

  test("R-FFA-NO-ATTACK: last duelist gets Battle Phase on turn 3", async ({ player }, info) => {
    const alice = await player("p1");
    const { slug } = await startTable([alice], "ffa3 ADR battle window", [{ main: withFiller([FILLER], 40) }], options);
    await expectRealCore(alice.page, slug, "practice", info);
    await endTurn(alice.page, 4);
    const log = (await readTableTrace(alice.page, slug)).promptLog;
    const actions = log.filter((entry) => entry.promptType === "action" && entry.turn <= 3);
    expect(actions.map((entry) => entry.turn)).toEqual(expect.arrayContaining([1, 2, 3]));
    for (const turn of [1, 2]) expect(actions.filter((entry) => entry.turn === turn).every((entry) => !entry.options.some((option) => option.id === "to_bp"))).toBe(true);
    test.fail(true, "R-FFA-NO-ATTACK pending engine change");
    expect(actions.filter((entry) => entry.turn === 3).some((entry) => entry.options.some((option) => option.id === "to_bp"))).toBe(true);
  });

  test("Dark Hole clears every field including self, then a direct attack damages only the picked rival after reload", async ({ player }, info) => {
    const alice = await player("p1");
    const errors = collectTableErrors(alice.page);
    const { slug } = await startTable([alice], "ffa3 direct", [{ main: withFiller(["Dark Hole", FILLER, FILLER], 40) }], options);
    await expectRealCore(alice.page, slug, "practice", info);
    await useCard(alice.page, handCard(alice.page, FILLER), "Normal Summon");
    await pickLegalZone(alice.page, "mz");
    await endTurn(alice.page, 4);
    for (const seat of [1, 2]) await expect(occupied(alice.page, seat)).toHaveCount(1);
    await useCard(alice.page, handCard(alice.page, "Dark Hole"), "Activate");
    await pickLegalZone(alice.page, "st");
    for (const seat of [0, 1, 2]) await expect(occupied(alice.page, seat)).toHaveCount(0);
    expect((await readTable(alice.page, slug)).engine!.seats.map((seat) => seat.monsters.filter(Boolean).length)).toEqual([0, 0, 0]);
    expect((await readTable(alice.page, slug)).engine!.seats[0]!.graveyard.map((card) => card.name)).toContain(FILLER);
    await useCard(alice.page, handCard(alice.page, FILLER), "Normal Summon");
    await pickLegalZone(alice.page, "mz");
    await alice.page.reload();
    await enterDuelRoom(alice.page);
    await expect(occupied(alice.page, 0)).toHaveCount(1);
    await expect(turnLabel(alice.page)).toHaveText("Turn 4");
    await expect(alice.page.getByTestId("who-pill")).toHaveText("Your turn");
    await expect(alice.page.locator("[data-arc='0'][data-lit='true']")).toHaveCount(1);
    await attackWithFirstMonster(alice.page);
    for (const seat of [1, 2]) await expect(alice.page.getByTestId(`holo-pick-${seat}`)).toBeVisible();
    await expect(alice.page.getByTestId("holo-pick-0")).toHaveCount(0);
    const before = (await readTable(alice.page, slug)).engine!;
    expect(before.prompt!.options.map((option) => option.controller)).toEqual([1, 2]);
    await tableShot(alice.page, slug, info, "direct-seat-choice");
    const posts = actionPosts(alice.page, slug);
    await alice.page.getByTestId("holo-pick-2").click();
    expect(posts.count, "choosing a rival must not POST").toBe(0);
    await alice.page.getByTestId("aim-confirm").click();
    await expect.poll(() => posts.count).toBe(1);
    await expect(tableLpValue(alice.page, 2)).toHaveText("6,000");
    await expect(tableLpValue(alice.page, 1)).toHaveText("8,000");
    for (const untouched of [0, 1]) await expect(tableLp(alice.page, untouched).locator("[data-damage-chip]")).toHaveCount(0);
    expect((await readTable(alice.page, slug)).engine!.seats.map((seat) => seat.lp)).toEqual([8000, 8000, 6000]);
    await tableShot(alice.page, slug, info, "direct-damage");
    expect(errors).toEqual([]);
  });

  test("a monster attack offers targets from both rivals and hits the selected rival", async ({ player }, info) => {
    const alice = await player("p1");
    const errors = collectTableErrors(alice.page);
    const slug = await startTablePreset(alice.page, "ffa3-table-battle");
    await expectRealCore(alice.page, slug, "scripted", info);
    await endTurn(alice.page, 4);
    await attackWithFirstMonster(alice.page);
    const before = (await readTable(alice.page, slug)).engine!;
    expect(before.prompt!.options.map((option) => option.controller)).toEqual([1, 2]);
    for (const seat of [1, 2]) await expect(tableField(alice.page, seat).locator("[data-kind='mz'][data-legal='true']")).toHaveCount(1);
    await tableShot(alice.page, slug, info, "monster-targets");
    const posts = actionPosts(alice.page, slug);
    await tableField(alice.page, 2).locator("[data-kind='mz'][data-legal='true'] button").click();
    expect(posts.count, "choosing a monster must not POST").toBe(0);
    await alice.page.locator("[data-attack-confirm] [data-go]").click();
    await expect.poll(() => posts.count).toBe(1);
    await expect(occupied(alice.page, 2)).toHaveCount(0);
    await expect(occupied(alice.page, 1)).toHaveCount(1);
    await expect(tableLpValue(alice.page, 2)).toHaveText("4,400");
    await expect(tableLpValue(alice.page, 1)).toHaveText("3,000");
    await expect(tableLp(alice.page, 1).locator("[data-damage-chip]")).toHaveCount(0);
    expect((await readTable(alice.page, slug)).engine!.seats.map((seat) => seat.lp)).toEqual([8000, 3000, 4400]);
    expect(errors).toEqual([]);
  });

  test("Mind Crush shows table opponent choices and affects only the chosen seat", async ({ player }, info) => {
    const alice = await player("p1");
    const errors = collectTableErrors(alice.page);
    const slug = await startTablePreset(alice.page, "ffa3-mind-crush-pick");
    await expectRealCore(alice.page, slug, "scripted", info);
    // Debug.AddCard sets a trap on turn 1; it becomes usable on the next turn.
    await endTurn(alice.page, 2);
    await activateSingleResponse(alice.page);
    for (const seat of [1, 2]) await expect(alice.page.getByTestId(`holo-pick-${seat}`)).toBeVisible();
    await expect(alice.page.getByTestId("holo-pick-0")).toHaveCount(0);
    const before = (await readTable(alice.page, slug)).engine!;
    expect(before.prompt!.context?.type).toBe("opponent");
    expect(before.prompt!.options.map((option) => option.controller)).toEqual([1, 2]);
    await alice.page.getByTestId("holo-pick-2").click();
    await alice.page.getByLabel("Search card name").fill("Sangan");
    await alice.page.locator("#announce-card ~ ul button").filter({ hasText: /^Sangan$/ }).click();
    await expect.poll(async () => (await readTable(alice.page, slug)).engine!.seats[2]!.graveyard.map((card) => card.name)).toContain("Sangan");
    // Bots can draw again before the browser assertion. Check card identity in each owner's
    // real view, not a transient hand count that another turn can change.
    const after = await readTableTrace(alice.page, slug);
    expect(after.seats[2]!.view.seats[2]!.hand.map((card) => card.name)).not.toContain("Sangan");
    expect(after.seats[1]!.view.seats[1]!.hand.map((card) => card.name)).toContain("Sangan");
    expect(after.seats[1]!.view.seats[1]!.graveyard).toHaveLength(0);
    await expect(tableGrave(alice.page, 1)).toHaveAccessibleName(/ (GY|Graveyard) \(0\)$/);
    await expect(tableGrave(alice.page, 2)).toHaveAccessibleName(/ (GY|Graveyard) \(1\)$/);
    await tableGrave(alice.page, 2).hover();
    await tableField(alice.page, 2).getByRole("button", { name: /^Open .* (GY|Graveyard)$/ }).click();
    const grave = alice.page.getByRole("dialog", { name: / (GY|Graveyard)$/ });
    await expect(grave.getByRole("button", { name: /^Sangan/ }).first()).toBeVisible();
    await alice.page.keyboard.press("Escape");
    expect(errors).toEqual([]);
  });

  test("the chain panel follows clockwise responders and the human response window resolves", async ({ player }, info) => {
    const alice = await player("p1");
    const errors = collectTableErrors(alice.page);
    const slug = await startTablePreset(alice.page, "ffa3-table-chain");
    await expectRealCore(alice.page, slug, "scripted", info);
    // Decline any empty-chain response window before Main Phase 1.
    let view: DuelEngineView;
    for (;;) {
      await expect.poll(async () => {
        view = (await readTable(alice.page, slug)).engine!;
        return view.prompt?.seat;
      }).toBe(0);
      if (view!.prompt!.options.some((option) => option.id.startsWith("activate:") && option.card?.name === "Heavy Storm")) break;
      const id = view!.prompt!.id;
      await answerTable(alice.page, slug, view!, decide(view!.prompt!, { wants: [] }).answer);
      await expect.poll(async () => (await readTable(alice.page, slug)).engine!.prompt?.id).not.toBe(id);
    }
    await useCard(alice.page, handCard(alice.page, "Heavy Storm"), "Activate");
    await pickLegalZone(alice.page, "st");
    const priority = alice.page.locator("[data-chain-fx] [data-testid='priority-chips'] [data-seat]");
    await expect.poll(async () => (await readTable(alice.page, slug)).engine!.chain.map((link) => link.seat)).toEqual([0, 1]);
    await expect(priority).toHaveCount(3);
    for (const chip of await priority.all()) await expect(chip).toBeVisible();
    expect(await priority.evaluateAll((nodes) => nodes.every((node) => {
      const box = node.getBoundingClientRect();
      const panel = node.closest("ol")!.getBoundingClientRect();
      return box.left >= panel.left && box.right <= panel.right;
    })), "Every responder must fit inside the chain panel").toBe(true);
    await expect(alice.page.locator("[data-chain-fx] [data-testid='priority-chips'] [data-seat='0']")).toHaveAttribute("data-now", "true");
    expect(await priority.evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("data-seat"))))).toEqual([0, 1, 2]);
    await expect(alice.page.locator("[data-prompt-panel]").getByRole("button", { name: "No", exact: true })).toBeVisible();
    await tableShot(alice.page, slug, info, "chain-first-response");
    await alice.page.locator("[data-prompt-panel]").getByRole("button", { name: "No", exact: true }).click();
    await expect.poll(async () => (await readTable(alice.page, slug)).engine!.chain.map((link) => link.seat)).toEqual([0, 1, 2]);
    await expect(alice.page.getByRole("list", { name: "Current chain" }).getByRole("listitem")).toHaveCount(3);
    await expect(alice.page.locator("[data-chain-fx] [data-testid='priority-chips'] [data-seat='0']")).toHaveAttribute("data-now", "true");
    await tableShot(alice.page, slug, info, "chain-clockwise");
    await activateSingleResponse(alice.page);
    await expect(tableField(alice.page, 2).locator("[data-kind='st'][data-legal='true']")).toHaveCount(1);
    await expectReadyToAct(alice.page);
    await tableField(alice.page, 2).locator("[data-kind='st'][data-legal='true'] button").click();
    await expect.poll(async () => (await readTable(alice.page, slug)).engine!.seats.map((seat) => seat.spells.filter(Boolean).length)).toEqual([0, 0, 0]);
    expect((await readTable(alice.page, slug)).engine!.seats[0]!.graveyard.map((card) => card.name)).toContain("Mystical Space Typhoon");
    expect(errors).toEqual([]);
  });

  test("LP elimination clears cards, survives reload, skips the out seat, and restores all three placings", async ({ player }, info) => {
    const alice = await player("p1");
    const errors = collectTableErrors(alice.page);
    const slug = await startTablePreset(alice.page, "ffa3-table-battle");
    await endTurn(alice.page, 4);
    await useCard(alice.page, handCard(alice.page, "Raigeki"), "Activate");
    await pickLegalZone(alice.page, "st");
    await attackWithFirstMonster(alice.page);
    await alice.page.getByTestId("holo-pick-1").click();
    await alice.page.getByTestId("aim-confirm").click();
    await expect(alice.page.locator("[data-holo='1']")).toHaveAttribute("data-elim", "true");
    const eliminated = (await readTable(alice.page, slug)).engine!;
    expect(eliminated.seats[1]!.lp).toBe(0);
    expect(eliminated.seats[1]!.eliminated).toBe(true);
    expect(eliminated.eliminationOrder).toEqual([[1]]);
    for (const cards of [eliminated.seats[1]!.hand, eliminated.seats[1]!.monsters.filter(Boolean), eliminated.seats[1]!.spells.filter(Boolean), eliminated.seats[1]!.graveyard]) expect(cards).toHaveLength(0);
    await tableShot(alice.page, slug, info, "lp-elimination");
    await alice.page.reload();
    await expect(alice.page.locator("[data-holo='1']")).toHaveAttribute("data-elim", "true");
    await expect(occupied(alice.page, 1)).toHaveCount(0);
    await expect(alice.page.getByTestId("seat-out")).toContainText("3rd");
    await expect(alice.page.locator("[data-ring-seat='1']")).toHaveAttribute("data-status", "eliminated");
    await tableShot(alice.page, slug, info, "reload-after-elimination");
    await observeTable(alice.page);
    await endTurn(alice.page, 6);
    const turns = await tableTurns(alice.page);
    expect(turns.some((turn) => turn.turn === 5 && turn.seat === 2)).toBe(true);
    expect(turns.some((turn) => turn.turn > 4 && turn.seat === 1)).toBe(false);
    await attackWithFirstMonster(alice.page);
    // Only one rival remains: the core attacks it directly without a seat-choice prompt.
    await expect(tableLp(alice.page, 2)).toContainText("3,000");
    await attackNext(alice.page, 1);
    const result = alice.page.getByTestId("duel-result");
    await expect(result).toHaveAttribute("data-outcome", "win");
    await expect(result.locator("[data-place]")).toHaveText(["1st", "2nd", "3rd"]);
    const final = (await readTable(alice.page, slug)).engine!;
    expect(final.result!.winnerSeat).toBe(0);
    expect(final.eliminationOrder).toEqual([[1], [2]]);
    await tableShot(alice.page, slug, info, "final-placings");
    await alice.page.reload();
    await expect(result.locator("[data-place]")).toHaveText(["1st", "2nd", "3rd"]);
    expect((await readTable(alice.page, slug)).engine!.eliminationOrder).toEqual([[1], [2]]);
    expect(errors).toEqual([]);
  });

  test("a queued surrender shows Leaving before out and rebuilds the out chip on reload", async ({ player }, info) => {
    const alice = await player("p1");
    const bob = await player("p2");
    const errors = collectTableErrors(alice.page, [bob.page]);
    // Hold a real human response window: a practice bot can answer before Leaving is painted.
    // The other FFA3 gameplay and complete-match tests use one human plus two practice bots.
    const { slug } = await startTable([alice, bob], "ffa3 leaving", [
      { main: withFiller([FILLER], 40) }, { main: withFiller([FILLER], 40) },
    ], { ...options, bots: [2] });
    await useCard(alice.page, handCard(alice.page, FILLER), "Normal Summon");
    await pickLegalZone(alice.page, "mz");
    await openOptions(alice.page);
    await endTurn(alice.page, 2);
    const response = alice.page.waitForResponse((reply) => reply.url().endsWith(`/api/duels/${slug}/surrender`) && reply.request().method() === "POST");
    await surrender(alice.page);
    const pending = await (await response).json();
    expect(pending.engine.seats[0].pendingElimination).toBe(true);
    await expect(alice.page.locator("[data-holo='0']")).toHaveAttribute("data-leaving", "true");
    await tableShot(alice.page, slug, info, "leaving");
    await endTurn(bob.page, 3);
    await expect(alice.page.locator("[data-holo='0']")).toHaveAttribute("data-elim", "true");
    await expect(occupied(alice.page, 0)).toHaveCount(0);
    await expect(alice.page.getByTestId("self-eliminated")).toBeVisible();
    await alice.page.reload();
    await enterDuelRoom(alice.page);
    await expect(alice.page.getByTestId("seat-out")).toContainText("3rd");
    expect((await readTable(alice.page, slug)).engine!.eliminationOrder).toEqual([[0]]);
    expect(errors).toEqual([]);
  });

  test("a complete practice-bot versus practice-bot versus human simulation ends with a winner and engine placings", async ({ player }, info) => {
    test.setTimeout(240_000);
    const alice = await player("p1");
    const errors = collectTableErrors(alice.page);
    const { slug } = await startTable([alice], "ffa3 complete simulation", [{ main: withFiller([FILLER], 40) }], options);
    await expectRealCore(alice.page, slug, "practice", info);
    let engine = (await readTable(alice.page, slug)).engine!;
    const deadline = Date.now() + 200_000;
    const views: DuelEngineView[] = [];
    while (!engine.result && Date.now() < deadline) {
      if (engine.prompt?.seat === 0) await answerTable(alice.page, slug, engine, decide(engine.prompt, { wants: [] }).answer);
      await alice.page.waitForTimeout(100);
      engine = (await readTable(alice.page, slug)).engine!;
      if (views.at(-1)?.revision !== engine.revision) views.push(engine);
    }
    expect(engine.result, `last state: ${JSON.stringify(engine)}`).not.toBeNull();
    expect(engine.result!.winnerSeat).not.toBeNull();
    const losers = engine.eliminationOrder!.flat();
    expect(losers).toHaveLength(2);
    expect(new Set([...losers, engine.result!.winnerSeat]).size).toBe(3);
    const result = alice.page.getByTestId("duel-result");
    await expect(result).toBeVisible();
    await expect(result.locator("[data-place]")).toHaveText(["1st", "2nd", "3rd"]);
    const order = [engine.result!.winnerSeat!, ...[...engine.eliminationOrder!].reverse().flat()];
    const room = await readTable(alice.page, slug);
    const rows = result.getByRole("list", { name: "Final standings" }).getByRole("listitem");
    for (const [index, seat] of order.entries()) await expect(rows.nth(index)).toContainText(room.session.seats[seat]!.displayName);
    await info.attach("complete-simulation-engine-views", { body: JSON.stringify(views, null, 2), contentType: "application/json" });
    await tableShot(alice.page, slug, info, "simulation-result");
    expect(errors).toEqual([]);
  });
});
