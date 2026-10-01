import { describe, expect, it, vi } from "vitest";
import { ChannelType } from "discord.js";
import { createAnnounceHandlers } from "../../src/announce/handlers.js";

describe("announce handlers", () => {
  it("does not post draft status messages when a web-started draft announces start", async () => {
    const drafts = { findById: vi.fn() };
    const messenger = { postStatus: vi.fn(), updateStatus: vi.fn() };
    const handlers = createAnnounceHandlers({
      client: { channels: { fetch: vi.fn() } } as any,
      db: { prepare: vi.fn() } as any,
      guildSettings: {} as any,
      drafts: drafts as any,
      messenger,
    });

    await handlers.onDraftStarted({ draftId: 1, channelId: "c1", name: "test1", webSlug: "1d4wjhls" });

    expect(drafts.findById).not.toHaveBeenCalled();
    expect(messenger.postStatus).not.toHaveBeenCalled();
    expect(messenger.updateStatus).not.toHaveBeenCalled();
  });

  it("posts signup announcements to text channels", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const handlers = createAnnounceHandlers({
      client: { channels: { fetch: vi.fn().mockResolvedValue({ type: ChannelType.GuildText, send }) } } as any,
      db: { prepare: vi.fn() } as any,
      guildSettings: {} as any,
      drafts: {} as any,
      messenger: {} as any,
    });

    await handlers.onDraftCreated({ draftId: 1, channelId: "c1", name: "test1", webSlug: "1d4wjhls" });

    expect(send).toHaveBeenCalledWith("Signups are open for **test1**. Pick cards: http://localhost:3000/draft/1d4wjhls");
  });

  it("posts tournament-completed announcement to the announce channel", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const channel = { isTextBased: () => true, send };
    const db = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ name: "Test Cup", web_slug: "test-cup", guild_id: "g1" }),
      }),
    };
    const handlers = createAnnounceHandlers({
      client: { channels: { fetch: vi.fn().mockResolvedValue(channel) } } as any,
      db: db as any,
      guildSettings: { get: vi.fn().mockReturnValue({ announceChannelId: "ch1" }) } as any,
      drafts: {} as any,
      messenger: {} as any,
    });

    await handlers.onTournamentCompleted({ tournamentId: 7 });

    expect(send).toHaveBeenCalledWith(
      "🏆 **Test Cup** has completed! Final standings: http://localhost:3000/tournament/test-cup",
    );
  });

  describe("duel invite DM", () => {
    const invite = {
      guildId: "g1",
      opponentDiscordUserId: "u2",
      challengerName: "Yugi",
      duelName: "Yugi vs Kaiba",
      bestOf: 3 as const,
      ranked: true,
      tournamentName: null,
      url: "http://localhost:3000/duels/abc",
    };

    function build(users: unknown) {
      return createAnnounceHandlers({
        client: { channels: { fetch: vi.fn() }, users } as any,
        db: { prepare: vi.fn() } as any,
        guildSettings: {} as any,
        drafts: {} as any,
        messenger: {} as any,
      });
    }

    it("DMs the opponent an embed with a Join duel link button", async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      const fetch = vi.fn().mockResolvedValue({ send });
      await build({ fetch }).onDuelInvite(invite);

      expect(fetch).toHaveBeenCalledWith("u2");
      const message = send.mock.calls[0][0];
      const embed = message.embeds[0].toJSON();
      expect(embed.description).toContain("Yugi");
      expect(embed.fields).toEqual(
        expect.arrayContaining([
          { name: "Duel", value: "Yugi vs Kaiba", inline: true },
          { name: "Match", value: "Best of 3", inline: true },
          { name: "Type", value: "Ranked", inline: true },
        ]),
      );
      const button = message.components[0].toJSON().components[0];
      expect(button).toMatchObject({ label: "Join duel", url: "http://localhost:3000/duels/abc" });
    });

    it("names the tournament instead of Ranked/Unranked", async () => {
      const send = vi.fn().mockResolvedValue(undefined);
      await build({ fetch: vi.fn().mockResolvedValue({ send }) }).onDuelInvite({
        ...invite,
        ranked: false,
        tournamentName: "Spring Cup",
      });
      const embed = send.mock.calls[0][0].embeds[0].toJSON();
      expect(embed.fields).toEqual(expect.arrayContaining([{ name: "Tournament", value: "Spring Cup", inline: true }]));
      expect(JSON.stringify(embed)).not.toContain("Unranked");
    });

    it("logs a DM failure and does not throw", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const send = vi.fn().mockRejectedValue(new Error("Cannot send messages to this user"));
      await expect(build({ fetch: vi.fn().mockResolvedValue({ send }) }).onDuelInvite(invite)).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("u2"), expect.any(Error));
      warn.mockRestore();
    });

    it("logs an unknown user and does not throw", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await expect(
        build({ fetch: vi.fn().mockRejectedValue(new Error("Unknown User")) }).onDuelInvite(invite),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
