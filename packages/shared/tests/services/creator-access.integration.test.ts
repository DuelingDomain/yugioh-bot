import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { ClerkBackendError, createClerkBackend, type ClerkBackend } from "../../src/clerk/backend.js";
import { deleteUserAccount } from "../../src/services/account-deletion.js";
import {
  ALLOWLIST_INVITE_DAYS, CreatorAccessError, LINK_INVITE_DAYS, RESEND_COOLDOWN_MS, SENDING_LEASE_MS,
  createCreatorAccessService, type CreatorAccessService,
} from "../../src/services/creator-access.js";

// Creator fast-track on a real in-memory SQLite. Clerk is a stub object (or createClerkBackend with a fetch stub);
// nothing leaves the process. Time is driven through opts.now.

const WEB_URL = "https://app.example.test";
const DAY = 24 * 3600_000;
const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);

let db: Database.Database;
let clock: number;
let clerk: ReturnType<typeof stubClerk>;
let service: CreatorAccessService;

type InvitationInput = Parameters<ClerkBackend["createInvitation"]>[0];

/** Clerk stub: each call answers after a short random delay so parallel sends interleave. */
function stubClerk() {
  let next = 0;
  const createInvitation = vi.fn(async (input: InvitationInput) => {
    await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 4)));
    next += 1;
    return { id: `inv_${next}`, email_address: input.emailAddress, status: "pending", expires_at: null };
  });
  const revokeInvitation = vi.fn(async (_id: string) => {});
  const unexpected = (name: string) => vi.fn(async () => { throw new Error(`unexpected Clerk call ${name}`); });
  const backend = {
    createInvitation, revokeInvitation,
    getUser: unexpected("getUser"), listUsers: unexpected("listUsers"), createUser: unexpected("createUser"),
    updateUserExternalId: unexpected("updateUserExternalId"), updateUserMetadata: unexpected("updateUserMetadata"),
    createWaitlistEntry: unexpected("createWaitlistEntry"), listWaitlistEntries: unexpected("listWaitlistEntries"),
    inviteWaitlistEntry: unexpected("inviteWaitlistEntry"), rejectWaitlistEntry: unexpected("rejectWaitlistEntry"),
    deleteUser: unexpected("deleteUser"), deleteWaitlistEntriesByEmail: unexpected("deleteWaitlistEntriesByEmail"),
  } satisfies ClerkBackend;
  return backend;
}

function makeService(backend: ClerkBackend = clerk) {
  let n = 0;
  return createCreatorAccessService(db, {
    clerk: backend, webUrl: WEB_URL, now: () => clock,
    newCode: () => `code${String(++n).padStart(8, "0")}`,
  });
}

function setup() {
  const creator = service.createCreator({ name: "Kaiba Plays", channelUrl: "https://youtube.example.test/@kaiba", actorUserId: 1 });
  return creator;
}
function link(creatorId: number, maxUses: number, expiresInDays = 30) {
  const created = service.createLink(creatorId, { label: "Video", maxUses, expiresInDays, actorUserId: 1 });
  if (!created) throw new Error("createLink returned null");
  return created;
}
async function claimAndSend(code: string, email: string) {
  const claim = service.claimLinkGrant(code, email, { ipKey: "192.0.2.1" });
  if (claim.kind !== "claimed") return { claim, send: null };
  return { claim, send: await service.sendGrant(claim.grantId) };
}
const grant = (id: number) => db.prepare("select * from creator_grants where id = ?").get(id) as Record<string, unknown> | undefined;
const grants = () => db.prepare("select * from creator_grants order by id").all() as Record<string, unknown>[];
const linkView = (creatorId: number, linkId: number) => service.creatorDetail(creatorId)!.links.find(l => l.id === linkId)!;
const user = (id: number) => db.prepare("select creator_id, heard_from from users where id = ?").get(id);

