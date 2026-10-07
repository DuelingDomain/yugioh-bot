import { createHmac } from "node:crypto";
import Database from "better-sqlite3";
import { ChannelType } from "discord.js";
import { expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDraftService, createGuildSettingsService, createPlayerService } from "@yugidraft/shared/services";
import { recordingTransport } from "@yugidraft/shared/notify";
import { createAnnounceHandlers } from "../../src/announce/handlers.js";
import { createAnnounceServer } from "../../src/announce/server.js";

it("worker status and duplicate completion reach signed bot HTTP and send once", async () => {
  // Runtime import keeps worker outside the bot compiler rootDir. Build it first.
  const { createEffects } = await import(new URL("../../../worker/dist/effects.js", import.meta.url).href);
  const db = new Database(":memory:");
  migrate(db);
  try {
    const drafts = createDraftService(db);
    const player = createPlayerService(db).findOrCreateByDiscord("g", "900000000000000101", "Alice");
    const draft = drafts.create("g", "channel", "Smoke", {}, player.userId, player.id);
    db.prepare("update drafts set status='completed',ended_at=current_timestamp where id=?").run(draft.id);
    const send = vi.fn(async () => ({id: "discord-message"})), updateStatus = vi.fn(async () => {});
    const handlers = createAnnounceHandlers({
      db, drafts, guildSettings: createGuildSettingsService(db),
      messenger: {postStatus: vi.fn(async () => {}), updateStatus},
      client: {channels: {fetch: vi.fn(async () => ({type: ChannelType.GuildText, send}))}, users: {fetch: vi.fn()}} as any,
    });
    const secret = "worker-smoke", app = createAnnounceServer({secret, handlers}), ws = recordingTransport();
    const statuses: number[] = [];
    const effects = createEffects({enabled: true, ws: ws.transport, bot: {
      async post(path: string, body: string) {
        const response = await app.handle(new Request(`http://bot${path}`, {
          method: "POST", body,
          headers: {"x-announce-signature": "sha256=" + createHmac("sha256", secret).update(body).digest("hex")},
        }));
        statuses.push(response.status);
        return {ok: response.ok, status: response.status, text: await response.text()};
      },
    }});
    await effects.discord({kind: "draft-status", draftId: draft.id});
    expect(updateStatus).toHaveBeenCalledWith(expect.objectContaining({id: draft.id, status: "completed"}));
    const payload = {kind: "draft-completed" as const, draftId: draft.id, channelId: "channel", name: draft.name, webSlug: draft.webSlug!};
    await Promise.all([effects.discord(payload), effects.discord(payload)]);
    expect(statuses).toEqual([204, 204, 204]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(db.prepare("select complete_message_id from drafts where id=?").get(draft.id)).toEqual({complete_message_id: "discord-message"});
    expect(db.pragma("foreign_key_check")).toEqual([]);
  } finally { db.close(); }
});
