import { cubeEra } from "@yugidraft/shared/services";
import { authorizeCubeEffects, cubeEffectResponse } from "@/lib/cube-effects-api";
import { apiErrorResponse } from "@/lib/api-errors";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authorizeCubeEffects(params);
  if (!ctx.ok) return ctx.response;
  try { return cubeEffectResponse(cubeEra(ctx.db, ctx.cubeId)); }
  catch (error) { return apiErrorResponse(error, "cube era"); }
}