beforeEach(() => {
  clock = T0;
  db = new Database(":memory:");
  migrate(db);
  db.pragma("foreign_keys = on");
  db.exec("insert into users(id, username, display_name, email, email_verified) values (1, 'owner', 'Owner', 'owner@example.test', 1)");
  clerk = stubClerk();
  service = makeService();
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe("creator links", () => {
  it("lets 50 parallel claims+sends through a 50-use link; the 51st is full", async () => {
    const creator = setup();
    const community = link(creator.id, 50);
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => claimAndSend(community.code, `fan${i}@example.test`)));
    expect(results.map(r => r.claim.kind)).toEqual(Array(50).fill("claimed"));
    expect(results.map(r => r.send?.kind)).toEqual(Array(50).fill("sent"));
    expect(clerk.createInvitation).toHaveBeenCalledTimes(50);
    expect(new Set(grants().map(g => g.clerk_invitation_id)).size).toBe(50);

    expect(service.claimLinkGrant(community.code, "fan50@example.test")).toEqual({ kind: "full" });
    expect(clerk.createInvitation).toHaveBeenCalledTimes(50);
    expect(service.publicLink(community.code)).toEqual({ state: "full", creatorName: "Kaiba Plays", spotsLeft: 0 });
    expect(linkView(creator.id, community.id)).toMatchObject({ used: 50, state: "full", maxUses: 50 });
  });

  it("never over-claims when 51 claims race for 50 uses", async () => {
    const creator = setup();
    const community = link(creator.id, 50);
    const results = await Promise.all(Array.from({ length: 51 }, (_, i) => claimAndSend(community.code, `race${i}@example.test`)));
    expect(results.filter(r => r.send?.kind === "sent")).toHaveLength(50);
    expect(results.filter(r => r.claim.kind === "full")).toHaveLength(1);
    expect(db.prepare("select count(*) as n from creator_grants").get()).toEqual({ n: 50 });
  });

  it("treats a+tag, Gmail dots and googlemail.com as the same inbox: one grant, one invitation", async () => {
    const creator = setup();
    const community = link(creator.id, 10);
    const first = await claimAndSend(community.code, "a.b+1@gmail.com");
    expect(first.send).toEqual({ kind: "sent" });
    expect(service.claimLinkGrant(community.code, "ab@gmail.com")).toEqual({ kind: "already" });
    expect(service.claimLinkGrant(community.code, "a.b@googlemail.com")).toEqual({ kind: "already" });
    // A second link of another creator gets no grant either: the first creator keeps the credit.
    const other = service.createCreator({ name: "Other", actorUserId: 1 });
    expect(service.claimLinkGrant(link(other.id, 5).code, "ab+2@gmail.com")).toEqual({ kind: "already" });
    expect(grants()).toEqual([expect.objectContaining({ email: "a.b+1@gmail.com", email_key: "ab@gmail.com", creator_id: creator.id })]);
    expect(clerk.createInvitation).toHaveBeenCalledOnce();
    expect(service.grantedEmailKeys()).toEqual(new Set(["ab@gmail.com"]));
  });

  it("answers already for an email that has an account, with no grant and no Clerk call", () => {
    const creator = setup();
    const community = link(creator.id, 3);
    expect(service.claimLinkGrant(community.code, "owner@example.test")).toEqual({ kind: "already" });
    expect(grants()).toEqual([]);
    expect(clerk.createInvitation).not.toHaveBeenCalled();
  });

  it("frees the use of an unused invitation after it expires, and of a claim stuck in sending after the lease", async () => {
    const creator = setup();
    const personal = link(creator.id, 1, 30);
    const first = await claimAndSend(personal.code, "first@example.test");
    expect(first.send).toEqual({ kind: "sent" });
    expect(grant((first.claim as { grantId: number }).grantId)).toMatchObject({ status: "sent", sent_at: T0, expires_at: T0 + LINK_INVITE_DAYS * DAY });
    expect(service.claimLinkGrant(personal.code, "second@example.test")).toEqual({ kind: "full" });

    clock = T0 + LINK_INVITE_DAYS * DAY + 1;
    expect(service.publicLink(personal.code)).toMatchObject({ state: "open", spotsLeft: 1 });
    const expired = service.creatorDetail(creator.id)!.grants.find(g => g.email === "first@example.test")!;
    expect(expired).toMatchObject({ status: "sent", view: "expired", resendable: true });

    // A claim that never sends (crash mid-send) holds the use only for the lease.
    const stuck = service.claimLinkGrant(personal.code, "second@example.test");
    expect(stuck.kind).toBe("claimed");
    expect(service.claimLinkGrant(personal.code, "third@example.test")).toEqual({ kind: "full" });
    clock += SENDING_LEASE_MS + 1;
    expect(service.claimLinkGrant(personal.code, "third@example.test").kind).toBe("claimed");
  });

  it("re-opens an expired grant of the same inbox on a new claim", async () => {
    const creator = setup();
    const community = link(creator.id, 5);
    const first = await claimAndSend(community.code, "again@example.test");
    const id = (first.claim as { grantId: number }).grantId;
    expect(service.claimLinkGrant(community.code, "again@example.test")).toEqual({ kind: "already" });
    clock = T0 + LINK_INVITE_DAYS * DAY + 1;
    expect(service.claimLinkGrant(community.code, "again@example.test")).toEqual({ kind: "claimed", grantId: id });
    expect(grants()).toHaveLength(1);
  });

  it("refuses an expired link, an unknown or malformed code, and reads an archived creator's link as revoked", () => {
    const creator = setup();
    const short = link(creator.id, 5, 1);
    expect(service.publicLink("nope00000000")).toBeNull();
    expect(service.publicLink("../bad")).toBeNull();
    expect(service.claimLinkGrant("nope00000000", "x@example.test")).toEqual({ kind: "not_found" });
    clock = T0 + DAY + 1;
    expect(service.claimLinkGrant(short.code, "x@example.test")).toEqual({ kind: "expired" });
    expect(service.publicLink(short.code)).toMatchObject({ state: "expired" });
    clock = T0;
    const open = link(creator.id, 5);
    service.updateCreator(creator.id, { archived: true });
    expect(service.publicLink(open.code)).toMatchObject({ state: "revoked" });
    expect(service.claimLinkGrant(open.code, "x@example.test")).toEqual({ kind: "revoked" });
    expect(clerk.createInvitation).not.toHaveBeenCalled();
  });

  it("revokeLink refuses new claims, marks unused grants revoked, keeps sign-ups, and revokes their Clerk invitations", async () => {
    const creator = setup();
    const community = link(creator.id, 10);
    const joined = await claimAndSend(community.code, "joined@example.test");
    const waiting = await claimAndSend(community.code, "waiting@example.test");
    const pending = await claimAndSend(community.code, "pending@example.test");
    db.exec("insert into users(id, username, display_name, email, email_verified) values (10, 'joined', 'Joined', 'joined@example.test', 1)");
    service.attributeSignUp({ userId: 10, email: "joined@example.test", grantId: (joined.claim as { grantId: number }).grantId });
    const ids = [waiting, pending].map(r => grant((r.claim as { grantId: number }).grantId)!.clerk_invitation_id);

    expect(await service.revokeLink(creator.id + 99, community.id)).toBeNull();
    expect(await service.revokeLink(creator.id, community.id)).toEqual({ invitationsRevoked: 2 });
    expect(clerk.revokeInvitation.mock.calls.map(([id]) => id).sort()).toEqual([...ids].sort());
    expect(grants().map(g => [g.email, g.status])).toEqual([
      ["joined@example.test", "signed_up"], ["waiting@example.test", "revoked"], ["pending@example.test", "revoked"],
    ]);
    expect(service.claimLinkGrant(community.code, "late@example.test")).toEqual({ kind: "revoked" });
    expect(service.publicLink(community.code)).toMatchObject({ state: "revoked" });
    expect(linkView(creator.id, community.id)).toMatchObject({ state: "revoked", signedUp: 1 });
    expect(service.grantedEmailKeys()).toEqual(new Set(["joined@example.test"]));
  });
});

