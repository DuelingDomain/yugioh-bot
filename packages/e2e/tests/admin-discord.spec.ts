import { test, expect } from "../helpers/fixtures";
import { openDatabase } from "@yugidraft/shared/db";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dbPath, stackDir, webUrl } from "../stack/env.mjs";

test.skip(process.env.E2E_DISCORD_ADMIN !== "1", "Use the disposable Discord/Clerk boundary stubs");
test.describe.configure({ mode: "serial" });
function events(): any[] {
  try { return readFileSync(join(stackDir, "discord-admin-http.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)); }
  catch { return []; }
}
test("owner confirms approve and reject; member and anonymous sessions cannot act; repeats have one effect", async ({ player, request }) => {
  const owner = await player("p1"), member = await player("p2");
  const db = openDatabase(dbPath);
  try {
    for (const decision of ["Approve", "Reject"]) {
      const id = `waitlist_e2e_${decision.toLowerCase()}`;
      const body = JSON.stringify({ type: "waitlistEntry.created", data: { id, email_address: `${decision.toLowerCase()}@example.test`, created_at: Date.now() } });
      const seconds = Math.floor(Date.now() / 1000), deliveryId = `msg_${id}`;
      const signature = createHmac("sha256", Buffer.from(process.env.E2E_CLERK_WEBHOOK_SECRET!)).update(`${deliveryId}.${seconds}.${body}`).digest("base64");
      expect((await request.post("/api/webhooks/clerk", { data: body, headers: { "content-type": "application/json", "svix-id": deliveryId,
        "svix-timestamp": String(seconds), "svix-signature": `v1,${signature}` } })).status()).toBe(200);
      const row = () => db.prepare("select * from discord_waitlist_actions where clerk_entry_id=?").get(id) as any;
      await expect.poll(() => row()?.discord_message_id).toBeTruthy();
      const field = JSON.parse(row().message_json).embeds[0].fields.find((field: any) => field.name === "Owner action").value;
      const url = new RegExp(`\\[${decision}\\]\\(([^)]+)\\)`).exec(field)![1];
      const effects = () => events().filter(e => e.service === "clerk" && e.path.includes(id));
      expect((await request.get(url, { maxRedirects: 0 })).status()).toBe(307);
      await member.page.goto(url);
      await expect(member.page.getByText("Only the app owner can manage waitlist requests.")).toBeVisible();
      expect((await member.context.request.post(url, { headers: { origin: webUrl } })).status()).toBe(403);
      await owner.page.goto(url);
      await expect(owner.page.getByRole("button", { name: `${decision} request` })).toBeVisible();
      expect(effects()).toHaveLength(0);
      expect((await owner.context.request.post(url, { headers: { origin: "https://evil.example.test" } })).status()).toBe(403);
      await owner.page.getByRole("button", { name: `${decision} request` }).click();
      const result = `${decision === "Approve" ? "Approved" : "Rejected"} by E2E Alice`;
      await expect(owner.page.getByText(result)).toBeVisible();
      expect((await owner.context.request.post(url, { headers: { origin: webUrl } })).status()).toBe(200);
      await owner.page.reload();
      await expect(owner.page.getByText(result)).toBeVisible();
      expect(effects()).toHaveLength(1);
      expect(events().some(e => e.channel === "alerts" && e.method === "PATCH" && e.decision === result)).toBe(true);
    }
  } finally { db.close(); }
});

test("visible app heartbeat sends templates, pauses when hidden, and reaches the worker's one status message", async ({ player }) => {
  const alice = await player("p1");
  const db = openDatabase(dbPath);
  try {
    await alice.page.clock.install();
    await alice.page.goto("/dashboard?private=must-not-store");
    await expect.poll(() => db.prepare("select last_route from users where id=101").get()).toEqual({ last_route: "/dashboard" });
    db.prepare("update users set last_seen_at=last_seen_at-60000 where id=101").run();
    await alice.page.goto("/decks/new?private=must-not-store");
    await expect.poll(() => db.prepare("select last_route from users where id=101").get()).toEqual({ last_route: "/decks/new" });
    const seen = () => (db.prepare("select last_seen_at from users where id=101").get() as any).last_seen_at;
    const before = seen();
    let beats = 0;
    alice.page.on("request", r => { if (r.url().endsWith("/api/presence")) beats++; });
    await alice.page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
    await alice.page.clock.fastForward(120_000);
    expect(beats).toBe(0);
    expect(seen()).toBe(before);
    db.prepare("update users set last_seen_at=last_seen_at-60000 where id=101").run();
    await alice.page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
    await expect.poll(seen).toBeGreaterThan(before);
    await expect.poll(() => events().filter(e => e.channel === "status" && e.method === "PATCH").at(-1)?.content,
      { timeout: 75_000 }).toContain("E2E Alice — Deck builder");
    expect(events().filter(e => e.channel === "status" && e.method === "POST")).toHaveLength(1);
    expect(new Set(events().filter(e => e.channel === "status").map(e => e.id)).size).toBe(1);
  } finally { db.close(); }
});
