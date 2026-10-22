import { createHash, randomBytes } from "node:crypto";
import { DiscordAPIError, RateLimitError, REST, Routes, escapeMarkdown, type APIEmbed } from "discord.js";
import { log, report } from "@yugidraft/shared/observability";
import type { FeatureContext } from "../../runtime/types.js";
import { DUEL_LIVE_IDLE_AFTER_MS, LIVE_EVENT_MAX_AGE_MS, listOnline, liveCounts } from "./admin-data.js";
import { DUEL_WAITING_IDLE_TIMEOUT_MS } from "@yugidraft/shared/duels";
import { NO_API_MENTIONS, PURPLE, clip } from "./common.js";

const POLL_MS = 60_000, MIN_EDIT_MS = 30_000, MAX_NAMES = 10;
type SavedStatus = { message_id: string; content_hash: string; updated_at: number };
type StatusMessage = { id: string; channel_id: string; author: { id: string } };

/** Only small presence/activity projections are read; never boards, decks or weekly stats. */
function statusEmbed(c: FeatureContext): APIEmbed {
  const now = Date.now(), guild = c.config.dataGuildId;
  const online = listOnline(c.db, now, guild), live = liveCounts(c.db, guild, now);
  // Heartbeats change query order and last_seen_at. Neither changes the displayed content.
  const users = online?.users.sort((a,b) => a.name.localeCompare(b.name) || a.userId-b.userId) ?? [];
  const names = users.slice(0, MAX_NAMES).map(user =>
    `${clip(escapeMarkdown(user.name.replace(/[\r\n]/g," ")),60)} — ${user.label}`);
  if (users.length > names.length) names.push(`+${users.length-names.length} more`);
  const boundedCount = (table: "tournaments" | "duel_series", filter: string, params: Record<string,string>) => {
    const { count } = c.db.prepare(`select count(*) as count from
      (select 1 from ${table} where guild_id=@guild and ${filter} limit 101)`).get({ guild, ...params }) as { count: number };
    return count > 100 ? "100+" : String(count);
  };
  const activeAfter = new Date(now-DUEL_LIVE_IDLE_AFTER_MS).toISOString();
  const seriesCount = boundedCount("duel_series", `(
    (status='active' and exists (
      select 1 from duels d where d.series_id=duel_series.id and d.guild_id=@guild and d.kind='play'
        and d.id=(select g.id from duels g where g.series_id=duel_series.id order by g.game_number desc,g.id desc limit 1)
        and d.status in ('active','lobby') and d.archived_at is null
        and case when json_valid(d.setup_json) then coalesce(json_extract(d.setup_json,'$.testDuel'),0) else 0 end=0
        and julianday(coalesce(d.last_activity_at,d.started_at,d.created_at)) >=
          julianday(case when d.status='active' then @activeAfter else @waitingAfter end)))
    or (status='between_games' and next_game_at is not null
      and julianday(next_game_at) between julianday(@activeAfter) and julianday(@nextBefore)))`,
  { activeAfter, waitingAfter: new Date(now-DUEL_WAITING_IDLE_TIMEOUT_MS).toISOString(),
    nextBefore: new Date(now+DUEL_LIVE_IDLE_AFTER_MS).toISOString() });
  return {
    title: "Dueling Domain • Online now", color: PURPLE,
    fields: [
      { name: online ? `Players online • ${online.count}${online.count === 500 ? "+" : ""}` : "Players online",
        value: online ? names.join("\n") || "No players seen in the last 2 minutes." : "presence not available" },
      { name: "Live duels", value: `1v1: ${live.duels["1v1"]}\nTag: ${live.duels.tag}\nFFA3: ${live.duels.ffa3}\nFFA4: ${live.duels.ffa4}`, inline: true },
      { name: "Active drafts", value: String(live.drafts.active), inline: true },
      { name: "Active tournaments", value: boundedCount("tournaments", "status='active' and julianday(coalesce(started_at,created_at)) >= julianday(@after)",
        { after: new Date(now-LIVE_EVENT_MAX_AGE_MS).toISOString() }), inline: true },
      { name: "Active series", value: seriesCount, inline: true },
    ],
    footer: { text: "Site presence: last 2 minutes • Up to 500 players / 100 live tables • Scheduled series breaks: ±10 min • Drafts/tournaments: 24h" },
  };
}

