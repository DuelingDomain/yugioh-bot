// Test recording of the table camera (REMOTE_RECORD_USERS only): the player's own camera video is appended to one file per
// recording, with a JSON sidecar, for offline recognition tests. Every file name is derived here from server-checked values;
// no client text ever becomes part of a path.
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, open, readdir, rm, rmdir, stat, statfs, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { log } from "@yugidraft/shared/observability";
import { RemoteDuelError } from "@yugidraft/shared/remote";
import { resolveDbPath } from "../db";

const GiB = 1024 ** 3;
/** One chunk (10 s of video at 2 Mbps is about 2.5 MB). */
export const RECORDING_CHUNK_MAX_BYTES = 8 * 1024 * 1024;
/** One recording; at 2 Mbps this is about 2.3 hours. The client then starts a new file. */
export const RECORDING_FILE_MAX_BYTES = 2 * GiB;
const minFreeBytes = () => { const v = process.env.REMOTE_RECORDINGS_MIN_FREE_BYTES?.trim(); return v && /^\d+$/.test(v) ? Number(v) : 3 * GiB; };
const IDLE_MS = 15 * 60_000;
const MAX_ACTIVE = 8;
const SWEEP_EVERY = 12;
const EXTENSIONS: Record<string, string> = { "video/webm": "webm", "video/mp4": "mp4" };

export const recordingsDir = () => process.env.REMOTE_RECORDINGS_DIR?.trim() || join(dirname(resolveDbPath()), "remote-recordings");
export const recordingsMaxBytes = () => {
  const value = process.env.REMOTE_RECORDINGS_MAX_BYTES?.trim();
  return value && /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : 6 * GiB;
};

type Sidecar = Record<string, unknown>;
type Active = { id: string; userId: number; slug: string; seat: number; base: string; dir: string; video: string; sidecar: Sidecar; sidecarPath: string;
  next: number; chunks: number; dropped: number; bytes: number; lastAt: number; queue: Promise<unknown> };
const store = globalThis as unknown as { __remoteRecordings?: Map<string, Active> };
const active = (store.__remoteRecordings ??= new Map<string, Active>());

const fail = (status: number, code: string, message: string): never => { throw new RemoteDuelError(message, status, code); };
const text = (value: unknown, max: number) => typeof value === "string" && value.length <= max ? value : undefined;
const number = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
const bool = (value: unknown) => (typeof value === "boolean" ? value : null);

/** One clock sample per chunk (10 s each): a 2 GiB file holds about 830 chunks, so this cap is never reached in practice; it only bounds the sidecar. */
const MAX_CLOCK_SAMPLES = 1000;
/** Calibration snapshots: the one at the start and each later change. The first is kept; the oldest of the rest is dropped. */
const MAX_CALIBRATIONS = 20;
const MAX_CALIBRATION_BYTES = 4096;
const PLAYER_SIDES = new Set(["bottom", "left", "top", "right"]);
const ZONE_ID = /^[A-Z][A-Z0-9]{0,5}$/;
const point = (value: unknown) => {
  const p = value as Record<string, unknown> | null | undefined, x = number(p?.x, -5, 5), y = number(p?.y, -5, 5);
  return x === undefined || y === undefined ? null : { x, y };
};
/**
 * The live field calibration of the recorded player (mat corners, orientation, zone spacing, moved zones, format), so the offline tool reads the
 * mat the way the watcher did. Only known fields with checked types survive, and the result is capped; anything else returns null.
 */
export function sanitizeCalibration(raw: unknown, now: number) {
  const body = raw as Record<string, unknown> | null | undefined, cal = body?.calibration as Record<string, unknown> | null | undefined;
  if (!body || typeof body !== "object" || !cal || typeof cal !== "object" || !Array.isArray(cal.corners) || cal.corners.length < 4 || cal.corners.length > 8) return null;
  const corners = cal.corners.map(point); if (corners.some(c => !c)) return null;
  const orientation = cal.orientation as Record<string, unknown> | undefined;
  const zones: Record<string, unknown> = {};
  if (cal.zones && typeof cal.zones === "object") for (const [id, rect] of Object.entries(cal.zones).slice(0, 24)) {
    const r = rect as Record<string, unknown>, x = number(r?.x, -5, 5), y = number(r?.y, -5, 5), w = number(r?.w, 0, 5), h = number(r?.h, 0, 5);
    if (ZONE_ID.test(id) && x !== undefined && y !== undefined && w !== undefined && h !== undefined) zones[id] = { x, y, w, h };
  }
  const entry = { at: number(body.at, 0, 1e15) ?? null, serverMs: now, format: text(body.format, 24) ?? null, placed: bool(body.placed), needed: bool(body.needed),
    calibration: { version: number(cal.version, 0, 99) ?? null, layout: number(cal.layout, 0, 99) ?? null, corners,
      orientation: orientation && typeof orientation.playerSide === "string" && PLAYER_SIDES.has(orientation.playerSide) ? { playerSide: orientation.playerSide, mirrored: orientation.mirrored === true } : null,
      zoneSpacing: number(cal.zoneSpacing, 0, 5) ?? null, zones } };
  return JSON.stringify(entry).length <= MAX_CALIBRATION_BYTES ? entry : null;
}
const calibrationKey = (entry: object) => JSON.stringify({ ...entry, at: 0, serverMs: 0 }); // a repeat of the last snapshot adds nothing
function addCalibration(a: Active, entry: NonNullable<ReturnType<typeof sanitizeCalibration>>) {
  const list = a.sidecar.calibrations as object[], last = list.at(-1);
  if (last && calibrationKey(last) === calibrationKey(entry)) return;
  list.push(entry);
  if (list.length > MAX_CALIBRATIONS) list.splice(1, 1);
}

