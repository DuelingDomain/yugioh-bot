import type { Page } from "@playwright/test";
import { expect, test } from "../helpers/fixtures";
import { enterDuelRoom } from "../helpers/duel";
import { cleanNames, SHOT_NAMES, shotDir } from "./shot";

// Marketing screenshots of mid-game boards. Each board is a "marketing-*" scenario preset of the duel host
// (packages/duel-server/src/presets/marketing-boards.ts, DUEL_SCENARIOS=1 only). Seeded test players, practice bots
// that only pass, and real card art (E2E_REAL_CARD_ART=1).

/**
 * The server names every bot "Practice Bot" and the table header carries a table code and bug-report buttons.
 * For the shots, show plain names and a clean header. This changes the displayed text only; nothing is stored.
 */
async function cleanScreen(page: Page) {
  await page.addInitScript((bots: string[]) => {
    const seatAttrs = ["data-seat", "data-lp-seat", "data-member-seat", "data-hand-seat", "data-seat-btn", "data-seat-switch", "data-seat-field"];
    const seatOf = (node: Node): number | null => {
      for (let el: Element | null = node.parentElement; el; el = el.parentElement) {
        for (const name of seatAttrs) if (el.hasAttribute(name)) return Number(el.getAttribute(name));
        const cam = el.getAttribute("data-cam")?.match(/:(\d)$/);
        if (cam) return Number(cam[1]);
        if (el.getAttribute("data-testid") === "clock-cell" || (el.parentElement?.matches("[data-baton-strip]") && el.tagName === "LI")) {
          return [...el.parentElement!.children].indexOf(el);
        }
      }
      // Tag plates start with the team and the member: 1A, 2A, 1B, 2B are seats 0, 1, 2, 3.
      for (let el: Element | null = node.parentElement, depth = 0; el && depth < 3; el = el.parentElement, depth += 1) {
        const label = el.textContent?.trim().match(/^([12])([AB])\b/);
        if (label) return (label[2] === "B" ? 2 : 0) + Number(label[1]) - 1;
      }
      return null;
    };
    const walk = () => {
      const nodes = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = nodes.nextNode(); node; node = nodes.nextNode()) {
        const text = node.nodeValue ?? "";
        if (/^[A-Z]{2}\d$/.test(text.trim())) { node.nodeValue = ""; continue; }
        if (/^\s*·\s*\d-player/.test(text)) { node.nodeValue = text.replace(/^\s*·\s*/, ""); continue; }
        if (/^\s*·\s*$/.test(text) && node.parentElement?.closest("header")) { node.nodeValue = ""; continue; }
        if (!/practice/i.test(text)) continue;
        node.nodeValue = text.replace(/practice(?: bot)?(?: \(seat (\d)\))?/gi, (all, shown?: string) => {
          const seat = shown ? Number(shown) - 1 : seatOf(node) ?? 1;
          const name = bots[Math.min(Math.max(seat, 1), bots.length) - 1]!;
          return all === all.toUpperCase() ? name.toUpperCase() : name;
        });
      }
      for (const button of document.querySelectorAll("header button")) {
        if (/^(Report bug|Report|Cancel duel|Surrender)$/.test(button.textContent?.trim() ?? "")) (button as HTMLElement).style.display = "none";
      }
    };
    new MutationObserver(() => requestAnimationFrame(walk)).observe(document, { subtree: true, childList: true, characterData: true });
  }, SHOT_NAMES.bots);
}

/** The duel host can still be starting when the first test runs, so retry the start. */
async function startPreset(page: Page, presetId: string): Promise<string> {
  let slug = "";
  await expect(async () => {
    const response = await page.request.post("/api/duels/preset", { data: { presetId, seed: ["11", "22", "33", "44"] }, timeout: 60_000 });
    expect(response.ok(), await response.text()).toBe(true);
    slug = ((await response.json()) as { slug: string }).slug;
  }).toPass({ timeout: 90_000, intervals: [2_000, 5_000] });
  return slug;
}

/** Close the card drawer and any toast, and move the pointer off the cards, so the shot shows the board. */
async function tidy(page: Page) {
  await page.waitForTimeout(3000);
  // The turn can open on a "use an effect?" question. Decline, so the board waits in the Main Phase.
  const decline = page.getByRole("button", { name: "No", exact: true });
  for (let step = 0; step < 8 && await decline.isVisible().catch(() => false); step += 1) {
    await decline.click();
    await page.waitForTimeout(1200);
  }
  const close = page.getByRole("button", { name: /^close/i });
  if (await close.first().isVisible().catch(() => false)) await close.first().click();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(3500);
}

async function boardShot(page: Page, presetId: string, file: string) {
  await cleanNames();
  await cleanScreen(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const slug = await startPreset(page, presetId);
  await page.goto(`/duels/${slug}?window=1`);
  await enterDuelRoom(page);
  await tidy(page);
  await page.screenshot({ path: shotDir(file) });
  await page.request.post(`/api/duels/${slug}/surrender`);
}

test("4-player free-for-all board", async ({ player }) => {
  const { page } = await player("p1");
  await boardShot(page, "marketing-ffa4", "ffa4.png");
});

test("2v2 Tag board", async ({ player }) => {
  const { page } = await player("p1");
  await boardShot(page, "marketing-tag", "tag.png");
});

test("Domain Format board with the Deck Master zone", async ({ player }) => {
  const { page } = await player("p1");
  await boardShot(page, "marketing-domain", "domain-board.png");
});
