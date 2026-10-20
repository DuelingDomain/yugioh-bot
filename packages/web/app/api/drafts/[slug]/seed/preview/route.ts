import { ensureCubeSeedIndex } from "@yugidraft/shared/services";
import { NextResponse } from "next/server";
import { createCardCatalogService, previewCubeSeed, type CubeSeedOptions } from "@yugidraft/shared/services";
import { requireWebAccess } from "@/lib/web-access";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { effectSearchEnabled } from "@/lib/effect-search";
import { cubeCardsByIds } from "@/lib/cube-detail";
import { acquireCubeSeedPreview, cubeEffectResponse, readCubeEffectBody } from "@/lib/cube-effects-api";
import { pendingThemeDraft, themeDraftMutationResponse } from "@/lib/theme-draft-validation";
import { apiErrorResponse } from "@/lib/api-errors";

export const runtime = "nodejs";

/**
 * Preview a theme from a phrase for the theme lobby. It reads the public catalog and writes nothing:
 * no cube exists until the host confirms, so a closed tab leaves nothing behind in the lobby or library.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;
  if (!env.discordGuildId) return NextResponse.json({ error: "community_not_configured" }, { status: 503 });
  const { slug } = await params;
  const db = getDb();
  try {
    // Host-only, guild-scoped and still pending, the same gate as attaching a cube.
    pendingThemeDraft(db, slug, env.discordGuildId, actor.userId, true);
  } catch (error) {
    return themeDraftMutationResponse(error);
  }
  if (!effectSearchEnabled()) return NextResponse.json({ effectSearchEnabled: false, error: "effect_search_disabled" }, { status: 404 });
  const lock = acquireCubeSeedPreview(actor.userId);
  if (!lock.ok) return lock.response;
  try {
    const body = await readCubeEffectBody(request, ["phrase", "targetCount", "maxCopies", "era"]);
    if (!body.ok) return body.response;
    await ensureCubeSeedIndex(db);
    const preview = previewCubeSeed(db, body.value as unknown as CubeSeedOptions, []);
    const catalog = createCardCatalogService(db, { memberId: actor.userId });
    return cubeEffectResponse({ ...preview, cards: cubeCardsByIds(preview.rows.map(row => row.id), catalog) });
  } catch (error) { return apiErrorResponse(error, "draft seed preview"); }
  finally { lock.release(); }
}