/** Reads the request body as bytes and stops at the chunk cap, so a large or never-ending body cannot fill memory. */
export async function readChunkBytes(request: Request): Promise<Buffer> {
  if (Number(request.headers.get("content-length")) > RECORDING_CHUNK_MAX_BYTES) fail(413, "CHUNK_TOO_LARGE", "Chunk is too large");
  const reader = request.body?.getReader(); const parts: Uint8Array[] = []; let size = 0;
  if (!reader) return Buffer.alloc(0);
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > RECORDING_CHUNK_MAX_BYTES) { await reader.cancel(); fail(413, "CHUNK_TOO_LARGE", "Chunk is too large"); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts);
}

async function freeBytes(dir: string) { const fs = await statfs(dir); return Number(fs.bavail) * Number(fs.bsize); }
async function writeSidecar(a: Active) {
  Object.assign(a.sidecar, { chunks: a.chunks, droppedChunks: a.dropped, bytes: a.bytes, lastChunkAt: new Date(a.lastAt).toISOString() });
  await writeFile(a.sidecarPath, JSON.stringify(a.sidecar, null, 2));
}

const SLUG_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
/** The only file names this module writes: `<userId>-<seat>-<start time>.<ext>` and its `.json` sidecar. */
const FILE_PATTERN = /^\d+-\d+-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z\.(webm|mp4|json)$/;

/**
 * Deletes the oldest finished recordings (video and sidecar together) until the folder is under the cap. Active files stay.
 * It touches only table folders and files with the names this module writes, so a wrong REMOTE_RECORDINGS_DIR cannot delete other data.
 */
export async function enforceRecordingsCap(root = recordingsDir(), max = recordingsMaxBytes()) {
  const keep = new Set([...active.values()].map(a => a.video));
  const groups = new Map<string, { files: string[]; size: number; time: number; busy: boolean }>();
  let total = 0;
  for (const table of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!table.isDirectory() || !SLUG_PATTERN.test(table.name)) continue;
    for (const name of await readdir(join(root, table.name)).catch(() => [] as string[])) {
      if (!FILE_PATTERN.test(name)) continue;
      const path = join(root, table.name, name), info = await stat(path).catch(() => null); if (!info?.isFile()) continue;
      const key = join(root, table.name, name.replace(/\.[^.]+$/, "")), group = groups.get(key) ?? { files: [], size: 0, time: 0, busy: false };
      group.files.push(path); group.size += info.size; group.time = Math.max(group.time, info.mtimeMs); group.busy ||= keep.has(path);
      groups.set(key, group); total += info.size;
    }
  }
  for (const group of [...groups.values()].filter(g => !g.busy).sort((a, b) => a.time - b.time)) {
    if (total <= max) break;
    await Promise.all(group.files.map(path => rm(path, { force: true }))); total -= group.size;
  }
  for (const table of (await readdir(root).catch(() => [] as string[])).filter(name => SLUG_PATTERN.test(name))) await rmdir(join(root, table)).catch(() => undefined); // only an empty folder is removed
  return total;
}

