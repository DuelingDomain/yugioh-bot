import { statSync } from "node:fs";
import { createPlayerService } from "@yugidraft/shared/services";
import updateHistory from "@/lib/card-data-history.json";
import { dataAsOf, newestUpdates, summarize } from "@/lib/card-data-status-model";
import { getDb } from "@/lib/db";
import { callDuelHost, callEngineDataStatus } from "@/lib/duel-host";
import { env } from "@/lib/env";
import { cachedLoader, ok, type SectionLoader } from "./section";
import type { SystemData } from "./types";

/** The worker writes its heartbeat every 30 s. Three minutes without one is a warning. */
export const WORKER_STALE_MS = 3 * 60_000;
const HOST_TIMEOUT_MS = 4_000;
const REPOSITORY = "DuelingDomain/yugioh-bot";
const STARTED_AT = Date.now() - Math.round(process.uptime() * 1000);

type CardData = NonNullable<SystemData["cardData"]>;

function lastUpdate(): CardData["lastUpdate"] {
  const newest = newestUpdates(updateHistory as Parameters<typeof newestUpdates>[0])[0];
  return newest ? { label: newest.label, date: newest.date, pullRequestNumber: newest.pullRequest.number, pullRequestUrl: newest.pullRequest.url } : null;
}

/** Bounded wait so a hung duel server cannot hold the poll. */
async function within<T>(work: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), ms); })]); }
  finally { clearTimeout(timer); }
}

async function failureDetail(response: Response): Promise<string> {
  try {
    const body = await response.clone().json() as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error.slice(0, 160);
  } catch {}
  return `The duel server answered with status ${response.status}.`;
}

/** Card data status asks GitHub through the duel server (cached there). Held for a minute here. */
let cardDataActor: { guildId: string; playerId: number } | null = null;
const cardDataStatus = cachedLoader<CardData>(60_000, async () => {
  const base = { lastUpdate: lastUpdate() };
  if (!cardDataActor) return ok({ state: "unknown", headline: "Card data status is unavailable.", ...base });
  const result = await within(callEngineDataStatus(cardDataActor), 6_000);
  if (result === "timeout" || !result.ok) return ok({ state: "unknown", headline: "The duel server could not report card data status.", ...base });
  const summary = summarize(result.data);
  return ok({ state: summary.state, headline: summary.headline, dataAsOf: dataAsOf(result.data), ...base });
});

async function duelServer(userId: number, db: ReturnType<typeof getDb>): Promise<{ health: SystemData["duelServer"]; actor: typeof cardDataActor }> {
  const activeTables = (db.prepare("select count(*) n from duels where kind = 'play' and status = 'active'").get() as { n: number }).n;
  if (!env.discordGuildId) return { health: { ok: false, detail: "DISCORD_GUILD_ID is not set, so the duel server cannot be asked.", latencyMs: null, activeTables }, actor: null };
  const user = db.prepare("select coalesce(display_name, username, 'Admin') name from users where id = ?").get(userId) as { name: string } | undefined;
  const player = createPlayerService(db).findOrCreate(env.discordGuildId, userId, user?.name ?? "Admin");
  const actor = { guildId: env.discordGuildId, playerId: player.id };
  const started = Date.now();
  const result = await within(callDuelHost({ op: "capabilities", ...actor }), HOST_TIMEOUT_MS);
  const latencyMs = Date.now() - started;
  if (result === "timeout") return { health: { ok: false, detail: "The duel server did not answer in 4 seconds.", latencyMs: null, activeTables }, actor: null };
  if (!result.ok) return { health: { ok: false, detail: await failureDetail(result.response), latencyMs: null, activeTables }, actor: null };
  return { health: { ok: true, detail: null, latencyMs, activeTables }, actor };
}

function fileSize(path: string): number {
  try { return statSync(path).size; } catch { return 0; }
}

function databaseSize(db: ReturnType<typeof getDb>): SystemData["database"] {
  const path = db.name;
  if (!path || path === ":memory:") return null;
  return { bytes: fileSize(path), walBytes: fileSize(`${path}-wal`) };
}

export const loadSystem: SectionLoader<"system"> = async ({ userId, now }) => {
  const db = getDb();
  const version = process.env.SENTRY_RELEASE?.trim() || null;
  const commit = version && /^[0-9a-f]{7,40}$/i.test(version) ? { short: version.slice(0, 7), url: `https://github.com/${REPOSITORY}/commit/${version}` } : null;

  let duel: SystemData["duelServer"];
  try {
    const found = await duelServer(userId, db);
    duel = found.health;
    cardDataActor = found.actor;
  } catch {
    duel = { ok: false, detail: "The duel server could not be checked.", latencyMs: null, activeTables: null };
    cardDataActor = null;
  }

  let cardData: SystemData["cardData"] = { state: "unknown", headline: "Card data status is unavailable.", lastUpdate: lastUpdate() };
  if (duel.ok) {
    const held = await cardDataStatus();
    if (held.state === "ok") cardData = held.data;
  } else cardData = { state: "unknown", headline: "The duel server did not answer, so card data age is unknown.", lastUpdate: lastUpdate() };

  let worker: SystemData["worker"] = { ok: false, lastTickAt: null, stale: true, pid: null };
  try {
    const row = db.prepare("select at, pid from worker_heartbeat where id = 1").get() as { at: number; pid: number | null } | undefined;
    if (row) worker = { ok: now - row.at <= WORKER_STALE_MS, lastTickAt: row.at, stale: now - row.at > WORKER_STALE_MS, pid: row.pid };
  } catch {}

  let database: SystemData["database"] = null;
  try { database = databaseSize(db); } catch {}

  return ok({ version, startedAt: STARTED_AT, cardData, duelServer: duel, worker, commit, database }, now);
};
