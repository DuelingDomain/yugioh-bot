import type { ClerkUserJson } from "../src/clerk/backend.js";
import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { openDatabase, migrate } from "../src/db/index.js";
import * as services from "../src/services/index.js";

afterEach(() => vi.unstubAllEnvs());

it("reserves one release broadcast and safely resumes personalized deliveries with fake Clerk and Resend", async () => {
  expect(services).toHaveProperty("createReleaseService");
  const email = await import("../src/email/index.js");
  const { createClerkBackend } = await import("../src/clerk/backend.js");
  const directory = mkdtempSync(join(tmpdir(), "release-email-"));
  const path = join(directory, "test.sqlite");
  let db = openDatabase(path);
  try {
    email.recordEmailConsent(db, "legacy@example.test", { provenance: "public-waitlist-form", textVersion: "alpha-news-v1" });
    db.exec("drop index release_email_deliveries_subject_idx; alter table release_email_deliveries drop column subject_clerk_id; alter table email_budget drop column failures; alter table email_consents drop column source");
    migrate(db); // Upgrade the original release-storage revision as well as a fresh/repeated migration.
    expect(db.prepare("select source,provenance from email_consents where recipient_key=?").get(email.recipientKey(db, "legacy@example.test")))
      .toEqual({ source: "public-waitlist-form", provenance: "public-waitlist-form" });
    db.exec("insert into users(id,username,display_name) values(1,'owner','Owner')");
    const config = email.emailConfig({ RESEND_API_KEY: "fake", MAIL_POSTAL_ADDRESS: "123 Test Street", CLERK_SECRET_KEY: "fake-clerk", WEB_URL: "https://app.example.test" });
    const releases = services.createReleaseService(db);
    const release = releases.createDraft({ version: "0.3.0", title: "News <safe>", major: false, highlights: ["Deck help"], sections: [{ kind: "new", items: ["**Deck help <safe>**"] }] });
    releases.publish(release.id, { actorUserId: 1, autoEmail: true });
    expect(db.prepare("select count(*) n from release_email_sends").get()).toEqual({ n: 0 });
    const clerkRequests: string[] = [];
    const member: ClerkUserJson = { username: null, first_name: null, last_name: null, image_url: null, external_id: null, external_accounts: [], id: "u1", primary_email_address_id: "e1", email_addresses: [{ id: "e1", email_address: "member@example.test", verification: { status: "verified" } }] };
    const clerk = createClerkBackend({ secretKey: "fake", fetch: async (input) => {
      const url = new URL(String(input)); clerkRequests.push(url.pathname + url.search);
      expect(url.searchParams.get("limit")).toBe("100");
      const offset = Number(url.searchParams.get("offset") ?? 0);
      if (url.pathname.endsWith("/users")) return Response.json(offset ? { data: [], total_count: 1 } : { data: [member], total_count: 1 });
      if (url.pathname.endsWith("/invitations")) return Response.json({ data: [
        { id: "i0", email_address: "MEMBER@example.test", status: "pending", expires_at: Date.now() + 86400000, url: "https://clerk.example.test/ticket/duplicate" },
        { id: "i1", email_address: "invite@example.test", status: "pending", expires_at: Date.now() + 86400000, url: "https://clerk.example.test/ticket/secret" },
        { id: "i2", email_address: "expired@example.test", status: "pending", expires_at: 1, url: "https://clerk.example.test/expired" },
      ], total_count: 3 });
      if (url.pathname.endsWith("/waitlist_entries")) return Response.json({ data: url.searchParams.get("status") === "pending" ? [
        { id: "w1", email_address: "wait@example.test", status: "pending" },
        { id: "w2", email_address: "suppressed@example.test", status: "pending" },
        { id: "w3", email_address: "unknown@example.test", status: "pending" },
      ] : [], total_count: url.searchParams.get("status") === "pending" ? 3 : 0 });
      throw new Error("Unexpected fake Clerk request");
    } });
    email.recordEmailConsent(db, "wait@example.test", { provenance: "public-waitlist-form", textVersion: "alpha-news-2026-11-04" }, config);
    db.prepare("insert into waitlist_signups(email,created_at,source) values(?,'2026-10-01','fixture')").run("historical@example.test");
    const token = email.unsubscribeToken(db, "suppressed@example.test", config);
    expect(email.unsubscribeByToken(db, token)).toBe(true);
    let outbox = email.createReleaseEmailOutbox(db, config);
    const preview = await outbox.preview(release.id, 1, clerk);
    expect(preview.counts).toMatchObject({ members: 1, invited: 2, waitlist: 3, total: 6 });
    expect(preview.counts.excluded).toEqual(expect.arrayContaining([{ reason: "suppressed", count: 1 }]));
    for (const address of ["member", "invite", "expired", "historical", "unknown"]) {
      expect(db.prepare("select source,provenance,text_version from email_consents where recipient_key=?").get(email.recipientKey(db, `${address}@example.test`)))
        .toEqual({ source: "owner_basis_2026-11-04", provenance: "owner instruction; alpha news; unsubscribe in every email", text_version: "alpha-news-2026-11-04" });
    }
    expect(db.prepare("select provenance from email_consents where recipient_key=?").get(email.recipientKey(db, "wait@example.test"))).toEqual({ provenance: "public-waitlist-form" });
    expect(db.prepare("select 1 from email_consents where recipient_key=?").get(email.recipientKey(db, "suppressed@example.test"))).toBeUndefined();
    const [first, second] = await Promise.all([outbox.confirm(release.id, 1, preview.token), outbox.confirm(release.id, 1, preview.token)]);
    expect(first).toEqual(second); expect(first.state).toBe("queued");
    expect(db.prepare("select count(*) n from release_email_sends").get()).toEqual({ n: 1 });
    const deliveries = db.prepare("select * from release_email_deliveries").all();
    expect(deliveries).toHaveLength(6);
    expect(JSON.stringify(deliveries)).not.toContain("@example.test");
    expect(JSON.stringify(deliveries)).not.toContain("ticket/secret");
    const calls: { key: string; body: string }[] = [];
    const accepted = new Map<string, string>();
    let loseResponse = true;
    const provider = email.createResendProvider({ apiKey: "fake", fetch: async (_input, init) => {
      const key = new Headers(init?.headers).get("idempotency-key")!;
      const body = String(init?.body); calls.push({ key, body });
      accepted.set(key, accepted.get(key) ?? `provider-${accepted.size}`);
      if (loseResponse) { loseResponse = false; throw new Error("fake timeout after acceptance"); }
      return Response.json({ id: accepted.get(key) });
    } });
    let now = Date.now();
    await outbox.drain({ clerk, provider, now: () => now });
    db.close(); db = openDatabase(path); outbox = email.createReleaseEmailOutbox(db, config);
    now += 60000;
    await outbox.drain({ clerk, provider, now: () => now });
    expect(calls[0]).toEqual(calls[1]);
    for (let n = 0; n < 6; n++) { now += 60000; await outbox.drain({ clerk, provider, now: () => now }); }
    expect(accepted.size).toBe(6);
    expect(outbox.state(release.id)).toMatchObject({ state: "done", sent: 6, total: 6 });
    expect(await outbox.confirm(release.id, 1, "repeated-click")).toMatchObject({ state: "done", sent: 6 });
    const bodies = [...new Map(calls.map(call => [call.key, JSON.parse(call.body)])).values()];
    expect(bodies.every(body => body.headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click")).toBe(true);
    expect(bodies.every(body => body.text.includes("123 Test Street"))).toBe(true);
    expect(bodies.find(body => body.to[0] === "member@example.test").text).not.toContain("ticket/");
    expect(bodies.find(body => body.to[0] === "invite@example.test").text).toContain("ticket/secret");
    expect(bodies.find(body => body.to[0] === "expired@example.test").text).not.toContain("/expired");
    expect(bodies[0].html).toContain("&lt;safe&gt;");
    expect(bodies[0].html).toContain("<b>Deck help &lt;safe&gt;</b>");
    expect(bodies[0].text).toContain("Deck help <safe>"); expect(bodies[0].text).not.toContain("**");
    expect(clerkRequests.some(path => path.includes("status=pending"))).toBe(true);
    db.prepare("delete from waitlist_signups where email=?").run("historical@example.test");

    // Pagination accepts REST arrays and both envelope spellings, and fails closed on an incomplete/error page.
    const pageOffsets: string[] = [];
    const paged = createClerkBackend({ secretKey: "fake", fetch: async input => {
      const url = new URL(String(input)), offset = Number(url.searchParams.get("offset")); pageOffsets.push(String(offset));
      return Response.json({ data: Array.from({ length: offset ? 1 : 100 }, (_, n) => ({ ...member, id: `u${offset + n}` })), totalCount: 101 });
    } });
    expect(await paged.listAllUsers()).toHaveLength(101); expect(pageOffsets).toEqual(["0", "100"]);
    const overlapping = createClerkBackend({ secretKey: "fake", fetch: async input => {
      const offset = Number(new URL(String(input)).searchParams.get("offset"));
      return Response.json({ data: Array.from({ length: 100 }, (_, n) => ({ ...member, id: `u${offset ? offset - 1 + n : n}` })), total_count: 200 });
    } });
    await expect.soft(overlapping.listAllUsers().then(() => true)).rejects.toThrow("Incomplete audience response");
    const overlappingArrays = createClerkBackend({ secretKey: "fake", fetch: async input => {
      const offset = Number(new URL(String(input)).searchParams.get("offset"));
      return Response.json(offset >= 200 ? [] : Array.from({ length: 100 }, (_, n) => ({ ...member, id: `u${offset ? offset - 1 + n : n}` })));
    } });
    await expect.soft(overlappingArrays.listAllUsers().then(() => true)).rejects.toThrow("Incomplete audience response");

    const incomplete = createClerkBackend({ secretKey: "fake", fetch: async () => Response.json({ data: [], total_count: 2 }) });
    await expect(incomplete.listAllUsers()).rejects.toThrow("Incomplete audience response");
    const limited = createClerkBackend({ secretKey: "fake", fetch: async () => Response.json({ errors: [{ message: "private", code: "rate_limited" }] }, { status: 429, headers: { "retry-after": "60" } }) });
    await expect(limited.listAllUsers()).rejects.toMatchObject({ status: 429, retryAfterMs: 60000 });
    const singleClerk = { ...clerk, listAllInvitations: async () => [], listAllWaitlistEntries: async () => [] };
    let version = 1;
    async function reserveSingle() {
      email.recordEmailConsent(db, "member@example.test", { provenance: "fixture", textVersion: "alpha-news-v1" });
      const releases = services.createReleaseService(db);
      const r = releases.createDraft({ version: `1.0.${version++}`, title: "More news", major: false, highlights: [], sections: [{ kind: "fixes", items: ["Fixed"] }] });
      releases.publish(r.id, { actorUserId: 1 });
      const p = await outbox.preview(r.id, 1, singleClerk);
      await expect(outbox.confirm(r.id, 2, p.token)).rejects.toMatchObject({ code: "invalid_preview", status: 409 });
      db.prepare("update release_email_previews set expires_at=1 where token_hash=?").run(email.hash(p.token));
      await expect(outbox.confirm(r.id, 1, p.token)).rejects.toMatchObject({ code: "preview_expired", status: 410 });
      db.prepare("delete from release_email_previews where token_hash=?").run(email.hash(p.token));
      await expect(outbox.confirm(r.id, 1, p.token)).rejects.toMatchObject({ code: "preview_expired", status: 410 });
      const fresh = await outbox.preview(r.id, 1, singleClerk);
      await outbox.confirm(r.id, 1, fresh.token);
      return r;
    }
    const cutoff = await reserveSingle();
    let unknownCalls = 0;
    now += 60000;
    await outbox.drain({ clerk: singleClerk, provider: { send: async () => { unknownCalls++; throw new email.EmailProviderError("transport"); } }, now: () => now });
    expect({ delivery: db.prepare("select status,attempts from release_email_deliveries where send_id=(select id from release_email_sends where release_id=?)").get(cutoff.id),
      state: outbox.state(cutoff.id), budget: db.prepare("select next_attempt_at from email_budget").get() })
      .toMatchObject({ delivery: { status: "retry", attempts: 0 }, state: { lastError: "provider_unavailable" }, budget: { next_attempt_at: expect.any(Number) } });
    db.close(); db = openDatabase(path); outbox = email.createReleaseEmailOutbox(db, config);
    now += 23 * 60 * 60000 + 1;
    await outbox.drain({ clerk: singleClerk, provider: { send: async () => { unknownCalls++; return { id: "must-not-replay" }; } }, now: () => now });
    expect(unknownCalls).toBe(1); expect(outbox.state(cutoff.id)).toMatchObject({ state: "needs_review", failed: 1 });
    expect(await outbox.confirm(cutoff.id, 1, "repeat")).toMatchObject({ state: "needs_review" });

    // Provider configuration/outage errors pause all work and never exhaust a delivery's attempt counter.
    const guarded = await reserveSingle();
    db.prepare("update release_email_deliveries set attempts=8 where send_id=(select id from release_email_sends where release_id=?)").run(guarded.id);
    for (const [status, name, message, code] of [
      [401, "invalid_api_key", "private key", "provider_auth"],
      [403, "restricted_api_key", "private key", "provider_auth"],
      [403, "validation_error", "The private.example domain is not verified", "provider_domain"],
      [400, "validation_error", "The private.example domain is not verified", "provider_domain"],
      [422, "invalid_api_key", "private key", "provider_auth"],
      ...Array.from({ length: 9 }, () => [503, "application_error", "private outage", "provider_unavailable"]),
      [429, "rate_limit_exceeded", "private limit", "provider_unavailable"],
    ] as [number, string, string, string][]) {
      now = Math.max(now + 60000, (db.prepare("select next_attempt_at from email_budget").get() as { next_attempt_at: number }).next_attempt_at);
      let calls = 0;
      const failing = email.createResendProvider({ apiKey: "fake", fetch: async () => { calls++; return Response.json({ name, message }, { status }); } });
      await outbox.drain({ clerk: singleClerk, provider: failing, now: () => now });
      await outbox.drain({ clerk: singleClerk, provider: failing, now: () => now + 1000 });
      expect({ calls, delivery: db.prepare("select status,attempts from release_email_deliveries where send_id=(select id from release_email_sends where release_id=?)").get(guarded.id),
        state: outbox.state(guarded.id), paused: (db.prepare("select next_attempt_at from email_budget").get() as { next_attempt_at: number }).next_attempt_at >= now + (code === "provider_unavailable" ? 2000 : 3600000) })
        .toMatchObject({ calls: 1, delivery: { status: "retry", attempts: 8 }, state: { lastError: code }, paused: true });
    }
    now += 3600000;
    await outbox.drain({ clerk: singleClerk, provider: { send: async () => ({ id: "recovered-provider" }) }, now: () => now });
    expect(outbox.state(guarded.id)).toMatchObject({ state: "done", sent: 1 });

    // A row waiting on Clerk must honor a global pause recorded by a different drain before dispatch.
    const waitingRelease = await reserveSingle(), pausingRelease = await reserveSingle();
    let resumeDiscovery!: () => void, notifyDiscovery!: () => void, sendsDuringPause = 0;
    const discoveryStarted = new Promise<void>(resolve => { notifyDiscovery = resolve; });
    const discoveryBlocked = new Promise<void>(resolve => { resumeDiscovery = resolve; });
    const waitingClerk = { ...singleClerk, listAllUsers: async () => { notifyDiscovery(); await discoveryBlocked; return singleClerk.listAllUsers(); } };
    now += 60000;
    const waitingDrain = outbox.drain({ clerk: waitingClerk, provider: { send: async () => { sendsDuringPause++; return { id: "must-wait" }; } }, now: () => now });
    await discoveryStarted;
    try {
      now += 1000;
      await email.createReleaseEmailOutbox(db, config).drain({ clerk: singleClerk,
        provider: email.createResendProvider({ apiKey: "fake", fetch: async () => Response.json({}, { status: 401 }) }), now: () => now });
      resumeDiscovery(); await waitingDrain;
      expect({ sendsDuringPause, delivery: db.prepare("select status,attempts from release_email_deliveries where send_id=(select id from release_email_sends where release_id=?)").get(waitingRelease.id) })
        .toEqual({ sendsDuringPause: 0, delivery: { status: "retry", attempts: 0 } });
    } finally { resumeDiscovery(); await waitingDrain; }
    let recovered = 0;
    const recoveredProvider = { send: async () => ({ id: `pause-recovered-${++recovered}` }) };
    now += 3600000; await outbox.drain({ clerk: singleClerk, provider: recoveredProvider, now: () => now });
    now += 1000; await outbox.drain({ clerk: singleClerk, provider: recoveredProvider, now: () => now });
    expect([outbox.state(waitingRelease.id).state, outbox.state(pausingRelease.id).state]).toEqual(["done", "done"]);

    // A second connection can reclaim an expired lease; a late response from the first worker cannot overwrite it.
    const stale = await reserveSingle();
    let unblock!: () => void, entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { unblock = resolve; });
    now += 60000;
    const late = outbox.drain({ clerk: singleClerk, provider: { send: async () => { entered(); await blocked; return { id: "stale-response" }; } }, now: () => now });
    await waiting;
    const otherDb = openDatabase(path);
    try {
      now += 61000;
      await email.createReleaseEmailOutbox(otherDb, config).drain({ clerk: singleClerk, provider: { send: async () => ({ id: "current-response" }) }, now: () => now });
      unblock(); await late;
      expect(db.prepare("select provider_id from release_email_deliveries where send_id=(select id from release_email_sends where release_id=?)").get(stale.id)).toEqual({ provider_id: "current-response" });
    } finally { unblock(); otherDb.close(); }

    // The persisted per-second and daily budgets apply across connections and retries, including Retry-After.
    const throttled = await reserveSingle();
    db.prepare("update email_budget set attempts=0,next_attempt_at=0").run();
    const capped = email.createReleaseEmailOutbox(db, { ...config, dailyLimit: 1 });
    let throttledCalls = 0;
    now += 60000;
    const rateProvider = { send: async () => { throttledCalls++; throw new email.EmailProviderError("rate_limited", false, 60000); } };
    await capped.drain({ clerk: singleClerk, provider: rateProvider, now: () => now });
    now += 1000; await capped.drain({ clerk: singleClerk, provider: rateProvider, now: () => now });
    now += 60000; await capped.drain({ clerk: singleClerk, provider: rateProvider, now: () => now });
    expect(throttledCalls).toBe(1);
    expect(outbox.state(throttled.id).queued).toBe(1);
    const suppressToken = email.unsubscribeToken(db, "member@example.test");
    email.unsubscribeByToken(db, suppressToken);
    now += 60000; await outbox.drain({ clerk: singleClerk, provider: rateProvider, now: () => now });
    expect(throttledCalls).toBe(1); expect(outbox.state(throttled.id)).toMatchObject({ state: "done", sent: 0, failed: 1 });

    // Signed webhook tags reconcile an unknown provider acceptance without replaying the send. Receipt replay is inert.
    const unknown = db.prepare("select send_id,recipient_key from release_email_deliveries where send_id=(select id from release_email_sends where release_id=?)").get(cutoff.id) as { send_id: string; recipient_key: string };
    const event = { type: "email.delivered", data: { email_id: "reconciled", tags: { release_send: unknown.send_id, release_recipient: unknown.recipient_key } } };
    const body = JSON.stringify(event), secret = "whsec_" + Buffer.alloc(32, 7).toString("base64");
    const timestamp = String(Math.floor(now / 1000));
    const signature = createHmac("sha256", Buffer.alloc(32, 7)).update(`event1.${timestamp}.${body}`).digest("base64");
    const headers = new Headers({ "svix-id": "event1", "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` });
    expect(email.verifyResendWebhook(body, headers, secret, now)).toBe(true);
    expect(email.verifyResendWebhook(body + " ", headers, secret, now)).toBe(false);
    expect(email.verifyResendWebhook(body, headers, secret, now + 301000)).toBe(false);
    email.recordResendWebhook(db, "event1", event, now); email.recordResendWebhook(db, "event1", event, now);
    expect(db.prepare("select count(*) n from email_webhook_receipts").get()).toEqual({ n: 1 });
    expect(outbox.state(cutoff.id)).toMatchObject({ state: "done", sent: 1 });
    email.recordResendWebhook(db, "event2", { type: "email.complained", data: { email_id: "reconciled" } }, now);
    expect(outbox.state(cutoff.id)).toMatchObject({ state: "done", failed: 1 });
    email.recordResendWebhook(db, "event3", event, now); // Out-of-order delivery never undoes a complaint.
    expect(outbox.state(cutoff.id).failed).toBe(1);

    // Major releases default to automatic reservation; missing config sends nothing and minor/opted-out majors never auto-send.
    const currentReleases = services.createReleaseService(db);
    const draft = (v: string) => currentReleases.createDraft({ version: v, title: "Major news", major: true, highlights: [], sections: [] });
    vi.stubEnv("RESEND_API_KEY", ""); vi.stubEnv("MAIL_POSTAL_ADDRESS", "");
    for (const autoEmail of [undefined, true]) {
      const unconfigured = draft(autoEmail ? "1.9.1" : "1.9.0"); currentReleases.publish(unconfigured.id, { actorUserId: 1, autoEmail });
      expect(db.prepare("select 1 from release_email_sends where release_id=?").get(unconfigured.id)).toBeUndefined();
    }
    vi.stubEnv("RESEND_API_KEY", "fake"); vi.stubEnv("MAIL_POSTAL_ADDRESS", "123 Test Street");
    const optedOut = draft("2.0.0"); currentReleases.publish(optedOut.id, { actorUserId: 1, autoEmail: false });
    expect(db.prepare("select 1 from release_email_sends where release_id=?").get(optedOut.id)).toBeUndefined();
    const automatic = draft("2.1.0"); currentReleases.publish(automatic.id, { actorUserId: 1 });
    const disabled = email.createReleaseEmailOutbox(db, { ...config, apiKey: "", postalAddress: "" });
    let forbidden = 0;
    await disabled.drain({ clerk: singleClerk, provider: { send: async () => { forbidden++; throw new Error("forbidden"); } }, now: () => now });
    expect(forbidden).toBe(0); expect(disabled.state(automatic.id).state).toBe("not_configured");
    now += 60000; await outbox.drain({ clerk: singleClerk, provider: { send: async () => { forbidden++; throw new Error("suppressed"); } }, now: () => now });
    expect(forbidden).toBe(0); expect(outbox.state(automatic.id)).toMatchObject({ state: "done", total: 0 });

    const preparing = draft("2.1.1"); currentReleases.publish(preparing.id, { actorUserId: 1 });
    db.prepare("update release_email_sends set attempts=8 where release_id=?").run(preparing.id);
    await outbox.drain({ clerk: { ...singleClerk, listAllUsers: async () => { throw new Error("Clerk unavailable"); } }, provider: rateProvider, now: () => now });
    expect(db.prepare("select status,attempts,available_at,last_error from release_email_sends where release_id=?").get(preparing.id))
      .toEqual({ status: "preparing", attempts: 9, available_at: now + 3600000, last_error: "audience_unavailable" });
    now += 3600000; await outbox.drain({ clerk: singleClerk, provider: rateProvider, now: () => now });

    // Discovery can take longer than a lease; its own lease renews while stale workers remain fenced.
    const slow = draft("2.2.0"); currentReleases.publish(slow.id, { actorUserId: 1 });
    const slowClerk = { ...singleClerk, listAllUsers: async () => {
      now += 61000;
      return [{ ...member, email_addresses: [{ id: "e1", email_address: "slow@example.test", verification: { status: "verified" } }] }];
    } };
    await outbox.drain({ clerk: slowClerk, provider: { send: async () => ({ id: "slow-accepted" }) }, now: () => now });
    expect.soft(outbox.state(slow.id)).toMatchObject({ state: "done", sent: 1, total: 1 });
    db.prepare("update release_email_sends set status='needs_review' where release_id=? and status='preparing'").run(slow.id);

    // A previously mailed verified fallback remains associated by hash after acceptance for deletion suppression.
    const aliasUser = { ...member, id: "user_alias", primary_email_address_id: "primary", email_addresses: [
      { id: "primary", email_address: "primary@example.test", verification: { status: "unverified" } },
      { id: "secondary", email_address: "secondary@example.test", verification: { status: "verified" } },
    ] };
    const aliasClerk = { ...singleClerk, listAllUsers: async () => [aliasUser] };
    db.exec("insert into users(id,username,display_name,email,clerk_user_id) values(8,'alias','Alias','primary@example.test','user_alias')");
    const aliasRelease = currentReleases.createDraft({ version: "3.0.0", title: "News", major: false, highlights: [], sections: [] });
    currentReleases.publish(aliasRelease.id, { actorUserId: 1 });
    const aliasPreview = await outbox.preview(aliasRelease.id, 1, aliasClerk); await outbox.confirm(aliasRelease.id, 1, aliasPreview.token);
    now += 60000; await outbox.drain({ clerk: aliasClerk, provider: { send: async () => ({ id: "alias-accepted" }) }, now: () => now });
    services.deleteUserAccount(db, 8);
    expect.soft(db.prepare("select reason from email_unsubscribes where recipient_key=?").get(email.recipientKey(db, "secondary@example.test"))).toEqual({ reason: "deleted_account" });
    expect.soft(db.prepare("select 1 from email_consents where recipient_key=?").get(email.recipientKey(db, "secondary@example.test"))).toBeUndefined();

    // Account deletion suppresses its inbox before erasing identity and discards queued personal payloads.
    email.recordEmailConsent(db, "delete@example.test", { provenance: "fixture", textVersion: "alpha-news-v1" });
    db.exec("insert into users(id,username,display_name,email,clerk_user_id) values(9,'delete','Delete','delete@example.test','user_delete')");
    const deleteToken = email.unsubscribeToken(db, "delete@example.test");
    services.deleteUserAccount(db, 9);
    expect(email.unsubscribeByToken(db, deleteToken)).toBe(true);
    expect(db.prepare("select reason from email_unsubscribes where recipient_key=?").get(email.recipientKey(db, "delete@example.test"))).toEqual({ reason: "deleted_account" });

  } finally { if (db.open) db.close(); rmSync(directory, { recursive: true, force: true }); }
});
