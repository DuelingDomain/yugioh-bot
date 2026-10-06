import type Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "@yugidraft/shared/db";
import { SANDBOX_OPS } from "@yugidraft/shared/duels";
import { createDuelService, createPlayerService, createSandboxScenarioService } from "@yugidraft/shared/services";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), membership: vi.fn(), post: vi.fn(), db: null as Database.Database | null }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/discord-web-access", () => ({ checkDiscordWebAccess: mocks.access, webAccessError: () => "Access denied" }));
vi.mock("@/lib/discord-guild-membership", () => ({ verifyDiscordGuildMembership: mocks.membership }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db! }));
vi.mock("@/lib/env", () => ({ env: { discordGuildId: "guild", duelInternalUrl: "http://host", duelInternalSecret: "test", wsInternalSecret: "test-ws" } }));
vi.mock("@yugidraft/shared/notify", () => ({ httpTransport: () => ({ post: mocks.post }) }));

import { POST as sandbox } from "../app/api/duels/[slug]/sandbox/route";
import { POST as surrender } from "../app/api/duels/[slug]/surrender/route";
import { POST as cancel } from "../app/api/duels/[slug]/cancel/route";
import { GET as connection } from "../app/api/duels/[slug]/connection/route";
import { GET as replay } from "../app/api/duels/[slug]/replay/route";
import { POST as chainMode } from "../app/api/duels/[slug]/chain-mode/route";

