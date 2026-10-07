import { openDatabase } from "@yugidraft/shared/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/discord-web-access", () => ({ checkDiscordWebAccess: mocks.access, webAccessError: () => "Forbidden" }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/env", () => ({ env: { discordGuildId: "guild" } }));

import { requireSandboxActor } from "@/lib/sandbox-access";
import { GET } from "../app/api/sandbox/access/route";

let db: ReturnType<typeof openDatabase>;

// Synthetic IDs, not real Discord accounts.
const developer = "1".repeat(18);
beforeEach(() => {
  vi.clearAllMocks();
  db = openDatabase(":memory:");
  mocks.db.mockReturnValue(db);
  vi.stubEnv("SANDBOX_DISCORD_IDS", undefined);
  mocks.auth.mockResolvedValue({ user: { id: developer } });
  mocks.access.mockResolvedValue({ ok: true });
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });

describe("sandbox developer allowlist", () => {
  it.each(["production", "development", "test"])("denies an admin with an unset list in %s before opening the database", async (mode) => {
    vi.stubEnv("NODE_ENV", mode);
    const actor = await requireSandboxActor();
    expect(actor.ok).toBe(false);
    if (!actor.ok) expect(actor.response.status).toBe(403);
    expect(mocks.db).not.toHaveBeenCalled();
  });

  it("returns 403 from the access API for an unlisted admin", async () => {
    expect((await GET()).status).toBe(403);
  });
});

describe("allowlist parsing and membership", () => {
  it.each([undefined, "", " , , ", "invalid", "1".repeat(16), "1".repeat(21), "+" + developer, developer + "x", "１".repeat(18)])("denies malformed or empty configuration %s", async (value) => {
    vi.stubEnv("SANDBOX_DISCORD_IDS", value);
    // Even a matching session ID must not make an invalid entry valid.
    if (value?.trim()) mocks.auth.mockResolvedValue({ user: { id: value.trim() } });
    const actor = await requireSandboxActor();
    expect(actor.ok).toBe(false);
    if (!actor.ok) expect(actor.response.status).toBe(403);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it.each([17, 18, 19, 20])("allows a listed non-admin member with a %i-digit ID", async (length) => {
    const id = "1".repeat(length);
    mocks.auth.mockResolvedValue({ user: { id } });
    vi.stubEnv("SANDBOX_DISCORD_IDS", ` , invalid, ${"2".repeat(18)}, ${id} , ,`);
    mocks.access.mockImplementation(async (_id, level) => level === "member" ? { ok: true } : { ok: false, status: 403 });
    expect(await requireSandboxActor()).toMatchObject({ ok: true, guildId: "guild" });
    expect(mocks.access).toHaveBeenCalledWith(id, "member");
  });
  it.each([403, 503])("preserves membership refusal %i for a listed developer", async (status) => {
    vi.stubEnv("SANDBOX_DISCORD_IDS", developer);
    mocks.access.mockResolvedValue({ ok: false, status });
    const actor = await requireSandboxActor();
    expect(actor.ok).toBe(false);
    if (!actor.ok) expect(actor.response.status).toBe(status);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it("requires a signed-in user even with a configured list", async () => {
    vi.stubEnv("SANDBOX_DISCORD_IDS", developer);
    mocks.auth.mockResolvedValue(null);
    const actor = await requireSandboxActor();
    expect(actor.ok).toBe(false);
    if (!actor.ok) expect(actor.response.status).toBe(401);
  });
});

// Exercise the real page gate; no builder or scenario reads should happen on denial.
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("../app/(app)/sandbox/_components/sandbox-list", () => ({ SandboxList: () => null }));
vi.mock("../app/(app)/sandbox/_components/scenario-editor", () => ({ ScenarioEditor: () => null }));
vi.mock("../app/(app)/sandbox/_components/play-now", () => ({ PlayNow: () => null }));

describe("sandbox page access", () => {
  it.each([undefined, "", "2".repeat(18)])("returns 404 for unlisted admins with list %s on every page", async (list) => {
    vi.stubEnv("SANDBOX_DISCORD_IDS", list);
    const { default: index } = await import("../app/(app)/sandbox/page");
    const { default: create } = await import("../app/(app)/sandbox/new/page");
    const { default: scenario } = await import("../app/(app)/sandbox/[id]/page");
    await expect(index()).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(create({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(scenario({ params: Promise.resolve({ id: "1" }), searchParams: Promise.resolve({ play: "1" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.db).not.toHaveBeenCalled();
  });
});
