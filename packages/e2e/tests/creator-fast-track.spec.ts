import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase } from "@yugidraft/shared/db";
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { authFile } from "../helpers/players";
import { dbPath, webUrl } from "../stack/env.mjs";

// Creator fast-track: the owner makes a creator and a 2-use invite link in /admin#creators, a signed-out visitor
// sends two invites through /join/<code>, the third visit sees "full", and a revoked link reads "closed".
// Needs the stack started like admin-console.spec.ts (the fetch stub answers Clerk invitations, nothing leaves the machine):
//   E2E_ADMIN_CONSOLE=1 E2E_OWNER_USER_IDS=101 E2E_SLOT=N npx playwright test creator-fast-track
// E2E_FAST_TRACK_SHOTS_DIR=<dir> also saves every new screen at four screen sizes.
test.skip(process.env.E2E_ADMIN_CONSOLE !== "1" || process.env.E2E_OWNER_USER_IDS !== "101", "set E2E_ADMIN_CONSOLE=1 and E2E_OWNER_USER_IDS=101");
test.describe.configure({ mode: "serial" });

const CREATOR = "E2E Kaiba Plays";
const LABEL = "Stream two";
const SENT_COPY = "If this email can join, your invite is on its way. Check your inbox.";
const view = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
/** The code of the 2-use link made in the first test; the screenshot test shows it as "closed". */
let closedCode = "";

async function openCreatorSheet(page: Page) {
  await view(page, "Creators").getByRole("row", { name: new RegExp(CREATOR) }).click();
  const sheet = page.getByRole("dialog", { name: `Creator ${CREATOR}` });
  await expect(sheet.getByRole("heading", { name: CREATOR })).toBeVisible();
  return sheet;
}

test("owner makes a 2-use link; two invites go out; the link is then full, and closed after Revoke", async ({ browser }) => {
  const owner = await browser.newContext({ storageState: authFile("p1") });
  const visitor = await browser.newContext();
  try {
    // Owner: add the creator, then a custom link with 2 uses.
    const admin = await owner.newPage();
    await admin.goto("/admin#creators");
    const creators = view(admin, "Creators");
    await creators.getByRole("button", { name: "Add creator" }).click();
    const add = admin.getByRole("dialog", { name: "Add creator" });
    await add.getByLabel("Name").fill(CREATOR);
    await add.getByLabel("Channel link").fill("https://youtube.example.test/@kaiba");
    await add.getByRole("button", { name: "Add creator", exact: true }).click();
    const sheet = admin.getByRole("dialog", { name: `Creator ${CREATOR}` });
    await expect(sheet.getByRole("heading", { name: CREATOR })).toBeVisible();
    const form = sheet.getByRole("form", { name: "New link" });
    await form.getByRole("button", { name: "Custom" }).click();
    await form.getByLabel("Uses").fill("2");
    await form.getByLabel("Days").fill("30");
    await form.getByLabel("Label").fill(LABEL);
    await form.getByRole("button", { name: "Make link" }).click();
    const row = sheet.getByRole("list", { name: "Invite links" }).getByRole("listitem").filter({ hasText: LABEL });
    await expect(row).toContainText("0 / 2 used");
    const url = (await row.locator("code").textContent())?.trim() ?? "";
    expect(url).toMatch(new RegExp(`^${webUrl}/join/[A-Za-z0-9]{12}$`));
    const code = url.slice(url.lastIndexOf("/") + 1);

    // Visitor: two emails, each answered with the same "check your inbox" copy.
    const join = await visitor.newPage();
    await join.goto(`/join/${code}`);
    await expect(heading(join)).toHaveText(`Invited by ${CREATOR}`);
    await expect(join.getByText("Spots left")).toBeVisible();
    for (const [i, email] of ["fan.one@example.test", "fan.two@example.test"].entries()) {
      if (i > 0) await join.getByRole("button", { name: "Use a different email" }).click();
      await join.getByLabel("Email address").fill(email);
      await join.getByRole("button", { name: "Send my invite" }).click();
      await expect(heading(join)).toHaveText("Check your inbox");
      await expect(join.getByText(SENT_COPY)).toBeVisible();
    }
    // The page holds no ticket or invitation link.
    expect(await join.content()).not.toMatch(/__clerk_ticket|ticket=e2e|clerk\.example\.test|inv_e2e/);

    // A third visit: the link is full and offers the normal waitlist form.
    await join.goto(`/join/${code}`);
    await expect(heading(join)).toHaveText("This invite link is full");
    await expect(join.getByLabel("Email address")).toBeVisible();
    await expect(join.getByRole("button", { name: "Join the waitlist" })).toBeVisible();

    // Owner: 2 invites sent, then Revoke. A reload, because a goto to the same URL with a hash does not load again.
    await admin.reload();
    const creatorRow = view(admin, "Creators").getByRole("row", { name: new RegExp(CREATOR) });
    await expect(creatorRow.getByRole("cell").nth(2)).toHaveText("2");
    const detail = await openCreatorSheet(admin);
    const linkRow = detail.getByRole("list", { name: "Invite links" }).getByRole("listitem").filter({ hasText: LABEL });
    await expect(linkRow).toContainText("2 / 2 used");
    await expect(linkRow).toContainText("Full");
    await linkRow.getByRole("button", { name: `Revoke ${LABEL}` }).click();
    await expect(linkRow.getByRole("status")).toHaveText("Revoke this link? Unused invites stop working.");
    await linkRow.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(admin.getByRole("status").filter({ hasText: "Link revoked. 2 unused invites cancelled." })).toBeVisible();
    await expect(linkRow).toContainText("Revoked");
    const db = openDatabase(dbPath);
    try {
      expect(db.prepare("select g.status from creator_grants g join creator_links l on l.id = g.link_id where l.code = ? order by g.id").all(code))
        .toEqual([{ status: "revoked" }, { status: "revoked" }]);
    } finally { db.close(); }

    // Visitor: the revoked link reads closed.
    await join.goto(`/join/${code}`);
    await expect(heading(join)).toHaveText("This invite link is closed");
    await expect(join.getByRole("button", { name: "Join the waitlist" })).toBeVisible();
    closedCode = code;
  } finally { await owner.close(); await visitor.close(); }
});

