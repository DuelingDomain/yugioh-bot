import { test, expect, type Page } from "@playwright/test";

// The 4-way grid: two facing fields overlap in the shared Extra Monster band. Every zone of every field must still take
// the pointer (hover, click, target pick), and a click on empty mat must still reach its field. Fixture preview only: no duel host.
const preview = (query: string, reduced = true) => `/dev/table-preview/ffa4?fixture=review&${reduced ? "reduced=1&" : ""}${query}`;

async function open(page: Page, query: string, reduced = true) {
  const response = await page.goto(preview(query, reduced));
  expect(response?.ok()).toBe(true);
  await expect(page.locator("[data-table-stage]")).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => document.fonts.ready);
}

/** The zones of every field (not the hand) whose centre is inside the board and does not hit the zone itself. */
async function blockedZones(page: Page, only?: { seat: number; kind: string }) {
  return page.evaluate((filter) => {
    const board = document.querySelector("[data-table-stage]")!.getBoundingClientRect();
    const blocked: string[] = [];
    let checked = 0;
    for (const field of document.querySelectorAll<HTMLElement>("[data-seat-field]")) {
      const seat = Number(field.dataset.seatField);
      for (const zone of field.querySelectorAll<HTMLElement>("[data-zones]")) {
        if (zone.closest("[data-hand-seat]")) continue;
        if (filter && (filter.seat !== seat || filter.kind !== zone.dataset.kind)) continue;
        const rect = zone.getBoundingClientRect();
        if (rect.width < 2) continue;
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;
        if (x < board.left || x > board.right || y < board.top || y > board.bottom) continue;
        checked += 1;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !zone.contains(hit)) blocked.push(`seat ${seat} ${zone.dataset.kind} ${zone.dataset.zones}`);
      }
    }
    return { checked, blocked };
  }, only);
}

/** A point on the empty mat of a field: its left margin, below the pile column's first card. Nothing but the mat is there. */
async function emptyMat(page: Page, seat: number) {
  return page.evaluate((target) => {
    const rect = document.querySelector(`[data-seat-field="${target}"]`)!.getBoundingClientRect();
    return { x: rect.x + 3, y: rect.y + rect.height * 0.6 };
  }, seat);
}

for (const viewer of [0, 1, 2, 3]) {
  test(`ffa4 viewer ${viewer}: every zone of every field takes the pointer at 1x`, async ({ page }) => {
    await open(page, `state=main&viewer=${viewer}`);
    const { checked, blocked } = await blockedZones(page);
    expect(checked).toBeGreaterThan(50);
    expect(blocked).toEqual([]);
  });

  test(`ffa4 viewer ${viewer}: a zoomed Banished zone takes the pointer, whichever field it belongs to`, async ({ page }) => {
    for (const seat of [0, 1, 2, 3]) {
      await open(page, `state=main&viewer=${viewer}`);
      const centre = await page.evaluate((target) => {
        const rect = document.querySelector(`[data-seat-field="${target}"] [data-kind="banish"]`)!.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }, seat);
      await page.mouse.move(centre.x, centre.y);
      for (let step = 0; step < 4; step += 1) {
        await page.mouse.wheel(0, -300);
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(500);
      const { checked, blocked } = await blockedZones(page, { seat, kind: "banish" });
      expect(checked, `seat ${seat} Banished is on the zoomed board`).toBe(1);
      expect(blocked).toEqual([]);
    }
  });
}

test("ffa4: a click on the empty mat of a field focuses that field", async ({ page }) => {
  await open(page, "state=main");
  const stage = page.locator("[data-table-stage]");
  // On your own turn the focus starts on your own field.
  await expect(stage).toHaveAttribute("data-grid-focus", "0");
  const point = await emptyMat(page, 3);
  await page.mouse.click(point.x, point.y);
  await expect(stage).toHaveAttribute("data-grid-focus", "3");
});

test("ffa4: a direct attack is sent by a click on the empty mat of the rival", async ({ page }) => {
  const answers: unknown[] = [];
  page.on("console", async (message) => {
    if (!message.text().includes("[table-preview] answer")) return;
    const values = await Promise.all(message.args().map((arg) => arg.jsonValue().catch(() => null)));
    answers.push(values[1]);
  });
  await open(page, "state=direct-attack");
  const point = await emptyMat(page, 2);
  await page.mouse.move(point.x, point.y);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => answers.length).toBe(1);
  expect(answers[0]).toMatchObject({ state: "direct-attack", answer: { choice: "direct-2" } });
  // The click was an answer, not a focus.
  await expect(page.locator("[data-table-stage]")).toHaveAttribute("data-grid-focus", "all");
});

test("ffa4: hovering empty rival mat in a direct attack snaps the arrow to that rival", async ({ page }) => {
  await open(page, "state=direct-attack");
  await expect(page.locator("[data-aim-hot]")).toHaveCount(0);
  const point = await emptyMat(page, 2);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator("[data-aim-hot]")).not.toHaveCount(0);
});

