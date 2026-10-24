import { test, expect, type Locator, type Page } from "@playwright/test";

// The edge drawers (Log, Settings, Camera, Card, Chain) of the wide tables, on the fixture previews.
// A drawer opens only from a click or a key on its tab. One drawer is open at a time. Every tab stays in view and out of the open panel.
// The multi-seat tables (Tag, 3-way, 4-way) have no Card drawer: a click on a card opens the pinned card pop-out. The 1v1 room keeps its Card drawer.

const FORMATS = [
  { id: "tag", path: "tag", tabs: ["Log", "Settings", "Camera"], hasCardDrawer: false },
  { id: "ffa3", path: "ffa3", tabs: ["Log", "Settings", "Camera"], hasCardDrawer: false },
  { id: "ffa4", path: "ffa4", tabs: ["Log", "Settings"], hasCardDrawer: false },
  { id: "classic", path: "classic/room", tabs: ["Card", "Log", "Settings"], hasCardDrawer: true },
];
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 1366, height: 768 },
];

const open = (page: Page) => page.locator('[data-edge-drawer][data-state="open"]');
const tabOf = (page: Page, label: string) => page.locator(`[data-edge-drawer="${label}"] [data-edge-tab]`);
const panelOf = (page: Page, label: string) => page.locator(`[data-edge-drawer="${label}"] [role="dialog"]`);

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box, slack = 1) =>
  a.x + slack < b.x + b.width && b.x + slack < a.x + a.width && a.y + slack < b.y + b.height && b.y + slack < a.y + a.height;

/** The box of an element once it stops moving (a drawer slides in). */
async function settledBox(locator: Locator): Promise<Box> {
  let last = "";
  let box: Box | null = null;
  await expect(async () => {
    box = await locator.boundingBox();
    const now = JSON.stringify(box);
    const settled = box !== null && now === last;
    last = now;
    expect(settled).toBe(true);
  }).toPass({ intervals: [100, 150, 200] });
  return box!;
}

/** Every tab is in the viewport, no two tabs overlap, and no tab covers the open panel. */
async function expectTabsClear(page: Page, tabs: string[], openLabel: string | null) {
  const view = page.viewportSize()!;
  await expect(async () => {
    expect(await tabProblem()).toBe("clear");
  }).toPass();

  async function tabProblem(): Promise<string> {
    const boxes: Record<string, Box> = {};
    for (const label of tabs) {
      const box = await tabOf(page, label).boundingBox();
      if (!box) return `${label}: no box`;
      if (box.x < -1 || box.y < -1 || box.x + box.width > view.width + 1 || box.y + box.height > view.height + 1) return `${label}: outside the viewport ${JSON.stringify(box)}`;
      boxes[label] = box;
    }
    for (const a of tabs) for (const b of tabs) if (a < b && overlaps(boxes[a], boxes[b])) return `${a} and ${b} overlap`;
    if (openLabel) {
      const panel = await panelOf(page, openLabel).boundingBox();
      if (!panel) return `${openLabel}: panel has no box`;
      for (const label of tabs) if (overlaps(boxes[label], panel)) return `${label} covers the ${openLabel} panel ${JSON.stringify({ tab: boxes[label], panel })}`;
    }
    return "clear";
  }
}

async function expectOnlyOpen(page: Page, label: string | null, tabs: string[]) {
  await expect(open(page)).toHaveCount(label ? 1 : 0);
  for (const name of tabs) await expect(tabOf(page, name)).toHaveAttribute("aria-expanded", String(name === label));
  if (label) await expect(open(page)).toHaveAttribute("data-edge-drawer", label);
}

