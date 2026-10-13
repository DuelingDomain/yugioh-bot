import { NextResponse } from "next/server";
import { requireWebAccess } from "@/lib/web-access";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { cubeDetail } from "@/lib/cube-detail";
import { createCardCatalogService, createCubeService, findDraftReadAccess } from "@yugidraft/shared/services";
import type { DraftConfig } from "@yugidraft/shared/types";

export const runtime = "nodejs";

/** A seat or the host can preview an attached cube, without access to its library entry. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;
  const { slug, id } = await params;
  const cubeId = Number(id);
  const missing = () => NextResponse.json({ error: "Cube not found" }, { status: 404 });
  if (!Number.isSafeInteger(cubeId) || cubeId <= 0) return missing();
  const db = getDb();
  const access = findDraftReadAccess(db, slug, env.discordGuildId, actor.userId);
  if (!access?.canRead) return missing();
  const draft = db.prepare("select created_by_user_id, config_json from drafts where id = ?")
    .get(access.id) as { created_by_user_id: number; config_json: string };
  if (!access.isSeated && draft.created_by_user_id !== actor.userId) return missing();
  const config = JSON.parse(draft.config_json) as DraftConfig;
  const attached = config.mode === "theme" ? config.allowedCubeIds?.includes(cubeId) : config.poolSource?.cubeId === cubeId;
  if (!attached || !db.prepare("select 1 from cubes where id = ? and guild_id = ?").get(cubeId, env.discordGuildId)) return missing();
  const catalog = createCardCatalogService(db);
  return NextResponse.json(cubeDetail(cubeId, createCubeService(db, catalog), catalog));
}