/** Opens a recording for a seated player. `body` is the client's JSON; only known fields are kept, with their types checked. */
async function startInner(input: { userId: number; slug: string; seat: number; userAgent: string | null; body: Record<string, unknown> }) {
  const { userId, slug, seat, body } = input;
  // The slug comes from the database, but it becomes a folder name here, so it is checked again.
  if (!SLUG_PATTERN.test(slug)) fail(400, "BAD_SLUG", "Invalid table");
  const mime = text(body.mime, 120)?.split(";")[0].trim().toLowerCase() ?? "", ext = EXTENSIONS[mime];
  if (!ext) fail(415, "BAD_MIME", "Unsupported video type");
  const width = number(body.width, 1, 16384), height = number(body.height, 1, 16384);
  if (!width || !height) fail(400, "BAD_SIZE", "Invalid video size");
  const now = Date.now();
  for (const old of [...active.values()]) if (now - old.lastAt > IDLE_MS || (old.userId === userId && old.slug === slug)) await finish(old, old.userId === userId && old.slug === slug ? "replaced" : "idle");
  if (active.size >= MAX_ACTIVE) fail(503, "BUSY", "Too many recordings");
  const root = recordingsDir(), dir = join(root, slug);
  if (resolve(root) === resolve(dirname(resolveDbPath()))) fail(503, "RECORDING_UNAVAILABLE", "Recording folder is not valid");
  await mkdir(root, { recursive: true });
  await enforceRecordingsCap(root); // before this table's folder exists: the sweep removes empty folders
  await mkdir(dir, { recursive: true });
  if (await freeBytes(dir) < minFreeBytes()) fail(507, "DISK_LOW", "Not enough free disk space");
  const startedAt = new Date(now).toISOString(), base = `${userId}-${seat}-${startedAt.replace(/[:.]/g, "-")}`, video = join(dir, `${base}.${ext}`);
  await (await open(video, "wx").catch(() => fail(409, "EXISTS", "Recording exists"))).close();
  const clock = body.clock as Record<string, unknown> | undefined;
  const sidecar: Sidecar = {
    version: 1, tableSlug: slug, userId, seat, startedAt, serverStartMs: now, file: `${base}.${ext}`, mime: text(body.mime, 120), ext,
    video: { width, height, fps: number(body.fps, 0, 240) ?? null, bitsPerSecond: number(body.bitsPerSecond, 0, 1e8) ?? null, scaled: body.scaled === true },
    // `recorderStartDateNow` is the clock when the start request was sent, for debugging only. Video time 0 is `videoStartDateNow` / `videoStartPerfNow`,
    // which the browser sends with chunk 0 (taken when the recorder started).
    client: { recorderStartDateNow: number(clock?.recorderStartDateNow, 0, 1e15) ?? null, recorderStartPerfNow: number(clock?.recorderStartPerfNow, 0, 1e12) ?? null,
      timeOrigin: number(clock?.timeOrigin, 0, 1e15) ?? null, userAgent: input.userAgent?.slice(0, 300) ?? null, appVersion: text(body.appVersion, 64) ?? null,
      backend: text(body.backend, 40) ?? null, hardwareConcurrency: number(body.hardwareConcurrency, 0, 1024) ?? null,
      // One sample per chunk: { n, serverMs (when the server got the chunk), offsetMs (server clock minus client clock), rttMs }, so drift can be corrected.
      clockSamples: [] as unknown[] },
    // The live calibration at the start and after each change (see sanitizeCalibration).
    calibrations: [] as unknown[],
    server: { appVersion: process.env.SENTRY_RELEASE?.trim() || null },
  };
  const a: Active = { id: randomBytes(12).toString("hex"), userId, slug, seat, base, dir, video, sidecar, sidecarPath: join(dir, `${base}.json`), next: 0, chunks: 0, dropped: 0, bytes: 0, lastAt: now, queue: Promise.resolve() };
  active.set(a.id, a);
  const first = sanitizeCalibration(body.calibration, now); if (first) addCalibration(a, first); // a bad snapshot never stops the recording
  await writeSidecar(a);
  return { id: a.id, serverTime: now, chunkMaxBytes: RECORDING_CHUNK_MAX_BYTES };
}

/** Plain file system errors (a folder that cannot be written) become one quiet 503, not a 500 that goes to Sentry on every retry. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    if (error instanceof RemoteDuelError) throw error;
    log("warn", "Recording storage failed", { error: error instanceof Error ? error.message : String(error) });
    return fail(503, "RECORDING_UNAVAILABLE", "Recording is unavailable");
  }
}
export const startRecording = (input: Parameters<typeof startInner>[0]) => guarded(() => startInner(input));

function owned(id: string, userId: number, seat: number, slug: string) {
  const a = /^[0-9a-f]{24}$/.test(id) ? active.get(id) : undefined;
  if (!a) return fail(404, "UNKNOWN_RECORDING", "Unknown recording");
  if (a.userId !== userId || a.seat !== seat || a.slug !== slug) return fail(403, "NOT_YOURS", "Not your recording");
  return a;
}

/** The cheap order checks. The route runs them before it reads the body; appendChunk runs them again inside the write queue. */
function checkSeq(a: Active, seq: number): "duplicate" | "ok" {
  if (!Number.isSafeInteger(seq) || seq < 0) fail(400, "BAD_SEQ", "Invalid sequence");
  if (seq < a.next) return "duplicate";
  if (a.next === 0 && seq > 0) fail(409, "NO_HEADER", "The first chunk holds the video header");
  return "ok";
}
export function precheckChunk(input: { id: string; userId: number; seat: number; slug: string; seq: number }) {
  return checkSeq(owned(input.id, input.userId, input.seat, input.slug), input.seq);
}

