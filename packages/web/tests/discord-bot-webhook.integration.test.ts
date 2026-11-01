import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import type Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, migrate } from "@yugidraft/shared/db";
import { createWaitlistService, deleteUserAccount } from "@yugidraft/shared/services";
import { createCreatorAccessService } from "@yugidraft/shared/services/creator-access";
import { claimOutbox, markPosted } from "@yugidraft/shared/discord-admin";

const state = vi.hoisted(() => ({ db: null as Database.Database | null }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));
import { POST } from "../app/api/webhooks/clerk/route";

let directory: string;
const key = Buffer.alloc(32, 7);
const secret = `whsec_${key.toString("base64")}`;
const time = Date.parse("2026-10-19T12:00:00Z");
const event = { type: "waitlistEntry.created", timestamp: time,
  data: { id: "wle_network", email_address: "player@example.test", created_at: time } };
function signed(payload: unknown = event, id = "msg_network") {
  const body = JSON.stringify(payload);
  const seconds = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", key).update(`${id}.${seconds}.${body}`).digest("base64");
  return new NextRequest("https://app.example.test/api/webhooks/clerk", { method: "POST", body,
    headers: { "Content-Type": "application/json", "content-length": String(Buffer.byteLength(body)),
      "svix-id": id, "svix-timestamp": String(seconds), "svix-signature": `v1,${signature}` } });
}

