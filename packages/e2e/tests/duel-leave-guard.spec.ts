import type { Page } from "@playwright/test";
import { test, expect } from "../helpers/fixtures";
import { createStandardTable, enterDuelRoom, importDeckAndReady, uniqueTableName } from "../helpers/duel";

// The leave warning is for leaving the duel. A seat or view switch rewrites the query of the same duel URL in place
// (the dev sandbox does it with `?as=`); it must stay silent. Another page still asks.
const LEAVE_PROMPT = /^Leave this active duel\? You are (playing|watching)\./;

/** Records every browser dialog and dismisses it, so a leave that asks stays on the page. */
function watchDialogs(page: Page): string[] {
  const seen: string[] = [];
  page.on("dialog", (dialog) => {
    seen.push(dialog.message());
    void dialog.dismiss();
  });
  return seen;
}

/** The same in-place URL rewrite a seat switch makes. */
async function rewriteQuery(page: Page, query: string): Promise<void> {
  await page.evaluate((search) => {
    const url = new URL(window.location.href);
    url.search = search;
    window.history.replaceState(window.history.state, "", url);
  }, query);
}

async function clickLinkTo(page: Page, href: string): Promise<void> {
  await page.evaluate((target) => {
    const link = document.createElement("a");
    link.href = target;
    link.textContent = "leave-guard-probe";
    link.id = "leave-guard-probe";
    document.body.append(link);
  }, href);
  await page.locator("#leave-guard-probe").click();
}

test("a seat or view switch in the same duel does not ask to leave; another page still does", async ({ player }) => {
  const host = await player("p5");
  const spectator = await player("p4");
  const slug = await createStandardTable(host.page, uniqueTableName("leave"));
  await host.page.getByRole("button", { name: "Add practice bot" }).click();
  await importDeckAndReady(host.page);
  const start = host.page.getByRole("button", { name: /^Start duel/ });
  await expect(start).toBeEnabled();
  await start.click();
  await enterDuelRoom(host.page);
  await spectator.page.goto(`/duels/${slug}`);
  await expect(spectator.page.getByText("You are spectating")).toBeVisible();

  for (const { page, name } of [{ page: host.page, name: "player" }, { page: spectator.page, name: "spectator" }]) {
    const dialogs = watchDialogs(page);
    await rewriteQuery(page, "?as=1");
    await expect(page).toHaveURL(new RegExp(`/duels/${slug}\\?as=1$`));
    await rewriteQuery(page, "?as=2&reveal=1");
    await expect(page).toHaveURL(new RegExp(`/duels/${slug}\\?as=2&reveal=1$`));
    await rewriteQuery(page, "");
    await expect(page).toHaveURL(new RegExp(`/duels/${slug}$`));
    expect(dialogs, `${name}: a switch inside the duel asked to leave`).toEqual([]);

    await clickLinkTo(page, "/decks");
    await expect.poll(() => dialogs.length, { message: `${name}: leaving for /decks must ask` }).toBe(1);
    expect(dialogs[0]).toMatch(LEAVE_PROMPT);
    await expect(page).toHaveURL(new RegExp(`/duels/${slug}$`));
  }
});