/** A single non-overlapping poller. Empty configuration adds no timer or Discord work. */
export function startStatusPublisher(c: FeatureContext) {
  const channelId = c.config.statusChannelId?.trim();
  if (!channelId) return;
  const saved = c.db.prepare("select message_id,content_hash,updated_at from discord_status_messages where guild_id=? and channel_id=?")
    .get(c.config.guildId,channelId) as SavedStatus | undefined;
  let messageId = saved?.message_id, hash = saved?.content_hash;
  let verified = false, createAttempted = false, stopped = false, warned = false;
  let nextWriteAt = (saved?.updated_at ?? 0) + MIN_EDIT_MS, retryAt = 0;
  let pending: Promise<void> | undefined;
  const nonce = randomBytes(12).toString("hex");
  const save = (contentHash: string) => {
    c.db.prepare(`insert into discord_status_messages(guild_id,channel_id,message_id,content_hash,updated_at) values(?,?,?,?,?)
      on conflict(guild_id,channel_id) do update set message_id=excluded.message_id,content_hash=excluded.content_hash,updated_at=excluded.updated_at`)
      .run(c.config.guildId,channelId,messageId,contentHash,Date.now());
    hash = contentHash;
    nextWriteAt = Date.now() + MIN_EDIT_MS;
  };
  const publish = async () => {
    if (Date.now() < retryAt) return;
    const embed = statusEmbed(c);
    // The relative timestamp describes the last content update, not the last poll.
    const contentHash = createHash("sha256").update(JSON.stringify(embed)).digest("hex");
    if (verified && (hash === contentHash || Date.now() < nextWriteAt)) return;
    if (!messageId && createAttempted) return;
    // No hidden write retries: every edit attempt observes our 30-second floor.
    // Short-lived REST handlers also leave no rate-limit sleeps behind on shutdown.
    const rest = new REST({ ...(c.config.restApi ? { api: c.config.restApi } : {}),
      timeout: 10_000, retries: 0, rejectOnRateLimit: () => true }).setToken(c.config.token);
    const signal = AbortSignal.any([c.signal, AbortSignal.timeout(30_000)]);
    try {
      const channel = await rest.get(Routes.channel(channelId), { signal }) as { guild_id?: string; type: number };
      if (channel.guild_id !== c.config.guildId || ![0,5].includes(channel.type)) {
        throw new Error("Status destination must be a text or announcement channel in the bot guild");
      }
      if (messageId && !verified) {
        let message: StatusMessage | undefined;
        try { message = await rest.get(Routes.channelMessage(channelId,messageId), { signal }) as StatusMessage; }
        catch (error) { if (!(error instanceof DiscordAPIError && error.code === 10008)) throw error; }
        // Only Unknown Message, or a response proving the saved target is invalid, permits replacement.
        if (!message || message.id !== messageId || message.channel_id !== channelId || message.author.id !== c.client.user?.id) {
          messageId = undefined; hash = undefined;
        }
      }
      verified = true;
      if (hash === contentHash || (messageId && Date.now() < nextWriteAt) || stopped || c.signal.aborted) return;
      const body = { embeds: [{ ...embed, description: `Updated <t:${Math.floor(Date.now()/1000)}:R>` }], allowed_mentions: NO_API_MENTIONS };
      // Drain started writes so a successful POST is persisted even during shutdown.
      const writeSignal = AbortSignal.timeout(15_000);
      if (messageId) {
        nextWriteAt = Date.now() + MIN_EDIT_MS;
        try { await rest.patch(Routes.channelMessage(channelId,messageId), { body, signal: writeSignal }); }
        catch (error) {
          if (error instanceof DiscordAPIError && error.code === 10008) {
            messageId = undefined; hash = undefined; verified = false;
          }
          throw error;
        }
      } else {
        if (createAttempted) return;
        createAttempted = true;
        try {
          const message = await rest.post(Routes.channelMessages(channelId), {
            body: { ...body, nonce, enforce_nonce: true }, signal: writeSignal,
          }) as StatusMessage;
          messageId = message.id;
        } catch (error) {
          // A definite rejection created nothing. Retry later; an ambiguous transport
          // failure consumes this start's one create attempt to avoid duplicate posts.
          if (error instanceof RateLimitError || (error instanceof DiscordAPIError && [400,401,403,404,429].includes(error.status))) createAttempted = false;
          throw error;
        }
      }
      save(contentHash);
    } finally { rest.clearHashSweeper(); rest.clearHandlerSweeper(); }
  };
  const tick = () => {
    if (stopped || c.signal.aborted) return;
    return pending ??= publish().catch(error => {
      if (c.signal.aborted || stopped) return;
      if (error instanceof RateLimitError) retryAt = Date.now() + Math.max(POLL_MS,error.retryAfter,error.timeToReset,error.sublimitTimeout);
      if (!warned) {
        warned = true;
        log("warn", "Online status unavailable; retrying on later polls", { operation: "bot.status", channelId });
        if (!(error instanceof DiscordAPIError || error instanceof RateLimitError) && !(error instanceof Error && error.message.startsWith("Status destination"))) {
          report(error, { tags: { operation: "bot.status" } });
        }
      }
    }).finally(() => { pending = undefined; });
  };
  const timer = setInterval(tick,POLL_MS);
  void tick();
  return async () => { stopped = true; clearInterval(timer); await pending; };
}