/** Appends chunk `seq`. Chunks arrive in order; a gap (the client dropped chunks under load) is counted, a repeat is ignored. */
export const appendChunk = (input: { id: string; userId: number; seat: number; slug: string; seq: number; bytes: Buffer; clockOffsetMs?: number; rttMs?: number; startDateNow?: number; startPerfNow?: number }) => guarded(async () => {
  const a = owned(input.id, input.userId, input.seat, input.slug), { seq, bytes } = input;
  if (checkSeq(a, seq) === "duplicate") return { ok: true, duplicate: true };
  if (!bytes.length) fail(400, "EMPTY", "Empty chunk");
  if (a.bytes + bytes.length > RECORDING_FILE_MAX_BYTES) fail(413, "RECORDING_TOO_LARGE", "Recording is too large");
  if (await freeBytes(a.dir) < minFreeBytes()) fail(507, "DISK_LOW", "Not enough free disk space");
  const now = Date.now(), previous = a.queue;
  const write = previous.catch(() => undefined).then(async () => {
    // Two requests with the same number can both pass the first check: decide again, in order.
    if (checkSeq(a, seq) === "duplicate") return { ok: true, duplicate: true };
    await appendFile(a.video, bytes);
    a.dropped += seq - a.next; a.next = seq + 1; a.chunks += 1; a.bytes += bytes.length; a.lastAt = now;
    if (seq === 0) Object.assign(a.sidecar, { firstChunkAt: new Date(now).toISOString(), firstChunkServerMs: now,
      client: { ...(a.sidecar.client as object), clockOffsetMs: number(input.clockOffsetMs, -1e10, 1e10) ?? null, rttMs: number(input.rttMs, 0, 1e7) ?? null,
        videoStartDateNow: number(input.startDateNow, 0, 1e15) ?? null, videoStartPerfNow: number(input.startPerfNow, 0, 1e12) ?? null } });
    const offsetMs = number(input.clockOffsetMs, -1e10, 1e10), rttMs = number(input.rttMs, 0, 1e7), samples = (a.sidecar.client as { clockSamples: unknown[] }).clockSamples;
    if (offsetMs !== undefined && rttMs !== undefined && samples.length < MAX_CLOCK_SAMPLES) samples.push({ n: seq, serverMs: now, offsetMs, rttMs });
    await writeSidecar(a); // a few KB: a closed tab then still leaves the right counts
    if (a.chunks % SWEEP_EVERY === 0) await enforceRecordingsCap(dirname(a.dir)).catch(() => undefined);
    return { ok: true };
  });
  a.queue = write; return write;
});

/** A tiny round trip the browser times before each chunk, so every chunk carries a fresh clock sample (the chunk upload itself is too slow to time). */
export function clockRecording(input: { id: string; userId: number; seat: number; slug: string }) {
  owned(input.id, input.userId, input.seat, input.slug);
  return { ok: true, serverTime: Date.now() };
}

/** Adds a calibration snapshot (the live calibration changed). Invalid or oversized input is refused; the recording goes on. */
export const noteCalibration = (input: { id: string; userId: number; seat: number; slug: string; body: Record<string, unknown> }) => guarded(async () => {
  const a = owned(input.id, input.userId, input.seat, input.slug), entry = sanitizeCalibration(input.body, Date.now());
  if (!entry) return fail(400, "BAD_CALIBRATION", "Invalid calibration");
  const write = a.queue.catch(() => undefined).then(async () => { addCalibration(a, entry); await writeSidecar(a); return { ok: true }; });
  a.queue = write; return write;
});

async function finish(a: Active, reason: string, extra: Sidecar = {}) {
  active.delete(a.id);
  await a.queue.catch(() => undefined);
  Object.assign(a.sidecar, { endedAt: new Date().toISOString(), endReason: reason, ...extra });
  await writeSidecar(a).catch(error => log("warn", "Recording sidecar not written", { error: error instanceof Error ? error.message : String(error) }));
}
export async function endRecording(input: { id: string; userId: number; seat: number; slug: string; body: Record<string, unknown> }) {
  const a = owned(input.id, input.userId, input.seat, input.slug);
  await finish(a, text(input.body.reason, 40) ?? "client", { endBackend: text(input.body.backend, 40) ?? null });
  return { ok: true, chunks: a.chunks, bytes: a.bytes };
}
