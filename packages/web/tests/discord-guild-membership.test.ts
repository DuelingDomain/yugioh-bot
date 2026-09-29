import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DISCORD_GUILD_MEMBERSHIP_TTL_MS,
  resetDiscordGuildMembershipCache,
  verifyDiscordGuildMembership,
} from "../src/lib/discord-guild-membership";

const guildId = "guild-1";
const userId = "196382527131222016";
const botToken = "bot-token";

function memberUrl(): string {
  return `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`;
}

function jsonResponse(status: number): Response {
  return new Response("{}", { status, headers: { "content-type": "application/json" } });
}

describe("verifyDiscordGuildMembership", () => {
  afterEach(() => {
    resetDiscordGuildMembershipCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("allows a guild member", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyDiscordGuildMembership({ guildId, userId, botToken, now: 1_000 }),
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(memberUrl());
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: `Bot ${botToken}` },
    });
  });

  it("rejects an outsider without creating a later cache miss for the same window", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyDiscordGuildMembership({ guildId, userId, botToken, now: 1_000 }),
    ).resolves.toEqual({ ok: false, status: 403 });
    fetchMock.mockClear();

    await expect(
      verifyDiscordGuildMembership({ guildId, userId, botToken, now: 1_000 + DISCORD_GUILD_MEMBERSHIP_TTL_MS - 1 }),
    ).resolves.toEqual({ ok: false, status: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the bot token is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyDiscordGuildMembership({ guildId, userId, botToken: "", now: 1_000 }),
    ).resolves.toEqual({ ok: false, status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed on Discord 5xx without caching", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyDiscordGuildMembership({ guildId, userId, botToken, now: 1_000 }),
    ).resolves.toEqual({ ok: false, status: 503 });
    fetchMock.mockResolvedValueOnce(jsonResponse(200));

    await expect(
      verifyDiscordGuildMembership({ guildId, userId, botToken, now: 1_001 }),
    ).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed on timeout or network errors without caching", async () => {
    const fetchMock = vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyDiscordGuildMembership({ guildId, userId, botToken, now: 1_000 }),
    ).resolves.toEqual({ ok: false, status: 503 });
    fetchMock.mockResolvedValueOnce(jsonResponse(200));

    await expect(
      verifyDiscordGuildMembership({ guildId, userId, botToken, now: 1_001 }),
    ).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refetches after the cache TTL expires", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyDiscordGuildMembership({ guildId, userId, botToken, now: 1_000 }),
    ).resolves.toEqual({ ok: true });
    fetchMock.mockClear();

    await expect(
      verifyDiscordGuildMembership({ guildId, userId, botToken, now: 1_000 + DISCORD_GUILD_MEMBERSHIP_TTL_MS - 1 }),
    ).resolves.toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(jsonResponse(404));
    await expect(
      verifyDiscordGuildMembership({ guildId, userId, botToken, now: 1_000 + DISCORD_GUILD_MEMBERSHIP_TTL_MS }),
    ).resolves.toEqual({ ok: false, status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent lookups for the same member", async () => {
    const { promise, resolve } = Promise.withResolvers<Response>();
    const fetchMock = vi.fn().mockReturnValue(promise);
    vi.stubGlobal("fetch", fetchMock);

    const first = verifyDiscordGuildMembership({ guildId, userId, botToken, now: 1_000 });
    const second = verifyDiscordGuildMembership({ guildId, userId, botToken, now: 1_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolve(jsonResponse(200));
    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
