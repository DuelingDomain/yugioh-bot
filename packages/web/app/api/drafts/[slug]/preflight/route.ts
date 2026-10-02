import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { createCardCatalogService, createDraftService, createCubeService } from "@yugidraft/shared/services";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { slug } = await params;
  const db = getDb();
  const guildId = env.discordGuildId;

  const draftRow = db
    .prepare("select id from drafts where web_slug = ? and guild_id = ?")
    .get(slug, guildId) as { id: number } | undefined;
  if (!draftRow) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  const draft = createDraftService(db).findById(draftRow.id);
  if (draft.config.mode !== "theme") {
    return NextResponse.json({ errors: [], warnings: [] });
  }

  const cubes = createCubeService(db, createCardCatalogService(db));
  const cfg = {
    themePackSize: draft.config.themePackSize ?? 3,
    cardsPerPlayer: draft.config.cardsPerPlayer ?? 40,
    extraDeckSize: draft.config.extraDeckSize ?? 15,
    burnUnpicked: draft.config.burnUnpicked ?? false,
    extraDeckEnabled: draft.config.extraDeckEnabled ?? true,
  };

  // Check every allowed theme — any of them could be assigned at start.
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const cubeId of draft.config.allowedCubeIds ?? []) {
    const cube = db.prepare("select name, guild_id from cubes where id = ?")
      .get(cubeId) as { name: string; guild_id: string } | undefined;
    // Match assignThemes: deleted library cubes are dropped at start.
    if (!cube) continue;
    if (cube.guild_id !== draft.guildId) {
      errors.push(`Cube ${cubeId}: Cube not found`);
      continue;
    }
    const analysis = cubes.analyzeCubePools(cubeId, cfg);
    const name = cube.name;
    for (const e of analysis.errors) errors.push(`${name}: ${e}`);
    for (const w of analysis.warnings) warnings.push(`${name}: ${w}`);
  }

  return NextResponse.json({ errors, warnings });
}
