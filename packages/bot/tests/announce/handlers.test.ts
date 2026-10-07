import Database from "better-sqlite3";
import { migrate } from "../../src/db/schema.js";
import { describe, expect, it, vi } from "vitest";
import { ChannelType } from "discord.js";
import { createAnnounceHandlers } from "../../src/announce/handlers.js";
import { createDraftLobbyService } from "@yugidraft/shared/services";

describe("announce handlers", () => {
  it("posts a real started announcement using the committed draft and stored channel", async () => {
    const send = vi.fn().mockResolvedValue({ id: "message" });
    const fetch = vi.fn().mockResolvedValue({ type: ChannelType.GuildText, guildId: "g1", send });
    const draft = { id: 1, guildId: "g1", channelId: "stored", name: "Actual", webSlug: "actual", status: "active" };
    const messenger = { postStatus: vi.fn(), updateStatus: vi.fn() };
    const handlers = createAnnounceHandlers({ client: { channels: { fetch } } as any, db: {} as any,
      guildSettings: {} as any, drafts: { findById: () => draft } as any, messenger });
    await handlers.onDraftStarted({ draftId: 1, channelId: "untrusted", name: "fake", webSlug: "fake" });
    expect(fetch).toHaveBeenCalledWith("stored");
    expect(messenger.postStatus).toHaveBeenCalledWith(draft);
    expect(send.mock.calls[0][0].content).toContain("Actual");
    expect(send.mock.calls[0][0].components[0].toJSON().components[0].url).toContain("/draft/actual");
    expect(send.mock.calls[0][0].allowedMentions).toEqual({ parse: [], users: [] });
  });

  it("still sends the started message if updating the existing status fails", async () => {
    const draft = { id: 1, guildId: "g1", channelId: "stored", name: "Night", webSlug: "night", status: "active", statusMessageId: "status" };
    const send = vi.fn().mockResolvedValue({ id: "message" });
    const messenger = { postStatus: vi.fn(), updateStatus: vi.fn().mockRejectedValue(new Error("Cannot edit")) };
    const handlers = createAnnounceHandlers({ client: { channels: { fetch: vi.fn().mockResolvedValue({ type: ChannelType.GuildText, guildId: "g1", send }) } } as any,
      db: {} as any, drafts: { findById: () => draft } as any, messenger, guildSettings: {} as any });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await handlers.onDraftStarted({ draftId: 1, channelId: "stored", name: "Night", webSlug: "night" });
      expect(messenger.updateStatus).toHaveBeenCalledWith(draft);
      expect(messenger.postStatus).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalled();
    } finally { warn.mockRestore(); }
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


describe("Nudge delivery validation", () => {
  const unreadyId = "123456789012345678", readyId = "234567890123456789";
  function setup() {
    const db = new Database(":memory:");
    migrate(db);
    db.prepare(`insert into drafts (id, guild_id, channel_id, name, status, created_by_user_id, config_json, web_slug)
      values (1, 'g1', 'stored', 'Actual', 'pending', 'host', '{}', 'actual')`).run();
    const ids = [unreadyId, readyId, "bot_player_dev_1", "345678901234567890"];
    for (const [index, id] of ids.entries()) {
      db.prepare("insert into players (id, guild_id, discord_user_id, display_name) values (?, ?, ?, 'Player')").run(index + 1, index === 3 ? "other-guild" : "g1", id);
      db.prepare("insert into draft_players (draft_id, player_id, seat_index) values (1, ?, ?)").run(index + 1, index);
    }
    const send = vi.fn().mockResolvedValue({ id: "message" });
    const fetch = vi.fn().mockResolvedValue({ type: ChannelType.GuildText, guildId: "g1", send });
    const read = vi.fn(() => ({ players: [
      { playerId: 1, ready: false, isBot: false }, { playerId: 2, ready: true, isBot: false },
      { playerId: 3, ready: true, isBot: true }, { playerId: 4, ready: false, isBot: false },
    ] }));
    const handlers = createAnnounceHandlers({ client: { channels: { fetch } } as any, db,
      guildSettings: {} as any, drafts: {} as any, messenger: {} as any, lobby: { read } as any });
    const payload = { draftId: 1, channelId: "arbitrary", name: "fake", webSlug: "fake",
      mentionUserIds: [unreadyId, unreadyId, readyId, "bot_player_dev_1", "345678901234567890", "999999999999999999", "@everyone", "1"] };
    return { db, handlers, send, fetch, read, payload };
  }
  it("uses the stored channel/name/slug and whitelists only joined unready guild humans", async () => {
    const app = setup();
    try {
      await app.handlers.onDraftNudge(app.payload);
      expect(app.fetch).toHaveBeenCalledWith("stored");
      const message = app.send.mock.calls[0][0];
      expect(message.allowedMentions).toEqual({ parse: [], users: [unreadyId] });
      expect(message.content).toContain("Actual");
      expect(message.components[0].toJSON().components[0].url).toContain("/draft/actual");
    } finally { app.db.close(); }
  });
  it("reads persisted readiness from the shared service when no lobby is injected", async () => {
    const app = setup();
    try {
      createDraftLobbyService(app.db).setReady(1, readyId, true);
      const handlers = createAnnounceHandlers({ client: { channels: { fetch: app.fetch } } as any, db: app.db,
        guildSettings: {} as any, drafts: {} as any, messenger: {} as any });
      await handlers.onDraftNudge(app.payload);
      expect(app.send.mock.calls[0][0].allowedMentions).toEqual({ parse: [], users: [unreadyId] });
      expect(app.read).not.toHaveBeenCalled();
    } finally { app.db.close(); }
  });
  it.each(["absent", "foreign", "unsendable", "send-failure", "active", "ready-after-fetch", "leave-after-fetch"])("handles %s channels or state without claiming false success", async scenario => {
    const app = setup();
    try {
      if (scenario === "absent") app.fetch.mockResolvedValue(null as any);
      if (scenario === "foreign") app.fetch.mockResolvedValue({ type: ChannelType.GuildText, guildId: "other", send: app.send });
      if (scenario === "unsendable") app.fetch.mockResolvedValue({ type: ChannelType.GuildVoice } as any);
      if (scenario === "send-failure") app.send.mockRejectedValue(new Error("Cannot send"));
      if (scenario === "active") app.db.prepare("update drafts set status = 'active'").run();
      if (scenario === "ready-after-fetch") app.fetch.mockImplementation(async () => {
        app.read.mockReturnValue({ players: [{ playerId: 1, ready: true, isBot: false }] });
        return { type: ChannelType.GuildText, guildId: "g1", send: app.send };
      });
      if (scenario === "leave-after-fetch") app.fetch.mockImplementation(async () => {
        app.db.prepare("delete from draft_players where player_id = 1").run();
        return { type: ChannelType.GuildText, guildId: "g1", send: app.send };
      });
      if (scenario.endsWith("after-fetch")) {
        await app.handlers.onDraftNudge(app.payload);
        expect(app.send.mock.calls[0][0].allowedMentions.users).toEqual([]);
      } else {
        await expect(app.handlers.onDraftNudge(app.payload)).rejects.toThrow();
        if (scenario !== "send-failure") expect(app.send).not.toHaveBeenCalled();
      }
    } finally { app.db.close(); }
  });
});