for (const format of FORMATS) {
  for (const viewport of VIEWPORTS) {
    const where = `${format.id} at ${viewport.width}x${viewport.height}`;

    test(`${where}: the tabs stay clickable while a drawer is open, and hover opens nothing`, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const response = await page.goto(`/dev/table-preview/${format.path}?fixture=review&state=main&reduced=1`);
      expect(response?.ok()).toBe(true);
      await expect(tabOf(page, format.tabs[0])).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const tabs = format.tabs;
      // The drawers that were taken out stay out.
      await expect(page.locator('[data-edge-drawer="Inspect"]')).toHaveCount(0);
      if (!format.hasCardDrawer) await expect(page.locator('[data-edge-drawer="Card"]')).toHaveCount(0);
      await expectOnlyOpen(page, null, tabs);
      await expectTabsClear(page, tabs, null);

      // Hover on every tab with all drawers closed opens nothing.
      for (const name of tabs) {
        await tabOf(page, name).hover();
        await page.waitForTimeout(350);
        await expectOnlyOpen(page, null, tabs);
      }

      // Click the first tab: only that drawer opens, and it keeps every tab in view.
      const first = tabs[0];
      await tabOf(page, first).click();
      await expectOnlyOpen(page, first, tabs);
      await expectTabsClear(page, tabs, first);
      await info.attach(`open-${first}`, { body: await page.screenshot(), contentType: "image/png" });

      // Hover on the other tabs, and on the open panel, changes nothing.
      for (const name of tabs.slice(1)) {
        await tabOf(page, name).hover();
        await page.waitForTimeout(350);
        await expectOnlyOpen(page, first, tabs);
      }

      // Click each other tab: it opens, the old one closes, the tabs stay clear. Then back to the first.
      for (const name of [...tabs.slice(1), first]) {
        await tabOf(page, name).click();
        await expectOnlyOpen(page, name, tabs);
        await expectTabsClear(page, tabs, name);
      }
      await info.attach(`back-to-${first}`, { body: await page.screenshot(), contentType: "image/png" });

      // The tab of the open drawer closes it.
      await tabOf(page, first).click();
      await expectOnlyOpen(page, null, tabs);
      await expectTabsClear(page, tabs, null);

      // Escape closes it too.
      await tabOf(page, tabs[tabs.length - 1]).click();
      await expectOnlyOpen(page, tabs[tabs.length - 1], tabs);
      await page.keyboard.press("Escape");
      await expectOnlyOpen(page, null, tabs);

      expect(errors).toEqual([]);
    });

    test(`${where}: the tabs work from the keyboard`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/dev/table-preview/${format.path}?fixture=review&state=main&reduced=1`);
      const tabs = format.tabs;
      await expect(tabOf(page, tabs[0])).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      // Each tab is a button with aria-expanded and aria-controls that point at its dialog.
      for (const name of tabs) {
        const tab = tabOf(page, name);
        await expect(tab).toHaveAttribute("aria-expanded", "false");
        const controls = await tab.getAttribute("aria-controls");
        expect(controls).toBeTruthy();
        await expect(page.locator(`[id="${controls}"]`)).toHaveAttribute("role", "dialog");
      }

      // Enter opens, Escape closes and the focus returns to the tab, Space opens again.
      await tabOf(page, tabs[0]).focus();
      await page.keyboard.press("Enter");
      await expectOnlyOpen(page, tabs[0], tabs);
      await expect.poll(() => page.evaluate((label) => document.querySelector(`[data-edge-drawer="${label}"] [role="dialog"]`)?.contains(document.activeElement) ?? false, tabs[0])).toBe(true);
      await page.keyboard.press("Escape");
      await expectOnlyOpen(page, null, tabs);
      await expect(tabOf(page, tabs[0])).toBeFocused();
      await page.keyboard.press("Space");
      await expectOnlyOpen(page, tabs[0], tabs);

      // With a drawer open the other tabs are still reachable with the keyboard, and a key press on one switches to it.
      const second = tabs[1];
      await tabOf(page, second).focus();
      await page.keyboard.press("Enter");
      await expectOnlyOpen(page, second, tabs);
      await expectTabsClear(page, tabs, second);

      // Enter on the tab of the open drawer closes it.
      await tabOf(page, second).focus();
      await page.keyboard.press("Enter");
      await expectOnlyOpen(page, null, tabs);
    });

    if (!format.hasCardDrawer) {
      test(`${where}: a click on a card opens the card pop-out and there is no Inspect drawer`, async ({ page }, info) => {
        await page.setViewportSize(viewport);
        await page.goto(`/dev/table-preview/${format.path}?fixture=review&state=main&reduced=1`);
        await expect(tabOf(page, format.tabs[0])).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const preview = page.getByTestId("hover-preview");
        const pinned = page.locator('[data-testid="hover-preview"][data-pinned="true"][data-open="true"]');
        await expect(pinned).toHaveCount(0);
        // A drawer is open when the card is clicked: the click pins the card, the drawer gives way, and no drawer opens.
        await tabOf(page, format.tabs[0]).click();
        await expectOnlyOpen(page, format.tabs[0], format.tabs);
        // A monster the open drawer does not cover (the drawer is on the left in Tag and the 4-way grid).
        const panel = await settledBox(panelOf(page, format.tabs[0]));
        const cards = page.locator('[data-kind="mz"]:has([data-card-art])');
        let target: Locator | null = null;
        await expect(async () => {
          for (let index = 0; index < await cards.count(); index += 1) {
            const box = await cards.nth(index).boundingBox();
            if (box && box.width > 20 && !overlaps(box, panel)) { target = cards.nth(index); break; }
          }
          expect(target).not.toBeNull();
        }).toPass();
        await target!.click({ force: true });
        await expect(pinned).toHaveCount(1);
        await expect(open(page)).toHaveCount(0);
        await expect(page.locator('[data-edge-drawer="Inspect"], [data-edge-drawer="Card"]')).toHaveCount(0);
        // The pop-out has the large art and a close button.
        await expect(preview.locator("img").first()).toBeVisible();
        // A pinned card stays: hovering another card does not replace it.
        const pinnedArt = await preview.locator("img").first().getAttribute("src");
        const others = page.locator('[data-kind="mz"]:has([data-card-art])');
        for (let index = 0; index < await others.count(); index += 1) {
          const box = await others.nth(index).boundingBox();
          const pin = await preview.boundingBox();
          if (box && box.width > 20 && pin && !overlaps(box, pin)) { await others.nth(index).hover({ force: true }); }
        }
        await expect(pinned).toHaveCount(1);
        expect(await preview.locator("img").first().getAttribute("src")).toBe(pinnedArt);
        await info.attach("card-popout", { body: await page.screenshot(), contentType: "image/png" });
        await preview.getByTestId("hover-preview-close").click();
        await expect(pinned).toHaveCount(0);
        await expectTabsClear(page, format.tabs, null);
      });
    } else {
      test(`${where}: the 1v1 room keeps its Card drawer`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto(`/dev/table-preview/${format.path}?fixture=review&state=main&reduced=1`);
        await expect(tabOf(page, "Card")).toBeVisible();
        await tabOf(page, "Card").click();
        await expectOnlyOpen(page, "Card", format.tabs);
        await expectTabsClear(page, format.tabs, "Card");
        await tabOf(page, "Log").click();
        await expectOnlyOpen(page, "Log", format.tabs);
        await tabOf(page, "Card").click();
        await expectOnlyOpen(page, "Card", format.tabs);
      });
    }
  }
}

// Tag, 3-way and 4-way keep every tab on the left edge, stacked close together from the top, clear of the fields, plates and the bottom-left corner.
for (const format of FORMATS.filter((entry) => !entry.hasCardDrawer)) {
  for (const viewport of VIEWPORTS) {
    test(`${format.id} at ${viewport.width}x${viewport.height}: all tabs on the left edge, close together, top down`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/dev/table-preview/${format.path}?fixture=review&state=main&reduced=1`);
      await expect(tabOf(page, format.tabs[0])).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(async () => {
        const rows = await page.$$eval("[data-edge-drawer]", (roots) => roots.map((root) => {
          const box = root.querySelector("[data-edge-tab]")!.getBoundingClientRect();
          return { side: root.getAttribute("data-side"), x: box.x, y: box.y, width: box.width, height: box.height };
        }));
        expect(rows.length).toBe(format.tabs.length);
        expect(rows.every((row) => row.side === "left" && row.x >= -1 && row.x < 4)).toBe(true);
        const sorted = [...rows].sort((a, b) => a.y - b.y);
        for (let i = 1; i < sorted.length; i += 1) {
          const gap = sorted[i].y - (sorted[i - 1].y + sorted[i - 1].height);
          expect(gap, `gap before tab ${i}`).toBeGreaterThanOrEqual(2);
          expect(gap, `gap before tab ${i}`).toBeLessThanOrEqual(12);
        }
        const last = sorted[sorted.length - 1];
        expect(last.y + last.height).toBeLessThan(viewport.height * 0.55);
      }).toPass();
      // No tab covers a visible card zone or a header pill.
      const covered = await page.evaluate(() => {
        const tabs = [...document.querySelectorAll("[data-edge-tab]")].map((el) => el.getBoundingClientRect());
        const others = [...document.querySelectorAll("[data-kind], [data-testid='hud-top'] > *")].filter((el) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && getComputedStyle(el).visibility !== "hidden";
        });
        return others.filter((el) => {
          const o = el.getBoundingClientRect();
          return tabs.some((t) => t.x + 1 < o.x + o.width && o.x + 1 < t.x + t.width && t.y + 1 < o.y + o.height && o.y + 1 < t.y + t.height);
        }).length;
      });
      expect(covered).toBe(0);
    });
  }
}

test("a narrow phone screen has no edge drawers", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["tag", "ffa3", "ffa4", "classic/room"]) {
    await page.goto(`/dev/table-preview/${path}?fixture=review&state=main&reduced=1`);
    await page.waitForTimeout(600);
    await expect(page.locator("[data-edge-drawer]")).toHaveCount(0);
  }
});
