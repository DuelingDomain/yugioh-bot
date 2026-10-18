import { NextResponse } from "next/server";
import { createCardCatalogService, createCubeService } from "@yugidraft/shared/services";
import { EFFECT_SEARCH_ATTRIBUTION } from "@yugidraft/shared/cards/effects/capability";
import { requireWebAccess } from "./web-access";
import { getDb } from "./db";
import { env } from "./env";
import { cubeOwnerAccess } from "./cube-access";
import { effectSearchEnabled } from "./effect-search";
import { readJsonBody } from "./bug-reports/read-body";

export async function authorizeCubeEffects(params: Promise<{ id: string }>) {
  const actor = await requireWebAccess();
  if (!actor.ok) return { ok: false, response: actor.response } as const;
  if (!env.discordGuildId) return { ok: false, response: NextResponse.json({ error: "community_not_configured" }, { status: 503 }) } as const;
  const cubeId = Number((await params).id);
  if (!Number.isSafeInteger(cubeId) || cubeId <= 0) return { ok: false, response: NextResponse.json({ error: "Invalid cube id" }, { status: 400 }) } as const;
  const db = getDb();
  const denied = cubeOwnerAccess(db, cubeId, actor);
  if (denied) return { ok: false, response: denied } as const;
  if (!effectSearchEnabled()) return { ok: false, response: NextResponse.json({ effectSearchEnabled: false, error: "effect_search_disabled" }, { status: 404 }) } as const;
  const catalog = createCardCatalogService(db, { memberId: actor.userId });
  return { ok: true, db, cubeId, catalog, cubes: createCubeService(db, catalog) } as const;
}

export async function readCubeEffectBody(request: Request, fields: readonly string[]) {
  const body = await readJsonBody(request, 64 * 1024);
  if (!body.ok) return body.response.status === 413
    ? { ok: false, response: NextResponse.json({ error: "Cube request is too large" }, { status: 413 }) } as const
    : body;
  const value = body.value;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) {
    return { ok: false, response: NextResponse.json({ error: "Invalid cube effect request" }, { status: 400 }) } as const;
  }
  return { ok: true, value: value as Record<string, unknown> } as const;
}

export function cubeEffectResponse(data: object) {
  return NextResponse.json({ effectSearchEnabled: true, attribution: EFFECT_SEARCH_ATTRIBUTION, ...data }, { headers: { "Cache-Control": "private, no-store" } });
}
