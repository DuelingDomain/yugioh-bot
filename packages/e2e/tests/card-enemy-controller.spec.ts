import { test, expect } from "../helpers/fixtures";
import { handCard, pickLegalZone, startDuel, useCard } from "../helpers/board";
import type { Seat } from "../helpers/fixtures";
import type { DuelAnswer } from "@yugidraft/shared/duels";
import { withFiller } from "../helpers/decks";
import { readTable, readTableTrace } from "../helpers/table";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const proofDir = process.env.E2E_ENEMY_CONTROLLER_PROOF_DIR;
const engine = process.env.E2E_1V1_ENGINE ?? "pinned";

/** Ordinary game actions create the board on either engine; activation and combat below use the browser UI. */
async function prepareBoard(alice: Seat, bob: Seat, slug: string): Promise<void> {
  for (let step = 0; step < 30; step++) {
    const rooms = await Promise.all([alice, bob].map((seat) => readTable(seat.page, slug)));
    const index = rooms.findIndex((room) => room.engine?.prompt);
    expect(index, "A player must have priority during setup").toBeGreaterThanOrEqual(0);
    const view = rooms[index]!.engine!;
    const prompt = view.prompt!;
    if (index === 1 && view.phase === "main1" && view.seats[1]?.monsters[0]?.code === 48305365
      && prompt.options.some((option) => option.id.startsWith("activate:"))) return;
    const code = index === 0 ? 13039848 : 48305365;
    const summon = prompt.options.find((option) => option.id.startsWith("summon:") && option.card?.code === code);
    const ids = prompt.options.map((option) => option.id);
    let answer: DuelAnswer;
    if (summon) answer = { choice: summon.id };
    else if (prompt.kind === "places") answer = { selected: [prompt.options[0]!.id] };
    else if (ids.includes("no")) answer = { choice: "no" };
    else if (ids.includes("to_ep")) answer = { choice: "to_ep" };
    else if (prompt.context?.type === "chain") answer = { cancel: true };
    else throw new Error(`Unexpected setup prompt: ${JSON.stringify(prompt)}`);
    const response = await [alice, bob][index]!.page.request.post(`/api/duels/${slug}/actions`, {
      data: { revision: view.revision, promptId: prompt.id, answer },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
  throw new Error("Enemy Controller board setup did not finish");
}

for (const motion of ["reduced", "full"] as const) {
  for (const phase of ["Main", "Battle"] as const) {
    test(`Enemy Controller in ${phase} Phase (${motion} motion) rotates the target on both screens and combat uses DEF`, async ({ player }, info) => {
      test.setTimeout(180_000);
      const alice = await player("p1");
      const bob = await player("p2");
      // Keep the WebGL summons/initial deal light on a shared machine. Change motion before the effect below.
      for (const seat of [alice, bob]) await seat.page.emulateMedia({ reducedMotion: "reduce" });
      // Exercise ordinary gameplay: legacy deliberately has no startup scripts/presets.
      const { slug } = await startDuel(alice, bob, "enemy-controller",
        { main: withFiller(["Giant Soldier of Stone"], 20) },
        { main: withFiller(["Axe Raider", "Enemy Controller"], 20) });
      await prepareBoard(alice, bob, slug);
      for (const seat of [alice, bob]) await seat.page.emulateMedia({ reducedMotion: motion === "full" ? "no-preference" : "reduce" });
      if (phase === "Battle") await bob.page.getByRole("button", { name: /^To Battle/ }).click();
      const target = (page: typeof bob.page) => page.locator('[data-zones~="0:4:0"][data-occupied="true"]');
      for (const seat of [alice, bob]) await expect(target(seat.page)).toHaveAttribute("data-defense", "false");
      if (proofDir) {
        mkdirSync(proofDir, { recursive: true });
        for (const [role, seat] of [["opponent", alice], ["activator", bob]] as const)
          await seat.page.screenshot({ path: join(proofDir, `enemy-controller-${engine}-${phase.toLowerCase()}-${motion}-${role}-before.png`), animations: "disabled" });
      }
      await useCard(bob.page, handCard(bob.page, "Enemy Controller"), "Activate");
      await pickLegalZone(bob.page, "st");
      await bob.page.locator("[data-prompt-panel]").getByRole("button", { name: /Change.*position/i }).click();
      // With exactly one eligible monster, the host answers the forced target automatically.
      for (const seat of [alice, bob]) {
        await expect(target(seat.page)).toHaveAttribute("data-defense", "true");
        await expect.poll(async () => (await readTable(seat.page, slug)).engine?.seats[0]?.monsters[0]?.position).toBe(4);
        const art = target(seat.page).locator("[data-card-art]");
        await expect.poll(() => art.evaluate((node) => {
          const m = new DOMMatrixReadOnly(getComputedStyle(node).transform);
          return !node.getAnimations().some((animation) => animation.playState === "running" || animation.pending)
            && Math.abs(m.a) < 0.01 && Math.abs(m.b) > 0.99;
        }), { message: "Defense art must remain rotated after animation settles" }).toBe(true);
        if (proofDir) await seat.page.screenshot({ path: join(proofDir, `enemy-controller-${engine}-${phase.toLowerCase()}-${motion}-${seat === alice ? "opponent" : "activator"}-after.png`), animations: "disabled" });
      }
      const trace = await readTableTrace(bob.page, slug);
      expect(trace.wasmFile).toBe(engine === "legacy" ? "ocgcore-wasm npm package core (built in)" : "ocgcore.standard.wasm");
      await info.attach("resolved-position-views", { body: JSON.stringify(trace, null, 2), contentType: "application/json" });
      for (const { view } of trace.seats) {
        expect(view.seats[0]?.monsters[0]).toMatchObject({ code: 13039848, position: 4 });
        expect(view.events).toContainEqual(expect.objectContaining({ kind: "position", fromPosition: 1, toPosition: 4 }));
      }
      // The rotation above ran with the selected motion; battle WebGL is expensive in headless software rendering.
      for (const seat of [alice, bob]) await seat.page.emulateMedia({ reducedMotion: "reduce" });
      if (phase === "Main") await bob.page.getByRole("button", { name: /^To Battle/ }).click();
      await useCard(bob.page, bob.page.locator('[data-zones~="1:4:0"] button'), "Attack");
      for (const seat of [alice, bob]) {
        await expect.poll(async () => (await readTable(seat.page, slug)).engine?.seats.map((s) => s.lp)).toEqual([8000, 7700]);
        const room = await readTable(seat.page, slug);
        expect(room.engine?.seats[0]?.monsters[0]?.code).toBe(13039848);
        expect(room.engine?.seats[1]?.monsters[0]?.code).toBe(48305365);
      }
    });
  }
}