describe("Clerk answers", () => {
  it("sends the invitation with notify, the creator redirect, ddGrant and the link lifetime", async () => {
    const creator = setup();
    const community = link(creator.id, 5);
    const { claim, send } = await claimAndSend(community.code, "fan@example.test");
    expect(send).toEqual({ kind: "sent" });
    const grantId = (claim as { grantId: number }).grantId;
    expect(clerk.createInvitation).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      emailAddress: "fan@example.test", notify: true, redirectUrl: `${WEB_URL}/sign-up?via=creator`,
      publicMetadata: { ddGrant: grantId }, expiresInDays: LINK_INVITE_DAYS,
    }));
    expect(clerk.createInvitation.mock.calls[0][0].redirectUrl).toMatch(/\/sign-up\?via=creator$/);
    expect(grant(grantId)).toMatchObject({ status: "sent", clerk_invitation_id: "inv_1", ip_key: "192.0.2.1" });
  });

  it("puts notify, redirect_url and public_metadata.ddGrant on the wire and never stores the ticket URL", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      id: "inv_wire", email_address: "wire@example.test", status: "pending",
      url: "https://clerk.example.test/v1/tickets/accept?ticket=secret_ticket_value",
    }));
    service = makeService(createClerkBackend({ secretKey: "sk_test_fake_value", fetch: fetcher }));
    const creator = setup();
    const { claim, send } = await claimAndSend(link(creator.id, 5).code, "wire@example.test");
    expect(send).toEqual({ kind: "sent" });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.clerk.com/v1/invitations");
    expect(JSON.parse(String(init!.body))).toMatchObject({
      email_address: "wire@example.test", notify: true, redirect_url: `${WEB_URL}/sign-up?via=creator`,
      public_metadata: { ddGrant: (claim as { grantId: number }).grantId }, expires_in_days: LINK_INVITE_DAYS,
    });
    expect(JSON.stringify(grants())).not.toContain("ticket");
  });

  it("Clerk 429: the grant is failed, no use is counted, and Resend sends it", async () => {
    const creator = setup();
    const personal = link(creator.id, 1);
    clerk.createInvitation.mockRejectedValueOnce(new ClerkBackendError("Too many requests", 429, null, 2000));
    const { claim, send } = await claimAndSend(personal.code, "busy@example.test");
    const id = (claim as { grantId: number }).grantId;
    expect(send).toEqual({ kind: "failed", retryable: true, retryAfterMs: 2000 });
    expect(grant(id)).toMatchObject({ status: "failed" });
    expect(linkView(creator.id, personal.id)).toMatchObject({ used: 0, state: "open" });
    expect(service.publicLink(personal.code)).toMatchObject({ state: "open", spotsLeft: 1 });
    expect(service.creatorDetail(creator.id)!.grants.find(g => g.id === id)).toMatchObject({ view: "failed", resendable: true });

    expect(await service.resendGrant(id)).toEqual({ kind: "sent" });
    expect(grant(id)).toMatchObject({ status: "sent", clerk_invitation_id: "inv_1" });
    expect(linkView(creator.id, personal.id)).toMatchObject({ used: 1, state: "full" });
    expect(await service.resendGrant(id)).toEqual({ kind: "not_resendable" });
  });

  it("Resend of a failed link grant needs a free use", async () => {
    const creator = setup();
    const personal = link(creator.id, 1);
    clerk.createInvitation.mockRejectedValueOnce(new ClerkBackendError("Unavailable", 503, null, null));
    const failed = await claimAndSend(personal.code, "late@example.test");
    expect(failed.send).toMatchObject({ kind: "failed", retryable: true });
    expect((await claimAndSend(personal.code, "winner@example.test")).send).toEqual({ kind: "sent" });
    expect(await service.resendGrant((failed.claim as { grantId: number }).grantId)).toEqual({ kind: "full" });
    expect(clerk.createInvitation).toHaveBeenCalledTimes(2);
  });

  it("422 form_identifier_exists: existing account, the grant row is deleted and the use freed", async () => {
    const creator = setup();
    const personal = link(creator.id, 1);
    clerk.createInvitation.mockRejectedValueOnce(new ClerkBackendError("That email address is taken.", 422, "form_identifier_exists", null));
    const { claim, send } = await claimAndSend(personal.code, "member@example.test");
    expect(send).toEqual({ kind: "existing_account" });
    expect(grant((claim as { grantId: number }).grantId)).toBeUndefined();
    expect(service.publicLink(personal.code)).toMatchObject({ state: "open", spotsLeft: 1 });
  });

  it("400 duplicate_record: retries once with ignoreExisting", async () => {
    const creator = setup();
    clerk.createInvitation.mockRejectedValueOnce(new ClerkBackendError("duplicate", 400, "duplicate_record", null));
    const { claim, send } = await claimAndSend(link(creator.id, 5).code, "twice@example.test");
    expect(send).toEqual({ kind: "sent" });
    expect(clerk.createInvitation).toHaveBeenCalledTimes(2);
    expect(clerk.createInvitation.mock.calls[0][0].ignoreExisting).not.toBe(true);
    expect(clerk.createInvitation.mock.calls[1][0]).toMatchObject({ emailAddress: "twice@example.test", ignoreExisting: true, notify: true });
    expect(grant((claim as { grantId: number }).grantId)).toMatchObject({ status: "sent" });
  });
});

