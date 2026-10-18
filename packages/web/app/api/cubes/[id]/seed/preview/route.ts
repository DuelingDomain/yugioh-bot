import { NextResponse } from "next/server";
import { ensureCubeSeedIndex } from "@yugidraft/shared/services";
import type { CubeSeedOptions } from "@yugidraft/shared/services";
import { acquireCubeSeedPreview, authorizeCubeEffects, cubeEffectResponse, readCubeEffectBody } from "@/lib/cube-effects-api";
import { cubeCardsByIds } from "@/lib/cube-detail";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authorizeCubeEffects(params);
  if (!ctx.ok) return ctx.response;
  const lock = acquireCubeSeedPreview(ctx.userId);
  if (!lock.ok) return lock.response;
  try {
    const body = await readCubeEffectBody(request, ["phrase", "targetCount", "maxCopies", "era"]);
    if (!body.ok) return body.response;
    await ensureCubeSeedIndex(ctx.db);
    const preview = ctx.cubes.previewSeed(ctx.cubeId, body.value as unknown as CubeSeedOptions);
    return cubeEffectResponse({ ...preview, cards: cubeCardsByIds(preview.rows.map(row => row.id), ctx.catalog) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Effect search failed" }, { status: 400 }); }
  finally { lock.release(); }
}
