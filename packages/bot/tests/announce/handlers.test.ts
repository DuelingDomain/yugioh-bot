import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../../src/db/schema.js";
import { createDraftService, createGuildSettingsService, createMatchService } from "@yugidraft/shared/services";
import { ChannelType } from "discord.js";
import { createAnnounceHandlers } from "../../src/announce/handlers.js";

describe("announce handlers", () => {
  function completed() {
    const db = new Database(":memory:");
    migrate(db);
    db.exec(`insert into users(id,username,display_name) values(101,'host','Host');
      insert into drafts(id,guild_id,channel_id,name,status,created_by_user_id,web_slug,ended_at)
      values(13,'g','channel','Draft','completed',101,'draft',current_timestamp)`);
    const send = vi.fn(async () => ({ id: "discord-message" }));
    const messenger = { postStatus: vi.fn(async () => {}), updateStatus: vi.fn(async () => {}) };
    const fetchChannel = vi.fn(async () => ({ type: ChannelType.GuildText, isTextBased: () => true, send }));
    const handlers = createAnnounceHandlers({
      db, drafts: createDraftService(db), guildSettings: createGuildSettingsService(db), messenger,
      client: { channels: { fetch: fetchChannel }, users: { fetch: vi.fn() } } as any,
    });
    return { db, handlers, send, messenger, fetchChannel };
  }

  const completionPayload = { draftId: 13, channelId: "channel", name: "Draft", webSlug: "draft" };

  it("claims concurrent draft completions once", async () => {
    const { db, handlers, send } = completed();
    try {
      await Promise.all([handlers.onDraftCompleted(completionPayload), handlers.onDraftCompleted(completionPayload)]);
      expect(send).toHaveBeenCalledTimes(1);
      expect(db.prepare("select complete_message_id from drafts where id=13").get())
        .toEqual({ complete_message_id: "discord-message" });
    } finally { db.close(); }
  });

  it("retains a failed delivery claim without undoing completion", async () => {
    const { db, handlers, send } = completed();
    send.mockRejectedValue(new Error("Discord unavailable"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await Promise.allSettled([handlers.onDraftCompleted(completionPayload), handlers.onDraftCompleted(completionPayload)]);
      await handlers.onDraftCompleted(completionPayload);
      expect(send).toHaveBeenCalledTimes(1);
      expect(db.prepare("select status,complete_message_id from drafts where id=13").get())
        .toEqual({ status: "completed", complete_message_id: "worker-claimed" });
      expect(error).toHaveBeenCalledWith(expect.stringContaining("delivery failed for 13"), expect.any(Error));
    } finally { error.mockRestore(); db.close(); }
  });

  it("uses the stored completion details rather than supplied announcement fields", async () => {
    const { db, handlers, send, fetchChannel } = completed();
    try {
      await handlers.onDraftCompleted({ draftId: 13, channelId: "forged-channel", name: "Forged", webSlug: "forged" });
      expect(fetchChannel).toHaveBeenCalledWith("channel");
      expect(send).toHaveBeenCalledWith(expect.objectContaining({
        content: "**Draft** has completed! View results: http://localhost:3000/draft/draft",
      }));
    } finally { db.close(); }
  });

  it("updates draft status without changing onDraftStarted behavior", async () => {
    const { db, handlers, messenger } = completed();
    try {
      await handlers.onDraftStatus({ draftId: 13 });
      expect(messenger.updateStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 13, status: "completed" }));
    } finally { db.close(); }
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "13"])("rejects invalid draft-status ID %s", async draftId => {
    const { db, handlers, messenger } = completed();
    try {
      await expect(handlers.onDraftStatus({ draftId: draftId as number })).rejects.toThrow("Invalid draft ID");
      expect(messenger.updateStatus).not.toHaveBeenCalled();
    } finally { db.close(); }
  });

  it("does not send status or completion messages for a channel-free draft", async () => {
    const { db, handlers, messenger, fetchChannel } = completed();
    try {
      db.prepare("update drafts set channel_id=null where id=13").run();
      await handlers.onDraftStatus({ draftId: 13 });
      await handlers.onDraftCompleted(completionPayload);
      expect(messenger.updateStatus).not.toHaveBeenCalled();
      expect(fetchChannel).not.toHaveBeenCalled();
      expect(db.prepare("select complete_message_id from drafts where id=13").get())
        .toEqual({ complete_message_id: null });
    } finally { db.close(); }
  });

  it("does not claim completion for an active draft", async () => {
    const { db, handlers, fetchChannel } = completed();
    try {
      db.prepare("update drafts set status='active' where id=13").run();
      await handlers.onDraftCompleted(completionPayload);
      expect(fetchChannel).not.toHaveBeenCalled();
      expect(db.prepare("select complete_message_id from drafts where id=13").get())
        .toEqual({ complete_message_id: null });
    } finally { db.close(); }
  });

  it("delivers a tournament completion already claimed by its caller", async () => {
    const { db, handlers, send } = completed();
    try {
      db.exec(`insert into tournaments(id,guild_id,name,format,status,created_by_user_id,web_slug)
        values(7,'g','Cup','round_robin','completed',101,'cup');
        insert into guild_settings(guild_id,announce_channel_id) values('g','channel')`);
      const matches = createMatchService(db);
      expect(matches.claimTournamentCompletionAnnouncement(7)).toBe(true);
      const before = db.prepare("select completed_announced_at from tournaments where id=7").get();
      await handlers.onTournamentCompleted({ tournamentId: 7 });
      expect(send).toHaveBeenCalledTimes(1);
      expect(db.prepare("select completed_announced_at from tournaments where id=7").get()).toEqual(before);
      expect(matches.claimTournamentCompletionAnnouncement(7)).toBe(false);
    } finally { db.close(); }
  });

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
      opponentDiscordUserId: "900000000000000111",
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

      expect(fetch).toHaveBeenCalledWith("900000000000000111");
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
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("900000000000000111"), expect.any(Error));
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
