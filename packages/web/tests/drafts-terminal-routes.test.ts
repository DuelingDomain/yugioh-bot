import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDraftService, createPlayerService, createUserService } from "@yugidraft/shared/services";
import { recordingTransport, createBroadcaster } from "@yugidraft/shared/notify";

const state = vi.hoisted(() => ({ actor: { userId: 1, discordUserId: null as string | null, userName: "Host" },
  authenticated: true, announce: vi.fn(), broadcast: vi.fn() }));
let db: Database.Database;
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/env", () => ({ env: { discordGuildId: "g" } }));
vi.mock("@/lib/web-access", async () => {
  const { NextResponse } = await import("next/server");
  return { requireWebAccess: async () => state.authenticated ? { ok: true, ...state.actor }
    : { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } };
});
vi.mock("@/lib/notify", () => ({ broadcaster: { draft: state.broadcast }, announcer: { announce: state.announce } }));

beforeEach(() => {
  vi.stubEnv("OWNER_USER_IDS", "");
  db = new Database(":memory:"); migrate(db);
  const users = createUserService(db);
  for (const id of ["100000000000000001", "100000000000000002", "100000000000000003"]) users.ensureDiscord({ discordUserId: id, displayName: id });
  state.actor = { userId: 1, discordUserId: null, userName: "Host" };
  state.authenticated = true;
  state.announce.mockReset().mockResolvedValue({ ok: true });
  state.broadcast.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });

function setup(status: "pending" | "active" = "active", guild = "g", channel: string | null = "c") {
  const players = createPlayerService(db);
  const host = players.findOrCreate(guild, 1, "Host");
  const guest = players.findOrCreate(guild, 2, "Guest");
  const drafts = createDraftService(db);
  const draft = drafts.create(guild, channel, "Emergency", { customCardIds: [1, 2, 3, 4], packSize: 2,
    packsPerPlayer: 1, cardsPerPlayer: 2 }, 1, host.id);
  drafts.join(draft.id, guest.id);
  db.exec(`insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at)
    values (1,'A','Normal Monster','normal','i','i','[]','t'),(2,'B','Normal Monster','normal','i','i','[]','t'),
    (3,'C','Normal Monster','normal','i','i','[]','t'),(4,'D','Normal Monster','normal','i','i','[]','t')`);
  if (status === "active") drafts.start(draft.id, new Date("2030-01-01"));
  return { draft, drafts, host, guest };
}
async function call(action: "end" | "cancel", slug: string) {
  const { POST } = action === "end" ? await import("../app/api/drafts/[slug]/end/route")
    : await import("../app/api/drafts/[slug]/cancel/route");
  return POST(new Request(`http://localhost/api/drafts/${slug}/${action}`, { method: "POST" }), { params: Promise.resolve({ slug }) });
}