const snapshot = { board: { format: "ffa3", startAt: "main2", p0: { hand: [46986414], lp: 3200 } }, run: { bots: { "1": "manual", "2": "pass", "3": "pass" } }, lost: ["Turn count", "Counters"] };
const request = (body?: unknown, method = "POST", query = "") => new NextRequest(`http://local/${query}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const payloads = () => mocks.post.mock.calls.map((call) => JSON.parse(call[1]));
const scenarios = () => createSandboxScenarioService(mocks.db!);
let owner: number;
let slug: string;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.db = openDatabase(":memory:");
  owner = createPlayerService(mocks.db).findOrCreate("guild", "admin", "Admin").id;
  slug = createDuelService(mocks.db).create({ guildId: "guild", organizerPlayerId: owner, name: "Sandbox", mode: "normal", masterRule: 5, sandbox: true }).slug;
  mocks.auth.mockResolvedValue({ user: { id: "admin", name: "Admin" } });
  mocks.access.mockResolvedValue({ ok: true });
  mocks.membership.mockResolvedValue({ ok: true });
  mocks.post.mockImplementation(async (_path: string, raw: string) => ({ ok: true, status: 200, text: JSON.stringify(JSON.parse(raw).op === SANDBOX_OPS.snapshot ? snapshot : { ok: true }) }));
});
afterEach(() => { mocks.db?.close(); vi.unstubAllEnvs(); });

const actions = [
  { action: "eliminate", seat: 0 }, { action: "snapshot" },
  { action: "save-state", name: " Live state " }, { action: "close" },
];

describe("v2 sandbox actions", () => {
  for (const body of actions) {
    describe(body.action, () => {
      it.each([401, 403, 503])("returns %i before calling the host", async (status) => {
        if (status === 401) mocks.auth.mockResolvedValue(null);
        else mocks.access.mockResolvedValue({ ok: false, status });
        expect((await sandbox(request(body), params(slug))).status).toBe(status);
        expect(mocks.post).not.toHaveBeenCalled();
        expect(scenarios().list("guild")).toEqual([]);
      });
      it.each([403, 404, 409])("preserves host refusal %i and does not save", async (status) => {
        mocks.post.mockResolvedValue({ ok: false, status, text: '{"error":"Host refusal","code":"sandbox-refused"}' });
        const response = await sandbox(request(body), params(slug));
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({ error: "Host refusal", code: "sandbox-refused" });
        expect(scenarios().list("guild")).toEqual([]);
      });
    });
  }
  it.each([
    [{ action: "eliminate", seat: 0 }, SANDBOX_OPS.eliminate, { seat: 0 }],
    [{ action: "eliminate", seat: 3 }, SANDBOX_OPS.eliminate, { seat: 3 }],
    [{ action: "snapshot" }, SANDBOX_OPS.snapshot, {}],
    [{ action: "close" }, SANDBOX_OPS.close, {}],
  ])("forwards %j with the shared operation name", async (body, op, fields) => {
    const response = await sandbox(request(body), params(slug));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(op === SANDBOX_OPS.snapshot ? snapshot : { ok: true });
    expect(payloads()).toEqual([{ op, slug, guildId: "guild", playerId: owner, ...fields as object }]);
  });
  it.each([undefined, null, "1", -1, 4, 1.5])("rejects invalid elimination seat %s", async (seat) => {
    expect((await sandbox(request({ action: "eliminate", seat }), params(slug))).status).toBe(400);
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("can repeat close without saving a scenario", async () => {
    for (let i = 0; i < 2; i++) expect((await sandbox(request({ action: "close" }), params(slug))).status).toBe(200);
    expect(payloads().map((p) => p.op)).toEqual([SANDBOX_OPS.close, SANDBOX_OPS.close]);
    expect(scenarios().list("guild")).toEqual([]);
  });
});

describe("save-state", () => {
  it("saves the live snapshot and returns its id and losses without closing", async () => {
    const response = await sandbox(request(actions[2]), params(slug));
    expect(response.status).toBe(200);
    const [saved] = scenarios().list("guild");
    expect(saved).toMatchObject({ name: "Live state", ownerPlayerId: owner, board: snapshot.board, run: snapshot.run });
    expect(await response.json()).toEqual({ scenario: { id: saved.id, name: saved.name }, lost: snapshot.lost });
    expect(payloads()).toEqual([{ op: SANDBOX_OPS.snapshot, slug, guildId: "guild", playerId: owner }]);
  });
  it("updates only the selected scenario owned by the caller", async () => {
    const saved = scenarios().create("guild", owner, { name: "Before", board: {}, run: snapshot.run });
    const response = await sandbox(request({ action: "save-state", name: "After", scenarioId: saved.id }), params(slug));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ scenario: { id: saved.id, name: "After" }, lost: snapshot.lost });
    expect(scenarios().list("guild")).toHaveLength(1);
    expect(scenarios().get(saved.id, "guild")).toMatchObject({ name: "After", board: snapshot.board, run: snapshot.run });
  });
  it.each(["other owner", "other guild", "missing"])("does not overwrite %s", async (target) => {
    const guild = target === "other guild" ? "elsewhere" : "guild";
    const other = createPlayerService(mocks.db!).findOrCreate(guild, "other", "Other");
    const saved = scenarios().create(guild, other.id, { name: "Keep", board: {}, run: snapshot.run });
    const response = await sandbox(request({ action: "save-state", name: "Overwrite", scenarioId: target === "missing" ? 99999 : saved.id }), params(slug));
    expect(response.status).toBe(target === "other owner" ? 403 : 404);
    expect(scenarios().get(saved.id, guild).name).toBe("Keep");
    expect(payloads().some((p) => p.op === SANDBOX_OPS.close)).toBe(false);
  });
  it.each([null, 0, -1, "1", 1.5, 9007199254740992])("rejects invalid scenario id %s before snapshot", async (scenarioId) => {
    expect((await sandbox(request({ action: "save-state", name: "Live", scenarioId }), params(slug))).status).toBe(400);
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it.each([undefined, "", " ", 1, "x".repeat(81)])("preserves scenario name validation for %j", async (name) => {
    expect((await sandbox(request({ action: "save-state", name }), params(slug))).status).toBe(400);
    expect(scenarios().list("guild")).toEqual([]);
    expect(payloads().some((p) => p.op === SANDBOX_OPS.close)).toBe(false);
  });
  it("preserves the 200 scenario limit without closing", async () => {
    for (let i = 0; i < 200; i++) scenarios().create("guild", owner, { name: String(i), board: {}, run: snapshot.run });
    expect((await sandbox(request(actions[2]), params(slug))).status).toBe(409);
    expect(scenarios().list("guild")).toHaveLength(200);
    expect(payloads().map((p) => p.op)).toEqual([SANDBOX_OPS.snapshot]);
  });
  it.each([null, {}, { ...snapshot, lost: "Counters" }, { ...snapshot, lost: [1] }])("rejects malformed host snapshot %j", async (data) => {
    mocks.post.mockResolvedValue({ ok: true, status: 200, text: JSON.stringify(data) });
    expect((await sandbox(request(actions[2]), params(slug))).status).toBe(502);
    expect(scenarios().list("guild")).toEqual([]);
  });
  it("validates snapshot board data through the scenario service", async () => {
    mocks.post.mockResolvedValue({ ok: true, status: 200, text: JSON.stringify({ ...snapshot, board: { teams: [] } }) });
    const response = await sandbox(request(actions[2]), params(slug));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ path: "teams" });
    expect(scenarios().list("guild")).toEqual([]);
  });
});

const routes = [
  { name: "surrender", handler: surrender, method: "POST", body: undefined },
  { name: "cancel", handler: cancel, method: "POST", body: undefined },
  { name: "connection", handler: connection, method: "GET", body: undefined },
  { name: "replay", handler: replay, method: "GET", body: undefined },
  { name: "chain-mode", handler: chainMode, method: "POST", body: { mode: "off" } },
];
for (const route of routes) {
  describe(`sandbox ${route.name} access`, () => {
    const invoke = (target = slug) => route.handler(request(route.body, route.method), params(target));
    it.each(["development", "production", "test"])("denies a non-admin organizer in %s without sandbox query options", async (mode) => {
      vi.stubEnv("NODE_ENV", mode);
      mocks.access.mockResolvedValue({ ok: false, status: 403 });
      expect((await invoke()).status).toBe(403);
      expect(mocks.access).toHaveBeenCalledWith("admin", "admin");
      expect(mocks.post).not.toHaveBeenCalled();
    });
    it("returns 401 when signed out", async () => {
      mocks.auth.mockResolvedValue(null);
      expect((await invoke()).status).toBe(401);
      expect(mocks.post).not.toHaveBeenCalled();
    });
    it("returns 503 when admin access is unavailable", async () => {
      mocks.access.mockResolvedValue({ ok: false, status: 503 });
      expect((await invoke()).status).toBe(503);
      expect(mocks.post).not.toHaveBeenCalled();
    });
    it("returns 404 for a missing duel", async () => {
      expect((await invoke("missing")).status).toBe(404);
      expect(mocks.post).not.toHaveBeenCalled();
    });
    it("refuses a different admin who does not own the sandbox", async () => {
      mocks.auth.mockResolvedValue({ user: { id: "other-admin" } });
      expect((await invoke()).status).toBe(403);
      expect(mocks.post).not.toHaveBeenCalled();
    });
    it("allows the admin organizer", async () => {
      const response = await invoke();
      expect(response.status).toBe(200);
      expect(mocks.access).toHaveBeenCalledWith("admin", "admin");
      if (route.name === "connection") expect(await response.json()).toMatchObject({ token: expect.any(String), guildId: "guild" });
      else expect(payloads()[0]).toMatchObject({ op: route.name, slug, guildId: "guild", playerId: owner });
    });
    it("keeps ordinary duels available to members", async () => {
      const normal = createDuelService(mocks.db!).create({ guildId: "guild", organizerPlayerId: owner, name: "Normal", mode: "normal", masterRule: 5 });
      mocks.access.mockResolvedValue({ ok: false, status: 403 });
      expect((await invoke(normal.slug)).status).toBe(200);
      expect(mocks.access).not.toHaveBeenCalled();
    });
  });
}