const SIZES = [
  { name: "1080p", width: 1920, height: 1080 },
  { name: "1440p", width: 2560, height: 1440 },
  { name: "768p", width: 1366, height: 768 },
  { name: "mobile", width: 390, height: 844 },
] as const;

/** An open link and a full link for the shots. The full one is filled in the DB, so no join post is spent. */
async function shotLinks(owner: BrowserContext): Promise<{ open: string; full: string }> {
  const post = async (path: string, data: unknown) => {
    const response = await owner.request.post(path, { headers: { origin: webUrl }, data });
    expect(response.status(), path).toBe(201);
    return response.json();
  };
  const { creator } = await post("/api/admin/console/creators", { name: "E2E Shots Creator" });
  const open = (await post(`/api/admin/console/creators/${creator.id}/links`, { label: "Community", maxUses: 50, expiresInDays: 30 })).link;
  const full = (await post(`/api/admin/console/creators/${creator.id}/links`, { label: "Personal", maxUses: 1, expiresInDays: 14 })).link;
  const db = openDatabase(dbPath);
  try {
    const now = Date.now();
    db.prepare(`insert into creator_grants(creator_id, link_id, kind, email, email_key, status, created_at, sent_at, expires_at)
      values (?, ?, 'link', 'shots.full@example.test', 'shots.full@example.test', 'sent', ?, ?, ?)`)
      .run(creator.id, full.id, now, now, now + 7 * 24 * 3600_000);
  } finally { db.close(); }
  return { open: open.code, full: full.code };
}

async function newSizedContext(browser: Browser, size: (typeof SIZES)[number], storageState?: string) {
  const phone = size.width <= 760;
  return browser.newContext({ storageState, viewport: { width: size.width, height: size.height }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 });
}

test("every new screen at 1920, 2560, 1366 and 390 wide, with no sideways scroll", async ({ browser }) => {
  const shots = process.env.E2E_FAST_TRACK_SHOTS_DIR;
  test.skip(!shots, "set E2E_FAST_TRACK_SHOTS_DIR to save the screens");
  test.setTimeout(300_000);
  mkdirSync(shots!, { recursive: true });
  expect(closedCode, "the first test makes the closed link").not.toBe("");
  const setup = await browser.newContext({ storageState: authFile("p1") });
  const links = await shotLinks(setup).finally(() => setup.close());

  for (const size of SIZES) {
    const owner = await newSizedContext(browser, size, authFile("p1"));
    const visitor = await newSizedContext(browser, size);
    const save = async (page: Page, screen: string) => {
      await page.waitForTimeout(450);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect.soft(overflow, `${screen} at ${size.name} scrolls sideways`).toBeLessThanOrEqual(0);
      await page.screenshot({ path: resolve(shots!, `${screen}-${size.name}.png`) });
    };
    try {
      const admin = await owner.newPage();
      await admin.goto("/admin#creators");
      await expect(view(admin, "Creators").getByRole("row", { name: new RegExp(CREATOR) })).toBeVisible();
      await save(admin, "creators");
      const sheet = await openCreatorSheet(admin);
      await expect(sheet.getByRole("list", { name: "Invite links" })).toBeVisible();
      await save(admin, "creator-sheet");
      await sheet.getByRole("button", { name: "Close" }).click();
      await view(admin, "Creators").getByRole("button", { name: "Add creator" }).click();
      await expect(admin.getByRole("dialog", { name: "Add creator" }).getByLabel("Name")).toBeVisible();
      await save(admin, "add-creator");

      const page = await visitor.newPage();
      await page.goto(`/join/${links.open}`);
      await expect(heading(page)).toHaveText("Invited by E2E Shots Creator");
      await save(page, "join-open");
      // The sent card, with the answer faked in the browser so no join post (5 per IP) is spent.
      await page.route("**/api/join/*", (route) => route.fulfill({ status: 200, json: { status: "sent" } }));
      await page.getByLabel("Email address").fill("shots@example.test");
      await page.getByRole("button", { name: "Send my invite" }).click();
      await expect(heading(page)).toHaveText("Check your inbox");
      await save(page, "join-sent");
      await page.unroute("**/api/join/*");
      await page.goto(`/join/${links.full}`);
      await expect(heading(page)).toHaveText("This invite link is full");
      await save(page, "join-full");
      await page.goto(`/join/${closedCode}`);
      await expect(heading(page)).toHaveText("This invite link is closed");
      await save(page, "join-closed");

      // Sign-in cards with the heard-from select (the preview page is on in the e2e stack: DUEL_FX_LAB=1).
      await page.goto("/dev/sign-in-preview?step=err-invite");
      await expect(page.getByLabel(/How did you hear about us/)).toBeVisible();
      await save(page, "not-invited");
      await page.goto("/dev/sign-in-preview?step=invite");
      await expect(page.getByLabel(/How did you hear about us/)).toBeVisible();
      await save(page, "create-account");
    } finally { await owner.close(); await visitor.close(); }
  }
});
