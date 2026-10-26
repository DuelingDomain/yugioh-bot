import { NextResponse } from "next/server";
import { log } from "@yugidraft/shared/observability";
import { CreatorAccessError, createCreatorAccessService, type CreatorAccessService } from "@yugidraft/shared/services/creator-access";
import { getDb } from "@/lib/db";
import { sendBudgetLeft } from "@/lib/creator-send-limit";
import { webOrigin } from "@/lib/existing-player";
import { isOwnerUser } from "@/lib/owner-access";
import { readSmallJsonObject } from "@/lib/read-small-body";
import { requireWebAccess } from "@/lib/web-access";
import { ok, type SectionLoader } from "./section";
import { easternDayStart } from "./time";
import type { BusyResponse } from "./creators-types";

/** Owner bodies: 20 emails or 1000-char notes fit with room to spare. */
const MAX_OWNER_BODY_BYTES = 16 * 1024;
const NO_STORE = { "cache-control": "private, no-store" };

export const creatorAccess = (): CreatorAccessService => createCreatorAccessService(getDb());

/** Section "creators". "Today" is Eastern time: it starts at 00:00 ET. An old client's `?start=` is ignored. */
export const loadCreators: SectionLoader<"creators"> = async ({ now }) => {
  const since = easternDayStart(now);
  const service = creatorAccess();
  return ok({ creators: service.listCreators({ since }), signUpsToday: service.creatorSignUpsSince(since), sendBudgetLeft: sendBudgetLeft(now) }, now);
};

export const ownerJson = (body: unknown, status = 200): NextResponse => NextResponse.json(body, { status, headers: NO_STORE });

export function busyResponse(retryAfterSeconds: number): NextResponse {
  const body: BusyResponse = { error: "busy", retryAfterSeconds };
  return NextResponse.json(body, { status: 429, headers: { ...NO_STORE, "retry-after": String(retryAfterSeconds) } });
}

/** Positive safe integer from a route segment, else null (the route answers 400 invalid_id). */
export function parseId(raw: string): number | null {
  if (!/^[1-9][0-9]{0,15}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/** Absolute join URL for a link code: `${WEB_URL}/join/<code>` (relative when WEB_URL is not set). */
export function joinUrl(code: string): string {
  let origin = "";
  try { origin = webOrigin(); } catch { /* WEB_URL missing: the UI still gets a usable path. */ }
  return `${origin}/join/${code}`;
}

/** CreatorAccessError -> { error: code } with its status. Anything else -> 500 with a fixed log line and no detail. */
export function creatorErrorResponse(error: unknown, route: string): NextResponse {
  if (error instanceof CreatorAccessError) return ownerJson({ error: error.code }, error.status);
  log("error", "[admin-creators] request failed", { route });
  return ownerJson({ error: "server_error" }, 500);
}

export type OwnerGuard = { ok: true; userId: number } | { ok: false; response: Response };

/** Owner read guard: signed in (401/503), in OWNER_USER_IDS (else 404 not_found). */
export async function requireOwner(): Promise<OwnerGuard> {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor;
  if (!isOwnerUser(actor.userId)) return { ok: false, response: ownerJson({ error: "not_found" }, 404) };
  return { ok: true, userId: actor.userId };
}

export type OwnerMutation = { ok: true; userId: number; body: Record<string, unknown> } | { ok: false; response: Response };

/**
 * Owner mutation guard: requireOwner, then Origin === webOrigin() (else 403 invalid_origin). With `body: true` it also
 * reads a JSON object under 16 KB (else 400 invalid_body); without, the body is ignored and `{}` is returned.
 */
export async function requireOwnerMutation(request: Request, opts: { body: boolean }): Promise<OwnerMutation> {
  const owner = await requireOwner();
  if (!owner.ok) return owner;
  let origin: string | null = null;
  try { origin = webOrigin(); } catch { /* WEB_URL missing: refuse below. */ }
  if (!origin || request.headers.get("origin") !== origin) return { ok: false, response: ownerJson({ error: "invalid_origin" }, 403) };
  if (!opts.body) return { ok: true, userId: owner.userId, body: {} };
  const body = await readSmallJsonObject(request, MAX_OWNER_BODY_BYTES);
  if (!body) return { ok: false, response: ownerJson({ error: "invalid_body" }, 400) };
  return { ok: true, userId: owner.userId, body };
}

/** True for an absent, null or string field (the service checks lengths and formats). */
export const isOptionalText = (value: unknown): value is string | null | undefined =>
  value === undefined || value === null || typeof value === "string";
