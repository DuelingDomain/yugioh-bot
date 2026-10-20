import { NextResponse } from "next/server";
import { createCardLookupBudget, parseCubeBatchEntries } from "@yugidraft/shared/services";
import { authorizeCubeEffects, cubeEffectResponse, readCubeEffectBody } from "@/lib/cube-effects-api";
import { cubeDetail } from "@/lib/cube-detail";
import { ensureCatalogCards } from "@/lib/cube-pool";
import { apiErrorResponse } from "@/lib/api-errors";
import { cardFetchErrorResponse } from "@/lib/card-fetch-errors";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authorizeCubeEffects(params);
  if (!ctx.ok) return ctx.response;
  const body = await readCubeEffectBody(request, ["entries"]);
  if (!body.ok) return body.response;
  try {
    const entries = parseCubeBatchEntries(body.value.entries);
    if (entries.length > 500) return NextResponse.json({ error: "Choose at most 500 seed rows" }, { status: 400 });
    const budget = createCardLookupBudget();
    const unknownIds = await ensureCatalogCards(ctx.catalog, entries.map(entry => entry.id), budget);
    if (unknownIds.length) return NextResponse.json({ error: "Some cards could not be resolved", unknownIds }, { status: 400 });
    const result = ctx.cubes.addBatch(ctx.cubeId, entries);
    return cubeEffectResponse({ ...cubeDetail(ctx.cubeId, ctx.cubes, ctx.catalog), ...result });
  } catch (error) { return cardFetchErrorResponse(error) ?? apiErrorResponse(error, "cube seed confirmation"); }
}