describe("allowlist emails", () => {
  it("validates, dedupes by inbox, sends with the allowlist lifetime, and caps at 20", async () => {
    const creator = setup();
    const results = await service.addAllowlistEmails(creator.id, ["Ann@Example.test", "ann+yt@example.test", "not-an-email"], 1);
    expect(results.map(r => r.outcome)).toEqual(["sent", "already", "invalid"]);
    expect(clerk.createInvitation).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      emailAddress: "ann@example.test", notify: true, expiresInDays: ALLOWLIST_INVITE_DAYS, redirectUrl: `${WEB_URL}/sign-up?via=creator`,
    }));
    expect(grants()).toEqual([expect.objectContaining({ kind: "allowlist", link_id: null, email: "ann@example.test", status: "sent" })]);
    await expect(service.addAllowlistEmails(creator.id, Array.from({ length: 21 }, (_, i) => `e${i}@example.test`), 1))
      .rejects.toMatchObject({ status: 400, code: "too_many_emails" });
    await expect(service.addAllowlistEmails(creator.id, Array.from({ length: 21 }, (_, i) => `e${i}@example.test`), 1))
      .rejects.toBeInstanceOf(CreatorAccessError);
  });

  it("re-sends for a waitlist join only when due", async () => {
    const creator = setup();
    expect(await service.resendAllowlistForWaitlist("nobody@example.test")).toBe("none");
    await service.addAllowlistEmails(creator.id, ["vip@example.test"], 1);
    expect(await service.resendAllowlistForWaitlist("vip@example.test")).toBe("not_due");
    clock += RESEND_COOLDOWN_MS + 1;
    expect(await service.resendAllowlistForWaitlist("vip@example.test")).toBe("resent");
    expect(clerk.createInvitation).toHaveBeenCalledTimes(2);
  });
});

