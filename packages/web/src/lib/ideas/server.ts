import { NextResponse } from "next/server";
import { createIdeaService } from "@yugidraft/shared/services";
import { ExpectedError, errorResponseBody } from "@yugidraft/shared/observability";
import { getDb } from "@/lib/db";
import { webOrigin } from "@/lib/existing-player";
import { isOwnerUser } from "@/lib/owner-access";
import { readSmallJsonObject } from "@/lib/read-small-body";
import { requireWebAccess } from "@/lib/web-access";

const PRIVATE_HEADERS = { "cache-control": "private, no-store" };
const MAX_BODY_BYTES = 16 * 1024;

export const ideaService = () => createIdeaService(getDb());
export const ideasJson = (body: unknown, status = 200): Response => NextResponse.json(body, { status, headers: PRIVATE_HEADERS });

/** Every Ideas response, including auth/owner failures, carries the same private cache policy. */
export async function withIdeasAccess(
  action: (userId: number) => Response | Promise<Response>,
  options: { owner?: boolean; request?: Request } = {},
): Promise<Response> {
  const actor = await requireWebAccess();
  if (!actor.ok) {
    actor.response.headers.set("cache-control", "private, no-store");
    return actor.response;
  }
  try {
    if (options.owner) {
      if (!isOwnerUser(actor.userId)) throw new ExpectedError("not_found", 404);
      if (options.request) {
        let origin: string | null = null;
        try { origin = webOrigin(); } catch { /* Invalid or absent WEB_URL refuses owner mutations. */ }
        if (!origin || options.request.headers.get("origin") !== origin) throw new ExpectedError("invalid_origin", 403);
      }
    }
    return await action(actor.userId);
  } catch (error) {
    const result = errorResponseBody(error, { userId: actor.userId, tags: { route: "ideas" } });
    return ideasJson(result.body, result.status);
  }
}

/** Canonical positive safe IDs prevent parseInt coercion and precision loss. */
export function ideaId(raw: string): number {
  if (!/^[1-9][0-9]*$/.test(raw)) throw new ExpectedError("invalid_id", 400);
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) throw new ExpectedError("invalid_id", 400);
  return id;
}

export async function readIdeaBody(request: Request): Promise<Record<string, unknown>> {
  const body = await readSmallJsonObject(request, MAX_BODY_BYTES);
  if (!body) throw new ExpectedError("invalid_body", 400);
  return body;
}
