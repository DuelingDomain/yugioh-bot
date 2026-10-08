/**
 * Browser side of invite links, for drafts and tournaments: the `?invite=` landing, the host's link controls and the
 * visibility switch. The two kinds share one wire shape and differ only by the base path, so one factory builds both
 * clients. Every call uses the signed-in session; none of them reads the environment.
 */
import type { DraftVisibility, TournamentVisibility } from "@yugidraft/shared/types";

export const INVITE_PARAM = "invite";

/** Drafts and tournaments use the same two values. */
export type Visibility = DraftVisibility & TournamentVisibility;

export type RedeemResult =
  | { kind: "ok" }
  /** The generic answer for a wrong, reset or unknown code, and for an event that does not exist. */
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

export class InviteError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
  }
}

async function failure(res: Response, fallback: string): Promise<InviteError> {
  const body = await res.json().catch(() => null);
  const message = typeof body?.error === "string" && body.error.trim() ? body.error : fallback;
  return new InviteError(message, res.status);
}

async function linkFrom(res: Response, fallback: string): Promise<string> {
  if (!res.ok) throw await failure(res, fallback);
  const body = await res.json().catch(() => null);
  if (typeof body?.inviteUrl !== "string" || body.inviteUrl === "") throw new InviteError(fallback, res.status);
  return body.inviteUrl;
}

/** What a draft or tournament offers for invite links. `slug` is the web slug in the address. */
export interface InviteApi {
  /** POST /invite. Gives the signed-in user read access; it does not take a seat. */
  redeem(slug: string, code: string): Promise<RedeemResult>;
  /** GET /invite (host only): the current link. The server creates the code the first time. */
  fetchUrl(slug: string): Promise<string>;
  /** POST /invite/reset (host only): a new link. The old one stops admitting new people; people already in keep access. */
  resetUrl(slug: string): Promise<string>;
  /** PATCH /visibility (host only, pending only). */
  patchVisibility(slug: string, visibility: Visibility): Promise<Visibility>;
}

/** Build the client for `${base}/[slug]/invite`, `/invite/reset` and `/visibility`. */
export function createInviteApi(base: "/api/drafts" | "/api/tournaments"): InviteApi {
  const at = (slug: string) => `${base}/${encodeURIComponent(slug)}`;
  // Two mounts of the same landing (React strict mode in development) share one request, so a double mount is one try.
  const inflight = new Map<string, Promise<RedeemResult>>();

  return {
    redeem(slug, code) {
      const key = `${slug}\n${code}`;
      const held = inflight.get(key);
      if (held) return held;
      const run = (async (): Promise<RedeemResult> => {
        try {
          const res = await fetch(`${at(slug)}/invite`, {
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
    },
    async fetchUrl(slug) {
      const res = await fetch(`${at(slug)}/invite`, { cache: "no-store" });
      return linkFrom(res, "Couldn't get the invite link.");
    },
    async resetUrl(slug) {
      const res = await fetch(`${at(slug)}/invite/reset`, { method: "POST" });
      return linkFrom(res, "Couldn't reset the invite link.");
    },
    async patchVisibility(slug, visibility) {
      const res = await fetch(`${at(slug)}/visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility }),
      });
      if (!res.ok) throw await failure(res, "Couldn't change who can join.");
      return visibility;
    },
  };
}

export const draftInviteApi = createInviteApi("/api/drafts");
export const tournamentInviteApi = createInviteApi("/api/tournaments");

export const VISIBILITY_LABEL: Record<Visibility, string> = { private: "Private", open: "Open" };

export const VISIBILITY_HELP: Record<Visibility, string> = {
  private: "Only people with your invite link can see and join",
  open: "Listed in Open right now for everyone",
};
