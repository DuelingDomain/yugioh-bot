/**
 * Browser side of draft visibility: the invite link landing, the host's link controls and the visibility switch.
 * Every call uses the signed-in session; none of them reads the environment.
 */
import type { DraftVisibility } from "@yugidraft/shared/types";

export const INVITE_PARAM = "invite";

export type RedeemResult =
  | { kind: "ok" }
  /** The generic answer for a wrong, reset or unknown code, and for a draft that does not exist. */
  | { kind: "not-found" }
  /** Too many tries. `retryAfter` is the server's wait in seconds, when it sent one. Never retried automatically. */
  | { kind: "rate-limited"; retryAfter: number | null }
  | { kind: "unauthorized" }
  | { kind: "error" };

/** The `invite` query value of the current address, or null when there is none. */
export function readInviteParam(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(INVITE_PARAM);
}

/** Remove only the `invite` parameter. Other parameters and the hash stay; no navigation and no history entry. */
export function stripInviteParam(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(INVITE_PARAM)) return;
  url.searchParams.delete(INVITE_PARAM);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/** Where a signed-out user goes and comes back from: the address they are on, query and hash included. */
export function signInHref(): string {
  const here = typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return `/sign-in?redirect_url=${encodeURIComponent(here)}`;
}

function retryAfterSeconds(res: Response): number | null {
  const raw = res.headers?.get?.("Retry-After");
  if (raw == null) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

// Two mounts of the same landing (React strict mode in development) share one request, so a double mount is one try.
const inflight = new Map<string, Promise<RedeemResult>>();

/** POST /api/drafts/[slug]/invite. Gives the signed-in user read access; it does not take a seat. */
export function redeemDraftInvite(slug: string, code: string): Promise<RedeemResult> {
  const key = `${slug}\n${code}`;
  const held = inflight.get(key);
  if (held) return held;
  const run = (async (): Promise<RedeemResult> => {
    try {
      const res = await fetch(`/api/drafts/${encodeURIComponent(slug)}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (res.ok) return { kind: "ok" };
      if (res.status === 404) return { kind: "not-found" };
      if (res.status === 429) return { kind: "rate-limited", retryAfter: retryAfterSeconds(res) };
      if (res.status === 401) return { kind: "unauthorized" };
      return { kind: "error" };
    } catch {
      return { kind: "error" };
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

export class DraftInviteError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
  }
}

async function failure(res: Response, fallback: string): Promise<DraftInviteError> {
  const body = await res.json().catch(() => null);
  const message = typeof body?.error === "string" && body.error.trim() ? body.error : fallback;
  return new DraftInviteError(message, res.status);
}

async function linkFrom(res: Response, fallback: string): Promise<string> {
  if (!res.ok) throw await failure(res, fallback);
  const body = await res.json().catch(() => null);
  if (typeof body?.inviteUrl !== "string" || body.inviteUrl === "") throw new DraftInviteError(fallback, res.status);
  return body.inviteUrl;
}

/** GET /invite (host only): the current link. The server creates the code the first time. */
export async function fetchInviteUrl(slug: string): Promise<string> {
  const res = await fetch(`/api/drafts/${encodeURIComponent(slug)}/invite`, { cache: "no-store" });
  return linkFrom(res, "Couldn't get the invite link.");
}

/** POST /invite/reset (host only): a new link. The old one stops admitting new people; people already in keep access. */
export async function resetInviteUrl(slug: string): Promise<string> {
  const res = await fetch(`/api/drafts/${encodeURIComponent(slug)}/invite/reset`, { method: "POST" });
  return linkFrom(res, "Couldn't reset the invite link.");
}

/** PATCH /visibility (host only, pending drafts only). */
export async function patchVisibility(slug: string, visibility: DraftVisibility): Promise<DraftVisibility> {
  const res = await fetch(`/api/drafts/${encodeURIComponent(slug)}/visibility`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visibility }),
  });
  if (!res.ok) throw await failure(res, "Couldn't change who can join.");
  return visibility;
}

export const VISIBILITY_LABEL: Record<DraftVisibility, string> = { private: "Private", open: "Open" };

export const VISIBILITY_HELP: Record<DraftVisibility, string> = {
  private: "Only people with your invite link can see and join",
  open: "Listed in Open right now for everyone",
};