describe("sign-up attribution and account deletion", () => {
  async function signedUpGrant() {
    const creator = setup();
    const { claim } = await claimAndSend(link(creator.id, 5).code, "newbie@example.test");
    db.exec("insert into users(id, username, display_name, email, email_verified) values (10, 'newbie', 'Newbie', 'newbie@example.test', 1)");
    return { creator, grantId: (claim as { grantId: number }).grantId };
  }

  it("binds the grant once and sets users.creator_id and heard_from 'creator'; a second call changes nothing", async () => {
    const { creator, grantId } = await signedUpGrant();
    clock = T0 + 3600_000;
    expect(service.attributeSignUp({ userId: 10, email: "newbie@example.test", grantId })).toEqual({ creatorId: creator.id });
    expect(grant(grantId)).toMatchObject({ status: "signed_up", user_id: 10, signed_up_at: T0 + 3600_000 });
    expect(user(10)).toEqual({ creator_id: creator.id, heard_from: "creator" });
    const before = JSON.stringify([grants(), user(10)]);
    clock += 3600_000;
    service.attributeSignUp({ userId: 10, email: "newbie@example.test", grantId });
    service.attributeSignUp({ userId: 10, email: "newbie@example.test" });
    expect(JSON.stringify([grants(), user(10)])).toBe(before);
    expect(service.creatorDetail(creator.id)!.joined).toEqual([expect.objectContaining({ userId: 10, signedUpAt: T0 + 3600_000, via: "Video" })]);
    expect(service.listCreators()[0]).toMatchObject({ id: creator.id, sent: 1, signedUp: 1 });
  });

  it("finds the grant by email key without ddGrant, keeps an earlier heard-from, and leaves another user's grant", async () => {
    const { creator, grantId } = await signedUpGrant();
    db.exec("update users set heard_from = 'youtube' where id = 10");
    expect(service.attributeSignUp({ userId: 10, email: "newbie@example.test", grantId: null })).toEqual({ creatorId: creator.id });
    expect(user(10)).toEqual({ creator_id: creator.id, heard_from: "youtube" });
    db.exec("insert into users(id, username, display_name, email) values (11, 'thief', 'Thief', 'thief@example.test')");
    service.attributeSignUp({ userId: 11, email: "thief@example.test", grantId });
    expect(grant(grantId)).toMatchObject({ user_id: 10 });
    expect(user(11)).toEqual({ creator_id: null, heard_from: null });
  });

  it("deleteUserAccount removes the person's grant, bound or matched by email key, and leaves others", async () => {
    const { creator, grantId } = await signedUpGrant();
    service.attributeSignUp({ userId: 10, email: "newbie@example.test", grantId });
    // Never attributed (the person signed up another way): found by the email key.
    const loose = await claimAndSend(link(creator.id, 5).code, "lo.ose+x@gmail.com");
    const keep = await claimAndSend(link(creator.id, 5).code, "keep@example.test");
    db.exec("insert into users(id, username, display_name, email, email_verified) values (12, 'loose', 'Loose', 'loose@gmail.com', 1)");
    deleteUserAccount(db, 10);
    deleteUserAccount(db, 12);
    expect(grant(grantId)).toBeUndefined();
    expect(grant((loose.claim as { grantId: number }).grantId)).toBeUndefined();
    expect(grant((keep.claim as { grantId: number }).grantId)).toMatchObject({ status: "sent" });
  });
});

describe("migration", () => {
  it("is safe to run twice and keeps creator data", async () => {
    const creator = setup();
    await claimAndSend(link(creator.id, 5).code, "keep@example.test");
    migrate(db);
    migrate(db);
    expect(service.listCreators().map(c => c.name)).toEqual(["Kaiba Plays"]);
    expect(grants()).toHaveLength(1);
    const columns = (table: string) => (db.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map(c => c.name);
    expect(columns("users")).toEqual(expect.arrayContaining(["heard_from", "heard_from_detail", "creator_id"]));
    expect(columns("waitlist_signups")).toEqual(expect.arrayContaining(["heard_from", "heard_from_detail"]));
  });
});