test("ffa4: the prompt panel over a rival field is not a direct attack: no answer, no snap", async ({ page }) => {
  const answers: unknown[] = [];
  page.on("console", (message) => {
    if (message.text().includes("[table-preview] answer")) answers.push(message.text());
  });
  await open(page, "state=direct-attack");
  const panel = page.locator("[data-prompt-panel]").first();
  const title = panel.locator("h2").first();
  const hide = panel.getByRole("button", { name: "Hide to look at the board" });
  await expect(title).toBeVisible();
  // The panel lies over a field: its centre must be inside a field box, or this test proves nothing.
  const box = (await title.boundingBox())!;
  const over = await page.evaluate(({ x, y }) => {
    return [...document.querySelectorAll<HTMLElement>("[data-seat-field]")].some((field) => {
      const rect = field.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    });
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(over).toBe(true);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  await expect(page.locator("[data-aim-hot]")).toHaveCount(0);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const button = (await hide.boundingBox())!;
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
  await page.waitForTimeout(300);
  await expect(page.locator("[data-aim-hot]")).toHaveCount(0);
  await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
  await page.waitForTimeout(500);
  expect(answers).toEqual([]);
});

test("ffa4: a click on the phase hub does not move the focus to the field under it", async ({ page }) => {
  await open(page, "state=main");
  const stage = page.locator("[data-table-stage]");
  const mat = await emptyMat(page, 3);
  await page.mouse.click(mat.x, mat.y);
  await expect(stage).toHaveAttribute("data-grid-focus", "3");
  // A phase chip that is not a button: it takes the pointer, and a field lies under it.
  const chip = (await page.locator("[data-grid-hub] span[class*='chip']").first().boundingBox())!;
  const x = chip.x + chip.width / 2;
  const y = chip.y + chip.height / 2;
  const target = await page.evaluate(({ x: px, y: py }) => {
    const hit = document.elementFromPoint(px, py);
    const fields = [...document.querySelectorAll<HTMLElement>("[data-seat-field]")].filter((field) => {
      const rect = field.getBoundingClientRect();
      return px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom;
    });
    return { inHub: !!hit?.closest("[data-grid-hub]"), button: !!hit?.closest("button"), overField: fields.length > 0 };
  }, { x, y });
  expect(target).toEqual({ inHub: true, button: false, overField: true });
  await page.mouse.click(x, y);
  await page.waitForTimeout(400);
  await expect(stage).toHaveAttribute("data-grid-focus", "3");
});

// A click must never be read against a board that is moving (a seat leaves, the camera glides): it would land on whatever slid
// under the pointer. The board input guard holds action clicks while the board moves and for a moment after. Full motion on.
test.describe("ffa4: no click lands on a board that moves", () => {
  test.use({ reducedMotion: "no-preference" });

  const handCard = (page: Page) => page.evaluate(() => {
    const node = [...document.querySelectorAll<HTMLElement>("[data-legal]")].find((n) => n.closest("[data-hand-seat]") && n.getBoundingClientRect().width > 8);
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  const seatsMoving = (page: Page) => page.evaluate(() => document.getAnimations().some((a) => {
    const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
    return a.playState === "running" && !!target?.matches?.("[data-seat-slot], [data-board-motion]");
  }));

  test("two seats leave: a click while the seats glide does nothing, a click after they settle acts", async ({ page }) => {
    await open(page, "state=main&viewer=0&out=2,3&after=1500", false);
    await page.waitForFunction(() => document.getAnimations().some((a) => {
      const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
      return a.playState === "running" && !!target?.matches?.("[data-seat-slot], [data-board-motion]");
    }), undefined, { timeout: 15_000 });
    const during = (await handCard(page))!;
    expect(await seatsMoving(page)).toBe(true);
    await page.mouse.click(during.x, during.y);
    await expect(page.locator("[role=menu]")).toHaveCount(0);

    await expect.poll(() => seatsMoving(page), { timeout: 15_000 }).toBe(false);
    await page.waitForTimeout(450);
    const after = (await handCard(page))!;
    await page.mouse.click(after.x, after.y);
    await expect(page.locator("[role=menu]")).toHaveCount(1);
  });

  test("a press that starts on one card and ends on another acts on neither", async ({ page }) => {
    await open(page, "state=main&viewer=0", false);
    await page.waitForTimeout(1200);
    const points = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-legal]")]
      .filter((n) => n.closest("[data-hand-seat]") && n.getBoundingClientRect().width > 8)
      .map((n) => { const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
    expect(points.length).toBeGreaterThan(1);
    const [from, to] = [points[0], points[points.length - 1]];
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator("[role=menu]")).toHaveCount(0);
  });
});