describe("emergency draft API", () => {
  it.each(["end", "cancel"] as const)("allows the host to %s and announces committed status", async action => {
    const { draft } = setup();
    const response = await call(action, draft.webSlug!);
    expect(response.status).toBe(200);
    const status = action === "end" ? "completed" : "cancelled";
    expect(await response.json()).toMatchObject({ id: draft.id, webSlug: draft.webSlug, status, changed: true, pickDeadlineAt: null, tournamentId: null });
    expect(state.broadcast).toHaveBeenCalledWith({ kind: "status", slug: draft.webSlug, status });
    expect(state.broadcast).toHaveBeenCalledWith({ kind: "resync", slug: draft.webSlug, packRound: 1, pickStep: 1 });
    expect(state.announce).toHaveBeenCalledWith({ kind: "draft-status", draftId: draft.id });
    if (action === "end") expect(state.announce).toHaveBeenCalledWith({ kind: "draft-completed", draftId: draft.id, channelId: "c", name: draft.name, webSlug: draft.webSlug });
  });
  it.each(["end", "cancel"] as const)("denies a seated non-host's %s with 403", async action => {
    const { draft, drafts } = setup(); state.actor.userId = 2; state.actor.discordUserId = "100000000000000002";
    expect((await call(action, draft.webSlug!)).status).toBe(403);
    expect(drafts.findById(draft.id).status).toBe("active");
    expect(state.broadcast).not.toHaveBeenCalled(); expect(state.announce).not.toHaveBeenCalled();
  });
  it.each(["end", "cancel"] as const)("allows an unseated email-only owner to %s a private draft", async action => {
    const { draft } = setup(); state.actor.userId = 3;
    vi.stubEnv("OWNER_USER_IDS", "3");
    expect((await call(action, draft.webSlug!)).status).toBe(200);
  });
  it.each(["end", "cancel"] as const)("conceals a private draft from an unseated non-owner on %s", async action => {
    const { draft, drafts } = setup(); state.actor.userId = 3;
    const response = await call(action, draft.webSlug!);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Draft not found" });
    expect(drafts.findById(draft.id).status).toBe("active");
    expect(state.broadcast).not.toHaveBeenCalled(); expect(state.announce).not.toHaveBeenCalled();
  });
  it("returns 403 to a non-owner who can read an open lobby", async () => {
    const { draft } = setup("pending"); state.actor.userId = 3;
    db.prepare("update drafts set visibility = 'open' where id = ?").run(draft.id);
    expect((await call("cancel", draft.webSlug!)).status).toBe(403);
  });
  it.each(["end", "cancel"] as const)("rejects unauthenticated %s", async action => {
    const { draft } = setup(); state.authenticated = false;
    expect((await call(action, draft.webSlug!)).status).toBe(401);
  });
  it.each(["end", "cancel"] as const)("scopes %s lookup to the configured guild", async action => {
    const { draft } = setup("active", "foreign");
    state.actor.userId = 3; vi.stubEnv("OWNER_USER_IDS", "3");
    expect((await call(action, draft.webSlug!)).status).toBe(404);
    expect(state.broadcast).not.toHaveBeenCalled();
  });
  it.each(["end", "cancel"] as const)("makes repeated %s safe and rejects the opposite terminal transition", async action => {
    const { draft } = setup(action === "end" ? "active" : "pending");
    expect((await call(action, draft.webSlug!)).status).toBe(200);
    expect(await (await call(action, draft.webSlug!)).json()).toMatchObject({ changed: false });
    // Re-send ws status on retry to help a client recover a missed notification.
    expect(state.broadcast).toHaveBeenCalledTimes(4);
    expect(state.announce).toHaveBeenCalledTimes(action === "end" ? 2 : 1);
    const conflict = await call(action === "end" ? "cancel" : "end", draft.webSlug!);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "DRAFT_ALREADY_FINISHED" });
  });
  it("rejects ending a pending lobby without changing it or notifying clients", async () => {
    const { draft, drafts } = setup("pending");
    const before = drafts.findById(draft.id);
    const response = await call("end", draft.webSlug!);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "DRAFT_NOT_STARTED" });
    expect(drafts.findById(draft.id)).toEqual(before);
    expect(state.broadcast).not.toHaveBeenCalled(); expect(state.announce).not.toHaveBeenCalled();
  });
  it("returns 403 for an email-only seated non-host", async () => {
    const { draft } = setup(); state.actor.userId = 2;
    expect((await call("end", draft.webSlug!)).status).toBe(403);
  });
  it("broadcasts through the existing signed broadcaster after committing uneven picks", async () => {
    const { draft, drafts, host, guest } = setup();
    drafts.pickCard(draft.id, host.id, drafts.pickOptions(draft.id, host.id)[0].id);
    const rec = recordingTransport();
    const broadcaster = createBroadcaster(rec.transport);
    state.broadcast.mockImplementation(async payload => {
      expect(drafts.findById(draft.id).status).toBe("completed");
      expect(drafts.pool(draft.id, guest.id)).toHaveLength(0);
      await broadcaster.draft(payload);
    });
    expect((await call("end", draft.webSlug!)).status).toBe(200);
    expect(rec.calls).toEqual([
      { path: "/internal/draft/status", body: JSON.stringify({ slug: draft.webSlug, status: "completed" }) },
      { path: "/internal/draft/resync", body: JSON.stringify({ slug: draft.webSlug, packRound: 1, pickStep: 1 }) },
    ]);
  });
  it("keeps a committed result successful if notification transport throws", async () => {
    const { draft, drafts } = setup(); state.broadcast.mockRejectedValue(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try { expect((await call("end", draft.webSlug!)).status).toBe(200); expect(drafts.findById(draft.id).status).toBe("completed"); }
    finally { warn.mockRestore(); }
  });
});
