import { clientIpKey, createRateLimiter } from "./rate-limit";

/**
 * Send limits for the creator fast-track (plan section 8). Clerk allows 100 invitations per hour per instance; we keep
 * 80 for links, allowlist emails and resends together, and leave the rest for waitlist approvals.
 *
 * State lives on globalThis (Symbol.for key) so every route bundle in this process shares one budget. It is in memory:
 * correct for one web process (if we run more, move the counters to SQLite).
 *
 * Send counters are sliding logs of timestamps. A caller reserves sends BEFORE it claims a use or calls Clerk, and
 * releases them when no Clerk call was made (claim refused, live grant, invalid email).
 */
export const JOIN_POSTS_PER_IP = 5;
export const JOIN_POST_WINDOW_MS = 10 * 60_000;
export const SENDS_PER_LINK_PER_HOUR = 20;
export const SENDS_PER_HOUR = 80;
const HOUR_MS = 60 * 60_000;
const MAX_LINK_KEYS = 5_000;

interface SendLimitState {
  ipPosts: ReturnType<typeof createRateLimiter>;
  /** Shared hourly budget: one timestamp per reserved send, oldest first. */
  sends: number[];
  /** Per link code: one timestamp per reserved send, oldest first. */
  linkSends: Map<string, number[]>;
}

const KEY = Symbol.for("yugidraft.creatorSendLimit");
type Holder = { [KEY]?: SendLimitState };
function state(): SendLimitState {
  const holder = globalThis as Holder;
  return holder[KEY] ??= { ipPosts: createRateLimiter(JOIN_POST_WINDOW_MS), sends: [], linkSends: new Map() };
}

function prune(log: number[], now: number): void {
  let expired = 0;
  while (expired < log.length && log[expired]! + HOUR_MS <= now) expired++;
  if (expired) log.splice(0, expired);
}

/** Seconds until `log` has room for `n` more entries under `limit`, or null when they fit now. */
function waitFor(log: number[], limit: number, n: number, now: number): number | null {
  if (log.length + n <= limit) return null;
  if (n > limit) return Math.ceil(HOUR_MS / 1000);
  const freeAt = log[log.length + n - limit - 1]! + HOUR_MS;
  return Math.max(1, Math.ceil((freeAt - now) / 1000));
}

function dropNewest(log: number[], n: number): void {
  log.splice(Math.max(0, log.length - n), n);
}

function linkLog(s: SendLimitState, code: string, now: number): number[] {
  if (s.linkSends.size > MAX_LINK_KEYS) {
    for (const [key, log] of s.linkSends) {
      prune(log, now);
      if (log.length === 0) s.linkSends.delete(key);
    }
  }
  let log = s.linkSends.get(code);
  if (!log) { log = []; s.linkSends.set(code, log); }
  prune(log, now);
  return log;
}

/** Public join route: 5 posts per IP per 10 minutes. Counts every post. Returns retry seconds, or null to go on. */
export function takeJoinPost(request: Request, now = Date.now()): number | null {
  return state().ipPosts([[`join:${clientIpKey(request)}`, JOIN_POSTS_PER_IP]], now);
}

/**
 * Public join route: reserve one send for this link (20 per link per hour) and in the shared budget (80 per hour).
 * Nothing is reserved when a limit is hit. Returns retry seconds, or null when the send is reserved.
 */
export function reserveJoinSend(code: string, now = Date.now()): number | null {
  const s = state();
  prune(s.sends, now);
  const log = linkLog(s, code, now);
  const wait = Math.max(waitFor(log, SENDS_PER_LINK_PER_HOUR, 1, now) ?? 0, waitFor(s.sends, SENDS_PER_HOUR, 1, now) ?? 0);
  if (wait > 0) return wait;
  log.push(now);
  s.sends.push(now);
  return null;
}

/** Give back a send reserved by reserveJoinSend when no Clerk call was made. */
export function releaseJoinSend(code: string): void {
  const s = state();
  const log = s.linkSends.get(code);
  if (log) dropNewest(log, 1);
  dropNewest(s.sends, 1);
}

/**
 * Owner paths (allowlist emails, resend, waitlist re-send): reserve `n` sends at once in the shared budget. The whole
 * batch is refused when it does not fit. Returns retry seconds, or null when all `n` are reserved.
 */
export function reserveOwnerSends(n: number, now = Date.now()): number | null {
  const s = state();
  prune(s.sends, now);
  if (n <= 0) return null;
  const wait = waitFor(s.sends, SENDS_PER_HOUR, n, now);
  if (wait !== null) return wait;
  for (let i = 0; i < n; i++) s.sends.push(now);
  return null;
}

/** Give back `n` sends reserved by reserveOwnerSends that made no Clerk call. */
export function releaseOwnerSends(n: number): void {
  if (n > 0) dropNewest(state().sends, n);
}

/** Sends left in the shared hourly budget now. */
export function sendBudgetLeft(now = Date.now()): number {
  const s = state();
  prune(s.sends, now);
  return Math.max(0, SENDS_PER_HOUR - s.sends.length);
}