function creatorSignup(uses = 3, label: string | null = "Launch crew") {
  const service = createCreatorAccessService(state.db!, { now: () => time - 60_000 });
  const creator = service.createCreator({ name: "Kaiba Plays", actorUserId: 1 });
  const link = service.createLink(creator.id, { maxUses: uses, expiresInDays: 14, label, actorUserId: 1 })!;
  const claim = service.claimLinkGrant(link.code, "a.b+invite@googlemail.com");
  if (claim.kind !== "claimed") throw new Error("Expected creator grant");
  return { grantId: claim.grantId, signup: { type: "user.created", data: { id: "user_creator", created_at: time,
    primary_email_address_id: "email_creator", email_addresses: [{ id: "email_creator", email_address: "ab+account@gmail.com" }],
    public_metadata: { ddGrant: claim.grantId }, unsafe_metadata: { heardFrom: "youtube", heardFromDetail: "Launch video" } } } };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "discord-webhook-"));
  state.db = openDatabase(join(directory, "test.sqlite"));
  vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", secret);
  vi.stubEnv("DISCORD_ADMIN_OUTBOX_ENABLED", "1");
  vi.stubEnv("DISCORD_WAITLIST_CHANNEL_ID", "waitlist-channel");
  vi.stubEnv("DISCORD_JOIN_REQUEST_ALERTS_ENABLED", "1");
  vi.stubEnv("DISCORD_SIGNUP_ALERTS_ENABLED", "1");
  vi.stubEnv("DISCORD_ADMIN_SHOW_FULL_EMAIL", "1");
  vi.stubEnv("DISCORD_ADMIN_WEBHOOK_URL", "https://discord.invalid/should-not-be-used");
});
afterEach(() => {
  state.db?.close();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("verified Clerk events to the durable Discord outbox", () => {
  it.each([[1, "Personal"], [3, "Friends"]] as const)("queues a creator %s-use sign-up without a waitlist entry or local account", async (uses, type) => {
    vi.stubEnv("DISCORD_JOIN_REQUEST_ALERTS_ENABLED", "0");
    const { signup } = creatorSignup(uses);
    expect((await POST(signed(signup))).status).toBe(200);
    expect((await POST(signed(signup, "msg_creator_replay"))).status).toBe(200);
    const rows = state.db!.prepare<[], { kind: string; payload_json: string }>("select kind,payload_json from discord_outbox").all();
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("signup_alert");
    expect(JSON.parse(rows[0].payload_json)).toMatchObject({ allowed_mentions: { parse: [] }, embeds: [{ fields: expect.arrayContaining([
      { name: "Email", value: "`a***@gmail.com`" },
      { name: "Creator invite", value: `Kaiba Plays · Launch crew \\(${type}\\)` },
      { name: "Heard from", value: "YouTube · Launch video" },
    ]) }] });
    expect(rows[0].payload_json).not.toContain("ab+account@gmail.com");
    expect(rows[0].payload_json).not.toContain("a.b+invite@googlemail.com");
    expect(state.db!.prepare("select * from waitlist_signups").all()).toEqual([]);
    expect(state.db!.prepare("select * from users").all()).toEqual([]);
  });

  it("falls back to an allowlist grant and the waitlist heard-from answer", async () => {
    const { grantId, signup } = creatorSignup();
    state.db!.prepare("update creator_grants set kind='allowlist',link_id=null where id=?").run(grantId);
    createWaitlistService(state.db!).join("ab+account@gmail.com", { heardFrom: "twitch", heardFromDetail: "Kaiba live" });
    expect((await POST(signed({ ...signup, data: { ...signup.data, public_metadata: {}, unsafe_metadata: { heardFrom: "creator" } } }))).status).toBe(200);
    const row = state.db!.prepare<[], { payload_json: string }>("select payload_json from discord_outbox where kind='signup_alert'").get()!;
    expect(JSON.parse(row.payload_json).embeds[0].fields).toEqual(expect.arrayContaining([
      { name: "Creator email invite", value: "Kaiba Plays" }, { name: "Heard from", value: "Twitch · Kaiba live" },
    ]));
  });

  it("does not create another alert when attribution arrives after the first alert was posted", async () => {
    const { signup } = creatorSignup();
    state.db!.exec("delete from creator_grants");
    expect((await POST(signed({ ...signup, data: { ...signup.data, public_metadata: {} } }))).status).toBe(200);
    const [row] = claimOutbox(state.db!, 1);
    expect(row.payload_json).not.toContain("Creator invite");
    expect(markPosted(state.db!, row, { messageId: "posted_creator" })).toBe(true);
    state.db!.prepare(`insert into creator_grants(creator_id,kind,email,email_key,status,created_at)
      values(1,'allowlist','ab+account@gmail.com','ab@gmail.com','sent',?)`).run(time - 60_000);
    expect((await POST(signed(signup, "msg_late_attribution"))).status).toBe(200);
    expect(state.db!.prepare("select status,payload_json from discord_outbox").all()).toEqual([{ status: "posted", payload_json: null }]);
  });

  it("deletes attributed alert data after an email change before local sign-in", async () => {
    const { signup } = creatorSignup();
    expect((await POST(signed(signup))).status).toBe(200);
    state.db!.exec(`insert into users(id,username,display_name,clerk_user_id,email)
      values(1,'creator-friend','Friend','user_creator','changed@example.test')`);
    deleteUserAccount(state.db!, 1);
    expect(state.db!.prepare("select * from discord_outbox").all()).toEqual([]);
    expect(state.db!.prepare("select * from join_request_notifications").all()).toEqual([]);
    expect(state.db!.prepare("select * from discord_join_subjects").all()).toEqual([]);
  });

  it("binds a local alert to Clerk, deduplicates different signed deliveries, and keeps email masked", async () => {
    createWaitlistService(state.db!).join("player@example.test");
    expect((await POST(signed())).status).toBe(200);
    expect((await POST(signed())).status).toBe(200);
    expect((await POST(signed(event, "msg_other"))).status).toBe(200);
    const rows = state.db!.prepare("select * from discord_outbox").all();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).toContain("p***@example.test");
    expect(JSON.stringify(rows)).not.toContain("player@example.test");
    expect(state.db!.prepare("select clerk_entry_id from discord_waitlist_actions").get()).toEqual({ clerk_entry_id: "wle_network" });
    expect(state.db!.prepare("select count(*) as n from clerk_webhook_receipts").get()).toEqual({ n: 2 });
  });

  it("queues a separate masked sign-up alert and supports users without email", async () => {
    const signup = { type: "user.created", data: { id: "user_network", created_at: time,
      primary_email_address_id: "email_primary", email_addresses: [{ id: "email_primary", email_address: "member@example.test" }] } };
    expect((await POST(signed(signup))).status).toBe(200);
    expect((await POST(signed({ ...signup, data: { id: "user_without_email", created_at: time } }, "msg_no_email"))).status).toBe(200);
    const rows = state.db!.prepare("select kind,payload_json from discord_outbox").all();
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain("member@example.test");
    expect(rows).toMatchObject([{ kind: "signup_alert" }, { kind: "signup_alert" }]);
    expect(state.db!.prepare("select * from discord_waitlist_actions").all()).toEqual([]);
  });

  it("rolls the receipt and claim back after a storage failure so the signed delivery can retry", async () => {
    state.db!.exec("drop table discord_outbox");
    expect((await POST(signed())).status).toBe(503);
    expect(state.db!.prepare("select * from clerk_webhook_receipts").all()).toEqual([]);
    expect(state.db!.prepare("select * from join_request_notifications").all()).toEqual([]);
    expect(state.db!.prepare("select * from discord_waitlist_actions").all()).toEqual([]);
    migrate(state.db!);
    expect((await POST(signed())).status).toBe(200);
    expect(state.db!.prepare("select count(*) as n from discord_outbox").get()).toEqual({ n: 1 });
  });

  it("rejects a bad signature before receipt or outbox writes", async () => {
    const request = signed();
    request.headers.set("svix-signature", "v1,invalid");
    expect((await POST(request)).status).toBe(400);
    expect(state.db!.prepare("select * from discord_outbox").all()).toEqual([]);
    expect(state.db!.prepare("select * from clerk_webhook_receipts").all()).toEqual([]);
  });
});
