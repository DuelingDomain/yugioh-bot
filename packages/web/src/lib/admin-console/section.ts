import { NextResponse } from "next/server";
import { isOwnerUser } from "@/lib/owner-access";
import { requireWebAccess } from "@/lib/web-access";
import type { SectionDataMap, SectionId, SectionResult } from "./types";

/** Result builders. Every loader returns one of these and never throws. */
export const ok = <T>(data: T, now = Date.now()): SectionResult<T> => ({ state: "ok", data, updatedAt: now });
export const notConfigured = (message: string, now = Date.now()): SectionResult<never> => ({ state: "not-configured", message, updatedAt: now });
export const failed = (message: string, now = Date.now()): SectionResult<never> => ({ state: "error", message, updatedAt: now });

export interface LoaderContext {
  /** Discord ID of the admin who asked. */
  userId: string;
  now: number;
}
export type SectionLoader<K extends SectionId> = (ctx: LoaderContext) => Promise<SectionResult<SectionDataMap[K]>>;

/** Small in-memory cache for slow external calls (Sentry, PostHog). Failures are cached for a shorter time. */
export function cachedLoader<T>(ttlMs: number, load: () => Promise<SectionResult<T>>, failureTtlMs = 10_000): () => Promise<SectionResult<T>> {
  let held: { at: number; result: SectionResult<T> } | null = null;
  let inflight: Promise<SectionResult<T>> | null = null;
  return async () => {
    const now = Date.now();
    if (held && now - held.at < (held.result.state === "ok" ? ttlMs : failureTtlMs)) return held.result;
    inflight ??= load().then((result) => { held = { at: Date.now(), result }; return result; }).finally(() => { inflight = null; });
    return inflight;
  };
}

const NO_STORE = { "cache-control": "private, no-store" };

/**
 * GET handler for /api/admin/console/<section>. 401 no session, 503 session unavailable, 404 for anyone who is
 * not in OWNER_USER_IDS (the page does not exist for them). A loader that throws becomes an "error" result
 * with a fixed message, so no detail leaks.
 */
export function sectionRoute<K extends SectionId>(loader: SectionLoader<K>) {
  return async function GET(): Promise<Response> {
    const actor = await requireWebAccess();
    if (!actor.ok) return actor.response;
    if (!isOwnerUser(actor.userId)) return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    let result: SectionResult<SectionDataMap[K]>;
    try { result = await loader({ userId: actor.userId, now: Date.now() }); }
    catch { result = failed("This section could not be loaded."); }
    return NextResponse.json(result, { headers: NO_STORE });
  };
}
