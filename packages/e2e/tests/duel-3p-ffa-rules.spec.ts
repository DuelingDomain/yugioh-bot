import { test, expect } from "../helpers/fixtures";
import { handCard, pickLegalZone, useCard } from "../helpers/board";
import { collectTableErrors, expectRealCore, readTable, readTableTrace, startTablePreset, tableLp } from "../helpers/table";
import { declineToAction, expectRulesPriority, expectRulesUi, pickRulesCard, rulesPanel, rulesZone, summonRulesExtra, waitRulesPrompt } from "../helpers/table-rules";
import type { Page } from "@playwright/test";

const monsters = async (page: Page, slug: string) => (await readTable(page, slug)).engine!.seats.map((seat) => seat.monsters.filter(Boolean).map((card) => card!.name));

async function activateHand(page: Page, name: string): Promise<void> {
  await useCard(page, handCard(page, name), "Activate");
  await pickLegalZone(page, "st");
}

test.describe("FFA3 opponent and chain rules on the real core", () => {
  for (const adr of [false, true]) {
    test(adr
      ? "R-FFA-OPP-ONE: three seats declare one opponent before Raigeki clears only that field"
      : "current engine: R-COMMON-OPP-FIELD retired, three-seat Raigeki clears both opponent fields", async ({ player }, info) => {
      const { page } = await player("p1");
      const errors = collectTableErrors(page);
      const slug = await startTablePreset(page, "ffa3-rules-opponent-field");
      await expectRealCore(page, slug, "scripted", info);
      expect((await readTable(page, slug)).session.format).toBe("ffa3");
      await activateHand(page, "Raigeki");
      if (adr) {
        test.fail(true, "R-FFA-OPP-ONE pending engine change");
        // Default assertion timeout after test.fail: the failure must be at a rule assertion.
        await expect.poll(async () => (await readTable(page, slug)).engine!.prompt?.context?.type).toBe("opponent");
        const prompt = (await readTable(page, slug)).engine!.prompt!;
        expect(prompt.options.map((option) => option.controller)).toEqual([1, 2]);
        for (const seat of [1, 2]) await expect(page.getByTestId(`holo-pick-${seat}`)).toBeVisible();
        await expect(page.getByTestId("holo-pick-0")).toHaveCount(0);
        await page.getByTestId("holo-pick-2").click();
      }
      await expect.poll(() => monsters(page, slug)).toEqual(adr ? [["Mystical Elf"], ["Battle Ox"], []] : [["Mystical Elf"], [], []]);
      expect((await readTable(page, slug)).engine!.seats.map((seat) => seat.graveyard.map((card) => card.name))).toEqual(adr ? [["Raigeki"], [], ["Silver Fang"]] : [["Raigeki"], ["Battle Ox"], ["Silver Fang"]]);
      await expectRulesUi(page, slug, info);
      expect(errors).toEqual([]);
    });
  }

  test("R-COMMON-OPP-PICK: Hinotama declares one rival and changes only that rival's LP", async ({ player }, info) => {
    const { page } = await player("p1");
    const errors = collectTableErrors(page);
    // A dedicated LP preset complements the existing Mind Crush hand proof.
    const slug = await startTablePreset(page, "ffa3-rules-opponent-lp");
    await expectRealCore(page, slug, "scripted", info);
    await activateHand(page, "Hinotama");
    const prompt = await waitRulesPrompt(page, slug, (p) => p.context?.type === "opponent");
    expect(prompt.options.map((option) => option.controller)).toEqual([1, 2]);
    for (const seat of [1, 2]) await expect(page.getByTestId(`holo-pick-${seat}`)).toBeVisible();
    await expect(page.getByTestId("holo-pick-0")).toHaveCount(0);
    await page.getByTestId("holo-pick-2").click();
    await expect.poll(async () => (await readTable(page, slug)).engine!.seats.map((seat) => seat.lp)).toEqual([8000, 8000, 7500]);
    await expectRulesUi(page, slug, info);
    for (const seat of [0, 1]) await expect(tableLp(page, seat).locator("[data-damage-chip]")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("R-FFA-OPP-RESPONSE: A attacks B directly, only B receives Battle Fader, C does not", async ({ player }, info) => {
    const { page } = await player("p1");
    const errors = collectTableErrors(page);
    const slug = await startTablePreset(page, "ffa3-rules-direct-response");
    await expectRealCore(page, slug, "scripted", info);
    await declineToAction(page, slug);
    await page.getByRole("button", { name: "End Turn", exact: true }).click();
    await declineToAction(page, slug, 4);
    await page.getByRole("button", { name: /^To Battle/ }).click();
    await declineToAction(page, slug, 4);
    const checkpoint = (await readTableTrace(page, slug)).promptLog.at(-1)!.revision;
    await useCard(page, rulesZone(page, 0, 0).locator("button"), "Attack");
    const prompt = await waitRulesPrompt(page, slug, (p) => p.options.length === 2 && p.options.every((option) => option.id.startsWith("opt:") && option.controller != null));
    expect(prompt.options.map((option) => option.controller)).toEqual([1, 2]);
    await page.getByTestId("holo-pick-1").click();
    await page.getByTestId("aim-confirm").click();
    // Attack declaration opens the turn player's empty-chain quick-effect
    // window first. Pass it through the UI before expecting B's trigger link.
    for (let step = 0; step < 8; step += 1) {
      const response = await waitRulesPrompt(page, slug, (p) => p.context?.type === "chain");
      const chain = (await readTable(page, slug)).engine!.chain.map((link) => link.seat);
      if (chain.join() === "1") break;
      expect(chain).toEqual([]);
      await rulesPanel(page).getByRole("button", { name: "No", exact: true }).click();
      await expect.poll(async () => (await readTableTrace(page, slug)).promptLog.at(-1)?.promptId).not.toBe(response.id);
    }
    await expect.poll(async () => (await readTable(page, slug)).engine!.chain.map((link) => link.seat)).toEqual([1]);
    await expectRulesPriority(page, [0, 1, 2]);
    await expect(page.getByRole("list", { name: "Current chain" })).toContainText("Battle Fader");
    const trace = await readTableTrace(page, slug);
    expect(trace.seats[1]!.view.seats[1]!.hand.some((card) => card.name === "Battle Fader")).toBe(true);
    expect(trace.seats[2]!.view.seats[2]!.hand.some((card) => card.name === "Battle Fader")).toBe(true);
    await declineToAction(page, slug, 4);
    const after = await readTableTrace(page, slug);
    const offers = after.promptLog.filter((entry) => entry.revision > checkpoint && entry.options.some((option) => option.card?.name === "Battle Fader"));
    // The core records both the trigger offer and its activation choice. Every
    // offer must still belong to B; C must never have the card available.
    expect([...new Set(offers.map((entry) => entry.promptSeat))]).toEqual([1]);
    expect(await monsters(page, slug)).toEqual([["Blue-Eyes White Dragon"], ["Battle Fader"], []]);
    expect((await readTable(page, slug)).engine!.seats.map((seat) => seat.lp)).toEqual([8000, 8000, 8000]);
    expect(after.seats[2]!.view.seats[2]!.hand.map((card) => card.name)).toContain("Battle Fader");
    await expectRulesUi(page, slug, info);
    for (const seat of [0, 1, 2]) await expect(tableLp(page, seat).locator("[data-damage-chip]")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("R-FFA-TRIGGERS: all three simultaneous triggers form [0,1,2] and resolve [2,1,0]", async ({ player }, info) => {
    const { page } = await player("p1");
    const errors = collectTableErrors(page);
    const slug = await startTablePreset(page, "ffa3-rules-triggers");
    await expectRealCore(page, slug, "scripted", info);
    await declineToAction(page, slug);
    await activateHand(page, "Dark Hole");
    // Decline the MST response to Dark Hole before the simultaneous trigger event.
    await waitRulesPrompt(page, slug, (p) => p.context?.type === "chain");
    await rulesPanel(page).getByRole("button", { name: "No", exact: true }).click();
    await expect.poll(async () => (await readTable(page, slug)).engine!.chain.map((link) => link.seat)).toEqual([0, 1, 2]);
    await expectRulesPriority(page, [0, 1, 2]);
    await expect(page.getByRole("list", { name: "Current chain" }).getByRole("listitem")).toHaveCount(3);
    expect((await readTableTrace(page, slug)).promptLog.some((entry) => entry.chainSeats.join() === "0,1,2" && entry.promptSeat === 0)).toBe(true);
    await rulesPanel(page).getByRole("button", { name: "No", exact: true }).click();
    await pickRulesCard(page, slug, "Giant Rat");
    await declineToAction(page, slug);
    const engine = (await readTable(page, slug)).engine!;
    expect(engine.events.filter((event) => event.kind === "activate" && ["Sangan", "Witch of the Black Forest"].includes(event.card?.name ?? "")).map((event) => event.seat)).toEqual([0, 1, 2]);
    expect(engine.events.filter((event) => event.kind === "chain-resolved" && ["Sangan", "Witch of the Black Forest"].includes(event.card?.name ?? "")).map((event) => event.seat)).toEqual([2, 1, 0]);
    const trace = await readTableTrace(page, slug);
    expect(trace.seats.map(({ seat, view }) => view.seats[seat]!.hand.map((card) => card.name))).toEqual([["Giant Rat"], ["Silver Fang"], ["Giant Rat"]]);
    expect(engine.seats.map((seat) => seat.graveyard.length)).toEqual([2, 1, 1]);
    await expectRulesUi(page, slug, info);
    expect(errors).toEqual([]);
  });

  test("R-FFA-NEGATE: third duelist's Solemn negates A's Raigeki, pays LP, and preserves B's field", async ({ player }, info) => {
    const { page } = await player("p1");
    const errors = collectTableErrors(page);
    const slug = await startTablePreset(page, "ffa3-rules-negate");
    await expectRealCore(page, slug, "scripted", info);
    await activateHand(page, "Raigeki");
    await expect.poll(async () => (await readTable(page, slug)).engine!.chain.map((link) => link.seat)).toEqual([0, 2]);
    await expectRulesPriority(page, [0, 1, 2]);
    await expect(page.getByRole("list", { name: "Current chain" })).toContainText("Solemn Judgment");
    const log = (await readTableTrace(page, slug)).promptLog;
    expect(log.some((entry) => entry.promptSeat === 2 && entry.chainSeats.join() === "0" && entry.options.some((option) => option.card?.name === "Solemn Judgment"))).toBe(true);
    await rulesPanel(page).getByRole("button", { name: "No", exact: true }).click();
    await expect.poll(async () => (await readTable(page, slug)).engine!.chain.length).toBe(0);
    const engine = (await readTable(page, slug)).engine!;
    expect(engine.events.some((event) => event.kind === "chain-negated" && event.chainIndex === 1)).toBe(true);
    expect(engine.seats.map((seat) => seat.lp)).toEqual([8000, 8000, 4000]);
    expect(await monsters(page, slug)).toEqual([[], ["Battle Ox"], ["Axe Raider"]]);
    expect(engine.seats.map((seat) => seat.graveyard.map((card) => card.name))).toEqual([["Raigeki"], [], ["Solemn Judgment"]]);
    await expectRulesUi(page, slug, info);
    for (const seat of [0, 1]) await expect(tableLp(page, seat).locator("[data-damage-chip]")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("R-FFA-TRIGGERS: seat 1's turn forms [1,2,0] and resolves [0,2,1]", async ({ player }, info) => {
    const { page } = await player("p1");
    const errors = collectTableErrors(page);
    const slug = await startTablePreset(page, "ffa3-rules-triggers-rotated");
    await expectRealCore(page, slug, "scripted", info);
    await declineToAction(page, slug);
    await page.getByRole("button", { name: "End Turn", exact: true }).click();
    // Decline only real chain prompts until the simultaneous trigger chain is complete.
    for (let step = 0; step < 12; step += 1) {
      const prompt = await waitRulesPrompt(page, slug, (p) => p.context?.type === "chain");
      if ((await readTable(page, slug)).engine!.chain.map((link) => link.seat).join() === "1,2,0") break;
      await rulesPanel(page).getByRole("button", { name: "No", exact: true }).click();
      await expect.poll(async () => (await readTableTrace(page, slug)).promptLog.at(-1)?.promptId).not.toBe(prompt.id);
    }
    const formed = (await readTable(page, slug)).engine!;
    expect(formed.turnSeat).toBe(1);
    expect(formed.chain.map((link) => link.seat)).toEqual([1, 2, 0]);
    await expectRulesPriority(page, [1, 2, 0]);
    await expect(page.getByRole("list", { name: "Current chain" }).getByRole("listitem")).toHaveCount(3);
    await rulesPanel(page).getByRole("button", { name: "No", exact: true }).click();
    await pickRulesCard(page, slug, "Giant Rat");
    await declineToAction(page, slug, 4);
    const engine = (await readTable(page, slug)).engine!;
    const isTrigger = (name?: string) => ["Sangan", "Witch of the Black Forest"].includes(name ?? "");
    expect(engine.events.filter((event) => event.kind === "activate" && isTrigger(event.card?.name)).map((event) => event.seat)).toEqual([1, 2, 0]);
    expect(engine.events.filter((event) => event.kind === "chain-resolved" && isTrigger(event.card?.name)).map((event) => event.seat)).toEqual([0, 2, 1]);
    await expectRulesUi(page, slug, info);
    expect(errors).toEqual([]);
  });

  for (const adr of [false, true]) {
    test(adr
      ? "R-FFA-ACTIVATED-LOCK: Abyss Dweller declares one rival and leaves the other GY trigger available"
      : "current engine: Abyss Dweller locks both rivals' Graveyard triggers without an opponent declaration", async ({ player }, info) => {
      const { page } = await player("p1");
      const errors = collectTableErrors(page);
      const slug = await startTablePreset(page, "ffa3-rules-activated-lock");
      await expectRealCore(page, slug, "scripted", info);
      await declineToAction(page, slug);
      const before = (await readTable(page, slug)).engine!.prompt!.id;
      await useCard(page, rulesZone(page, 0, 0).locator("button"), "Activate");
      await expect.poll(async () => (await readTableTrace(page, slug)).promptLog.at(-1)?.promptId).not.toBe(before);
      let declared = false;
      for (let step = 0; step < 4; step += 1) {
        const prompt = await waitRulesPrompt(page, slug, () => true);
        const engine = (await readTable(page, slug)).engine!;
        const detached = engine.seats[0]!.graveyard.some((card) => card.name === "Mystical Elf");
        if (detached && (declared || ["action", "chain"].includes(prompt.context?.type ?? ""))) break;
        if (prompt.context?.type === "opponent" && adr) {
          await page.getByTestId("holo-pick-1").click();
          declared = true;
          await expect.poll(async () => (await readTableTrace(page, slug)).promptLog.at(-1)?.promptId).not.toBe(prompt.id);
        } else if (prompt.options.some((option) => option.card?.name === "Mystical Elf")) {
          await pickRulesCard(page, slug, "Mystical Elf");
        } else {
          throw new Error(`Unexpected Dweller setup prompt: ${JSON.stringify(prompt)}`);
        }
      }
      await expect.poll(async () => (await readTable(page, slug)).engine!.seats[0]!.graveyard.map((card) => card.name)).toContain("Mystical Elf");
      if (adr) {
        test.fail(true, "R-FFA-ACTIVATED-LOCK pending engine change");
        expect(declared).toBe(true);
      }
      await declineToAction(page, slug);
      await activateHand(page, "Dark Hole");
      await declineToAction(page, slug);
      const engine = (await readTable(page, slug)).engine!;
      const triggers = engine.events.filter((event) => event.kind === "activate" && ["Sangan", "Witch of the Black Forest"].includes(event.card?.name ?? ""));
      expect(triggers.map((event) => event.seat)).toEqual(adr ? [2] : []);
      expect(engine.seats.map((seat) => seat.graveyard.length)).toEqual([3, 1, 1]);
      await expectRulesUi(page, slug, info);
      expect(errors).toEqual([]);
    });
  }

  for (const adr of [false, true]) {
    test(adr
      ? "R-FFA-RESOURCE-ROTATION: Creature Swap rotates monsters 0 to 1 to 2 to 0"
      : "current engine: Creature Swap exchanges a pair and leaves the third monster alone", async ({ player }, info) => {
      const { page } = await player("p1");
      const errors = collectTableErrors(page);
      const slug = await startTablePreset(page, "ffa3-rules-resource-rotation");
      await expectRealCore(page, slug, "scripted", info);
      await activateHand(page, "Creature Swap");
      // The current core can request an opponent bind before its pair swap.
      const prompt = await waitRulesPrompt(page, slug, () => true);
      if (prompt.context?.type === "opponent") {
        await page.getByTestId("holo-pick-1").click();
        await expect.poll(async () => (await readTableTrace(page, slug)).promptLog.at(-1)?.promptId).not.toBe(prompt.id);
      }
      const selection = await waitRulesPrompt(page, slug, () => true);
      if (selection?.options.some((option) => option.card?.name === "Mystical Elf")) await pickRulesCard(page, slug, "Mystical Elf");
      // Control transfers ask the human where to place the received monster.
      const placement = await waitRulesPrompt(page, slug, () => true);
      if (placement.kind === "places") {
        await pickLegalZone(page, "mz");
        await expect.poll(async () => (await readTableTrace(page, slug)).promptLog.at(-1)?.promptId).not.toBe(placement.id);
      }
      await declineToAction(page, slug);
      if (adr) test.fail(true, "R-FFA-RESOURCE-ROTATION pending engine change");
      expect(await monsters(page, slug)).toEqual(adr ? [["Silver Fang"], ["Mystical Elf"], ["Battle Ox"]] : [["Battle Ox"], ["Mystical Elf"], ["Silver Fang"]]);
      const engine = (await readTable(page, slug)).engine!;
      expect(engine.seats.map((seat) => seat.monsters.find(Boolean)?.controller)).toEqual([0, 1, 2]);
      expect(engine.seats.map((seat) => seat.graveyard.length)).toEqual([1, 0, 0]);
      await expectRulesUi(page, slug, info);
      expect(errors).toEqual([]);
    });
  }

  for (const sequence of [5, 6]) {
    test(`R-COMMON-EMZ: real Link summons into own EMZ ${sequence} ignore rival EMZ and use only the local arrow`, async ({ player }, info) => {
      const { page } = await player("p1");
      const errors = collectTableErrors(page);
      const slug = await startTablePreset(page, "ffa3-rules-extra-zones");
      await expectRealCore(page, slug, "scripted", info);
      await summonRulesExtra(page, "Link Spider");
      await pickRulesCard(page, slug, "Mystical Elf");
      const places = await waitRulesPrompt(page, slug, (p) => p.kind === "places");
      expect(places.options.map((option) => [option.controller, option.sequence])).toEqual([[0, 5], [0, 6]]);
      for (const emz of [5, 6]) await expect(rulesZone(page, 0, emz)).toHaveAttribute("data-legal", "true");
      await rulesZone(page, 0, sequence).locator("button").click();
      await expect.poll(async () => (await readTable(page, slug)).engine!.seats[0]!.monsters[sequence]?.name).toBe("Link Spider");
      await summonRulesExtra(page, "Imduk the World Chalice Dragon");
      await pickRulesCard(page, slug, "Battle Ox");
      const linked = sequence === 5 ? 1 : 3;
      await expect.poll(async () => (await readTable(page, slug)).engine!.seats[0]!.monsters[linked]?.name).toBe("Imduk the World Chalice Dragon");
      const engine = (await readTable(page, slug)).engine!;
      expect(engine.seats[0]!.monsters[sequence === 5 ? 6 : 5]).toBeNull();
      expect(engine.seats[0]!.extraCount).toBe(0);
      for (const seat of [1, 2]) expect(engine.seats[seat]!.monsters[5]?.name).toBe("Link Spider");
      expect(engine.events.filter((event) => event.kind === "summon" && event.summonKind === "link").map((event) => event.card?.name)).toEqual(["Link Spider", "Imduk the World Chalice Dragon"]);
      await expectRulesUi(page, slug, info);
      await expect(rulesZone(page, 0, sequence)).toHaveAttribute("data-occupied", "true");
      await expect(rulesZone(page, 0, linked)).toHaveAttribute("data-occupied", "true");
      expect(errors).toEqual([]);
    });
  }

  for (const adr of [false, true]) {
    test(adr
      ? "R-FFA-ACROSS-EMZ: FFA4 across seat 2 blocks seat 0's matching EMZ during a real Link summon"
      : "current engine: FFA4 across EMZ remain independent during a real Link summon", async ({ player }, info) => {
      const { page } = await player("p1");
      const errors = collectTableErrors(page);
      const slug = await startTablePreset(page, "ffa4-rules-across-extra-zones");
      await expectRealCore(page, slug, "scripted", info, 3);
      await summonRulesExtra(page, "Link Spider");
      await pickRulesCard(page, slug, "Mystical Elf");
      // Establish the summon setup before annotating the rule assertion. A single
      // legal zone can auto-place; an unrelated prompt must remain unexpected.
      await expect.poll(async () => {
        const engine = (await readTable(page, slug)).engine!;
        const prompt = engine.prompt;
        return (prompt?.seat === 0 && prompt.kind === "places" && prompt.options.every((option) => option.controller === 0 && option.location === 4))
          || engine.seats[0]!.monsters.some((card) => card?.name === "Link Spider");
      }).toBe(true);
      const prompt = (await readTable(page, slug)).engine!.prompt;
      if (adr) test.fail(true, "R-FFA-ACROSS-EMZ pending engine change");
      if (prompt?.kind === "places") {
        expect(prompt.options.map((option) => [option.controller, option.sequence])).toEqual(adr ? [[0, 6]] : [[0, 5], [0, 6]]);
        await expect(page.getByRole("group", { name: /^Select a zone/ })).toBeVisible();
        await expect(rulesZone(page, 0, adr ? 6 : 5)).toHaveAttribute("data-legal", "true");
        await rulesZone(page, 0, adr ? 6 : 5).locator("button").click();
        await expect.poll(async () => (await readTableTrace(page, slug)).promptLog.at(-1)?.promptId).not.toBe(prompt.id);
      }
      await expect.poll(async () => (await readTable(page, slug)).engine!.seats[0]!.monsters[adr ? 6 : 5]?.name).toBe("Link Spider");
      expect((await readTable(page, slug)).engine!.seats[2]!.monsters[6]?.name).toBe("Link Spider");
      await expectRulesUi(page, slug, info);
      expect(errors).toEqual([]);
    });
  }
});
