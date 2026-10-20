import { statSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { dirname } from "node:path";
import { createPlayerService } from "@yugidraft/shared/services";
import updateHistory from "@/lib/card-data-history.json";
import { dataAsOf, newestUpdates, summarize } from "@/lib/card-data-status-model";
import { getDb } from "@/lib/db";
import { callDuelHost, callEngineDataStatus } from "@/lib/duel-host";
import { env } from "@/lib/env";
import { cachedLoader, ok, type SectionLoader } from "./section";
import type { DiskBreakdown, DiskStatus, ServiceHealth, SystemData } from "./types";

/** The worker writes its heartbeat every 30 s. Three minutes without one is a warning. */
export const WORKER_STALE_MS = 3 * 60_000;
const HOST_TIMEOUT_MS = 4_000;
/** A duel server answer slower than this counts as stale. */
const SLOW_MS = 1_500;
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

async function duelServer(userId: string, db: ReturnType<typeof getDb>): Promise<{ health: SystemData["duelServer"]; actor: typeof cardDataActor }> {
  const activeTables = (db.prepare("select count(*) n from duels where kind = 'play' and status = 'active'").get() as { n: number }).n;
  if (!env.discordGuildId) return { health: { ok: false, detail: "DISCORD_GUILD_ID is not set, so the duel server cannot be asked.", latencyMs: null, activeTables }, actor: null };
  // Read-only lookup: a System poll must not take a write lock. An admin who never played has no player row, so the probe is skipped.
  const player = createPlayerService(db).findByGuildAndUser(env.discordGuildId, userId);
  if (!player) return { health: { ok: true, detail: "Not probed yet: this admin has no player profile in the guild.", latencyMs: null, activeTables }, actor: null };
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

const GIB = 1024 ** 3;
const DAY_MS = 86_400_000;

/** warn at 80 % used or under 10 GB free; fail at 90 % used or under 5 GB free. */
export function diskTone(usedPercent: number, freeBytes: number): DiskStatus["tone"] {
  if (usedPercent >= 90 || freeBytes < 5 * GIB) return "fail";
  if (usedPercent >= 80 || freeBytes < 10 * GIB) return "warn";
  return "ok";
}

function readBreakdown(db: ReturnType<typeof getDb>): DiskBreakdown | null {
  try {
    const row = db.prepare("select at, json from disk_usage_snapshot where id = 1").get() as { at: number; json: string } | undefined;
    if (!row) return null;
    const value = JSON.parse(row.json) as DiskBreakdown;
    if (!value || typeof value !== "object" || !value.database || !value.images || !value.other) return null;
    return { ...value, measuredAt: row.at };
  } catch { return null; }
}

/** Least-squares growth of used bytes over the history; null when it is short, flat or shrinking. */
function readTrend(db: ReturnType<typeof getDb>, now: number, freeBytes: number): DiskStatus["trend"] {
  try {
    const rows = db.prepare("select at, used_bytes used from disk_usage_history where at >= ? order by at").all(now - 7 * DAY_MS) as { at: number; used: number }[];
    if (rows.length === 0) return null;
    const step = Math.ceil(rows.length / 56);
    const values = rows.filter((_, i) => i % step === 0 || i === rows.length - 1).map((r) => r.used);
    let daysUntilFull: number | null = null;
    if (rows.length >= 12 && rows[rows.length - 1].at - rows[0].at >= 12 * 3_600_000) {
      const n = rows.length;
      const mx = rows.reduce((a, r) => a + r.at, 0) / n, my = rows.reduce((a, r) => a + r.used, 0) / n;
      const den = rows.reduce((a, r) => a + (r.at - mx) ** 2, 0);
      const slope = den > 0 ? rows.reduce((a, r) => a + (r.at - mx) * (r.used - my), 0) / den : 0; // bytes per ms
      if (slope > 0) {
        const days = freeBytes / (slope * DAY_MS);
        if (Number.isFinite(days) && days <= 365) daysUntilFull = Math.max(1, Math.round(days));
      }
    }
    return { values, daysUntilFull };
  } catch { return null; }
}

async function readDisk(db: ReturnType<typeof getDb>, now: number): Promise<DiskStatus | null> {
  const file = db.name && db.name !== ":memory:" ? db.name : process.env.DATABASE_PATH;
  if (!file) return null;
  try {
    const fs = await statfs(dirname(file));
    const totalBytes = fs.blocks * fs.bsize, usedBytes = (fs.blocks - fs.bfree) * fs.bsize, freeBytes = fs.bavail * fs.bsize;
    const base = usedBytes + freeBytes; // like df: the share a normal process can use
    const usedPercent = base > 0 ? Math.round((usedBytes / base) * 1000) / 10 : 0;
    return { totalBytes, usedBytes, freeBytes, usedPercent, tone: diskTone(usedPercent, freeBytes), breakdown: readBreakdown(db), trend: readTrend(db, now, freeBytes) };
  } catch { return null; }
}

function duration(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

async function wsHealth(): Promise<ServiceHealth> {
  const base = { id: "ws", label: "WS server" } as const;
  if (!env.wsInternalUrl) return { ...base, state: "not-configured", detail: "WS_INTERNAL_URL is not set." };
  const started = Date.now();
  try {
    const response = await fetch(new URL("/health", env.wsInternalUrl), { signal: AbortSignal.timeout(2_000), cache: "no-store" });
    const latencyMs = Date.now() - started;
    if (!response.ok) return { ...base, state: "down", detail: `The WS server answered with status ${response.status}.`, latencyMs: null };
    const body = await response.json() as { ok?: unknown; uptime?: unknown; connections?: unknown };
    if (body.ok !== true) return { ...base, state: "down", detail: "The WS server did not report healthy.", latencyMs: null };
    const connections = typeof body.connections === "number" ? body.connections : null;
    const uptime = typeof body.uptime === "number" ? `Up ${duration(body.uptime)}` : null;
    return { ...base, state: "up", latencyMs, detail: [connections !== null ? `${connections} ${connections === 1 ? "connection" : "connections"}` : null, uptime].filter(Boolean).join(". ") || "Healthy." };
  } catch {
    return { ...base, state: "down", detail: "The WS server did not answer in 2 seconds.", latencyMs: null };
  }
}

/** A bot heartbeat table may not exist yet (another branch adds the bot). A missing table means "not deployed". */
function botHealth(db: ReturnType<typeof getDb>, now: number): ServiceHealth {
  const base = { id: "bot", label: "Discord bot" } as const;
  try {
    const table = db.prepare("select 1 from sqlite_master where type = 'table' and name = 'bot_heartbeat'").get();
    if (!table) return { ...base, state: "not-deployed", detail: "Not deployed." };
    const row = db.prepare("select max(at) at from bot_heartbeat").get() as { at: number | null };
    if (row.at === null) return { ...base, state: "stale", detail: "No heartbeat yet.", lastBeatAt: null };
    const stale = now - row.at > WORKER_STALE_MS;
    return { ...base, state: stale ? "stale" : "up", lastBeatAt: row.at, detail: stale ? "No heartbeat for over 3 minutes." : "Alive." };
  } catch { return { ...base, state: "not-deployed", detail: "Not deployed." }; }
}

function databaseHealth(db: ReturnType<typeof getDb>, size: SystemData["database"]): ServiceHealth {
  const base = { id: "database", label: "Database" } as const;
  const started = performance.now();
  try {
    db.prepare("select 1").get();
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    return { ...base, state: "up", latencyMs, detail: size ? "Answering queries." : "Answering queries (in memory)." };
  } catch { return { ...base, state: "down", detail: "A test query failed.", latencyMs: null }; }
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

  const [ws, disk] = await Promise.all([wsHealth(), readDisk(db, now)]);
  const services: ServiceHealth[] = [
    { id: "web", label: "Web", state: "up", detail: `Up ${duration((now - STARTED_AT) / 1000)}.`, latencyMs: null },
    { id: "duel", label: "Duel server", state: duel.ok ? ((duel.latencyMs ?? 0) > SLOW_MS ? "stale" : "up") : "down", latencyMs: duel.latencyMs ?? null,
      detail: duel.ok ? (duel.detail ?? `${duel.activeTables ?? 0} active ${duel.activeTables === 1 ? "table" : "tables"}${(duel.latencyMs ?? 0) > SLOW_MS ? ". Slow answer" : ""}.`) : duel.detail ?? "Not reachable." },
    { id: "worker", label: "Worker", state: worker.lastTickAt === null ? "down" : worker.ok ? "up" : "stale", lastBeatAt: worker.lastTickAt,
      detail: worker.lastTickAt === null ? "No heartbeat yet. The worker has not run against this database." : worker.ok ? "Alive." : "No heartbeat for over 3 minutes. The worker may be down." },
    ws,
    botHealth(db, now),
    databaseHealth(db, database),
  ];
  const problems = services.filter((service) => service.state === "down" || service.state === "stale").length + (disk && disk.tone !== "ok" ? 1 : 0);

  return ok({ version, startedAt: STARTED_AT, cardData, duelServer: duel, worker, commit, database, services, problems, disk }, now);
};
