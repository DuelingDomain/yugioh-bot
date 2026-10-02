import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const input = { guildId: "guild-1", userId: "user-1", botToken: "bot-token", now: 1_000 };
let verify: typeof import("../src/lib/discord-guild-admin").verifyDiscordGuildAdmin;
let fetchMock: ReturnType<typeof vi.fn>;
let member: { roles: string[] };
let guild: { owner_id: string; roles: Array<{ id: string; permissions: string }> };

describe("verifyDiscordGuildAdmin", () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ verifyDiscordGuildAdmin: verify } = await import("../src/lib/discord-guild-admin"));
    member = { roles: ["member-role"] };
    guild = { owner_id: "other-user", roles: [{ id: "member-role", permissions: "0" }] };
    fetchMock = vi.fn(async (url: string) => Response.json(url.includes("/members/") ? member : guild));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("allows the guild owner even without privileged roles", async () => {
    guild.owner_id = "user-1";
    await expect(verify(input)).resolves.toEqual({ ok: true });
  });

  it.each(["8", "32", "1099511627816"])("allows a member role with privileged permissions %s", async (permissions) => {
    guild.roles[0].permissions = permissions;
    await expect(verify(input)).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://discord.com/api/v10/guilds/guild-1/members/user-1",
      "https://discord.com/api/v10/guilds/guild-1",
    ]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bot bot-token" } });
  });

  it.each(["8", "32"])("includes @everyone permissions %s even though that role is not in member.roles", async (permissions) => {
    member.roles = [];
    guild.roles.push({ id: "guild-1", permissions });
    await expect(verify(input)).resolves.toEqual({ ok: true });
  });

  it("rejects ordinary members and ignores privileged roles they do not hold", async () => {
    guild.roles[0].permissions = "16";
    guild.roles.push({ id: "unassigned-admin", permissions: "8" });
    await expect(verify(input)).resolves.toEqual({ ok: false, status: 403 });
  });

  it("rejects non-members even if the guild lookup would grant permissions", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    guild.roles[0].permissions = "32";
    await expect(verify(input)).resolves.toEqual({ ok: false, status: 403 });
  });

  it.each([401, 403, 429, 500])("cools down Discord member status %s failures", async (status) => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status }));
    await expect(verify(input)).resolves.toEqual({ ok: false, status: 503 });
    guild.roles[0].permissions = "32";
    await expect(verify({ ...input, now: 10_999 })).resolves.toEqual({ ok: false, status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(verify({ ...input, now: 11_000 })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fails closed on guild errors", async () => {
    fetchMock.mockImplementation(async (url: string) => url.includes("/members/")
      ? Response.json(member) : new Response("{}", { status: 500 }));
    await expect(verify(input)).resolves.toEqual({ ok: false, status: 503 });
  });

  it("fails closed when the bot token is missing even if an allow decision is cached", async () => {
    guild.roles[0].permissions = "32";
    await expect(verify(input)).resolves.toEqual({ ok: true });
    await expect(verify({ ...input, botToken: "" })).resolves.toEqual({ ok: false, status: 503 });
  });

  it("fails closed on timeout/network errors", async () => {
    fetchMock.mockRejectedValueOnce(new Error("aborted"));
    await expect(verify(input)).resolves.toEqual({ ok: false, status: 503 });
  });

  it("fails closed on malformed role permissions", async () => {
    guild.roles[0].permissions = "invalid";
    await expect(verify(input)).resolves.toEqual({ ok: false, status: 503 });
  });

  it("caches allowed permissions only until the TTL", async () => {
    guild.roles[0].permissions = "32";
    await expect(verify(input)).resolves.toEqual({ ok: true });
    guild.roles[0].permissions = "0";
    await expect(verify({ ...input, now: 60_999 })).resolves.toEqual({ ok: true });
    await expect(verify({ ...input, now: 61_000 })).resolves.toEqual({ ok: false, status: 403 });
  });

  it("caches negative decisions and isolates users and guilds", async () => {
    await expect(verify(input)).resolves.toEqual({ ok: false, status: 403 });
    guild.roles[0].permissions = "32";
    await expect(verify(input)).resolves.toEqual({ ok: false, status: 403 });
    await expect(verify({ ...input, userId: "another-user" })).resolves.toEqual({ ok: true });
    await expect(verify({ ...input, guildId: "another-guild" })).resolves.toEqual({ ok: true });
  });

  it("deduplicates concurrent lookups", async () => {
    const { promise, resolve } = Promise.withResolvers<Response>();
    fetchMock.mockReturnValueOnce(promise);
    guild.roles[0].permissions = "32";
    const first = verify(input);
    const second = verify(input);
    resolve(Response.json(member));
    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each(["member", "guild"])("honours 429 retry intervals from the %s lookup", async (stage) => {
    guild.roles[0].permissions = "32";
    if (stage === "guild") fetchMock.mockResolvedValueOnce(Response.json(member));
    fetchMock.mockResolvedValueOnce(Response.json({ retry_after: 20 }, { status: 429, headers: { "Retry-After": "25" } }));
    await expect(verify(input)).resolves.toEqual({ ok: false, status: 503 });
    await expect(verify({ ...input, now: 25_999 })).resolves.toEqual({ ok: false, status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(stage === "member" ? 1 : 2);
    await expect(verify({ ...input, now: 26_000 })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(stage === "member" ? 3 : 4);
  });

  it("deduplicates concurrent failures and retains the cooldown", async () => {
    const { promise, resolve } = Promise.withResolvers<Response>();
    fetchMock.mockReturnValueOnce(promise);
    guild.roles[0].permissions = "32";
    const first = verify(input);
    const second = verify(input);
    resolve(new Response("{}", { status: 500 }));
    expect(await Promise.all([first, second])).toEqual([{ ok: false, status: 503 }, { ok: false, status: 503 }]);
    await expect(verify({ ...input, now: 10_999 })).resolves.toEqual({ ok: false, status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(verify({ ...input, now: 11_000 })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("starts the cooldown after a slow guild lookup fails", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { now: _now, ...request } = input;
    guild.roles[0].permissions = "32";
    fetchMock.mockResolvedValueOnce(Response.json(member)).mockImplementationOnce(async () => {
      clock.mockReturnValue(15_000);
      return new Response("{}", { status: 500 });
    });
    await expect(verify(request)).resolves.toEqual({ ok: false, status: 503 });
    clock.mockReturnValue(24_999);
    await expect(verify(request)).resolves.toEqual({ ok: false, status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    clock.mockReturnValue(25_000);
    await expect(verify(request)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

});
