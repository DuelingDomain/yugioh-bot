import { openDatabase } from "@yugidraft/shared/db";
import { createUserService } from "@yugidraft/shared/services";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ identity: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/session-identity", () => ({ resolveSessionIdentity: mocks.identity }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/env", () => ({ env: { discordGuildId: "guild" } }));

import { requireSandboxActor } from "@/lib/sandbox-access";
import { GET } from "../app/api/sandbox/access/route";

let db: ReturnType<typeof openDatabase>;
const developer = "1".repeat(18);
function signIn(discordUserId: string | null = developer) {
  const user = discordUserId && /^\d{1,25}$/.test(discordUserId)
    ? createUserService(db).ensureDiscord({ discordUserId, displayName: "Developer" })
    : createUserService(db).createNonLogin("Developer");
  mocks.identity.mockResolvedValue({ ok: true, identity: { userId: user.id, name: user.displayName, discordUserId } });
  return user;
}
beforeEach(() => {
  vi.clearAllMocks();
  db = openDatabase(":memory:");
  mocks.db.mockReturnValue(db);
  vi.stubEnv("SANDBOX_DISCORD_IDS", undefined);
  signIn();
  mocks.db.mockClear();
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); });

describe("sandbox developer allowlist", () => {
  it.each(["production", "development", "test"])("denies an unlisted user in %s before opening the database", async mode => {
    vi.stubEnv("NODE_ENV", mode);
    const actor = await requireSandboxActor();
    expect(actor.ok).toBe(false);
    if (!actor.ok) expect(actor.response.status).toBe(403);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it("returns 403 from the access API for an unlisted user", async () => {
    expect((await GET()).status).toBe(403);
  });
  it.each([undefined, "", " , , ", "invalid", "1".repeat(16), "1".repeat(21), "+" + developer, developer + "x", "１".repeat(18)])("denies malformed or empty configuration %s", async value => {
    vi.stubEnv("SANDBOX_DISCORD_IDS", value);
    if (value?.trim()) signIn(value.trim());
    mocks.db.mockClear();
    const actor = await requireSandboxActor();
    expect(actor.ok).toBe(false);
    if (!actor.ok) expect(actor.response.status).toBe(403);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it.each([17, 18, 19, 20])("maps a listed %i-digit Discord identity to its numeric user and player", async length => {
    const id = "1".repeat(length);
    const user = signIn(id);
    vi.stubEnv("SANDBOX_DISCORD_IDS", ` , invalid, ${"2".repeat(18)}, ${id} , ,`);
    const actor = await requireSandboxActor();
    expect(actor).toMatchObject({ ok: true, guildId: "guild", userId: user.id });
    if (actor.ok) expect(db.prepare("select user_id from players where id=?").get(actor.playerId)).toEqual({ user_id: user.id });
  });
  it.each([401, 503])("preserves session refusal %i before accessing the database", async status => {
    vi.stubEnv("SANDBOX_DISCORD_IDS", developer);
    mocks.identity.mockResolvedValue({ ok: false, status });
    const actor = await requireSandboxActor();
    expect(actor.ok).toBe(false);
    if (!actor.ok) expect(actor.response.status).toBe(status);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it("does not grant a Clerk account access from its numeric user ID", async () => {
    const user = signIn(null);
    vi.stubEnv("SANDBOX_DISCORD_IDS", String(user.id));
    expect((await requireSandboxActor()).ok).toBe(false);
  });
});

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("../app/(app)/sandbox/_components/sandbox-list", () => ({ SandboxList: () => null }));
vi.mock("../app/(app)/sandbox/_components/scenario-editor", () => ({ ScenarioEditor: () => null }));
vi.mock("../app/(app)/sandbox/_components/play-now", () => ({ PlayNow: () => null }));

describe("sandbox page access", () => {
  it.each([undefined, "", "2".repeat(18)])("returns 404 for unlisted users with list %s on every page", async list => {
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
