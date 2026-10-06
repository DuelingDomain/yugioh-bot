import { cardFetchErrorResponse } from "@/lib/card-fetch-errors";
import { NextResponse } from "next/server";
import { requireWebAccess } from "@/lib/web-access";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { createCardCatalogService, createDraftService, createCubeService } from "@yugidraft/shared/services";
import { broadcaster } from "@/lib/notify";
import { setCubeDraftType } from "@/lib/cube-type";

export const runtime = "nodejs";

async function loadDraft(slug: string) {
  const db = getDb();
  const guildId = env.discordGuildId;
  const row = db
    .prepare("select id, status, created_by_user_id from drafts where web_slug = ? and guild_id = ?")
    .get(slug, guildId) as { id: number; status: string; created_by_user_id: number } | undefined;
  return { db, guildId, row };
}

function persistAllowedCubeIds(db: ReturnType<typeof getDb>, draftId: number, allowedCubeIds: number[]) {
  const drafts = createDraftService(db);
  const draft = drafts.findById(draftId);
  const nextConfig = { ...draft.config, allowedCubeIds };
  db.prepare("update drafts set config_json = ? where id = ?").run(JSON.stringify(nextConfig), draftId);
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;
  const { slug } = await params;
  const { db, row } = await loadDraft(slug);
  if (!row) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
  if (row.created_by_user_id !== actor.userId) {
    return NextResponse.json({ error: "Only the host can edit cubes" }, { status: 403 });
  }
  if (row.status !== "pending") {
    return NextResponse.json({ error: "Cubes can only be edited before the draft starts" }, { status: 400 });
  }

  const guildId = env.discordGuildId!;
  const drafts = createDraftService(db);
  const draft = drafts.findById(row.id);
  const catalog = createCardCatalogService(db);
  const cubes = createCubeService(db, catalog);

  const body = (await request.json().catch(() => ({}))) as {
    kind?: "archetype" | "blank" | "existing";
    archetype?: string;
    name?: string;
    cubeId?: number;
  };

  try {
    let cube;
    if (body.kind === "archetype") {
      const archetype = body.archetype?.trim();
      if (!archetype) {
        return NextResponse.json({ error: "archetype is required" }, { status: 400 });
      }
      cube = await cubes.createFromArchetype(guildId, archetype, actor.userId, {
        name: archetype,
      });
    } else if (body.kind === "existing") {
      // Attach an existing library cube to this draft (does not create a new one).
      if (!Number.isInteger(body.cubeId)) {
        return NextResponse.json({ error: "cubeId is required" }, { status: 400 });
      }
      const owned = db
        .prepare("select id from cubes where id = ? and guild_id = ?")
        .get(body.cubeId, guildId) as { id: number } | undefined;
      if (!owned) {
        return NextResponse.json({ error: "Cube not found" }, { status: 404 });
      }
      if ((draft.config.allowedCubeIds ?? []).includes(owned.id)) {
        return NextResponse.json({ error: "That cube is already in this draft" }, { status: 409 });
      }
      cube = cubes.findCube(owned.id);
    } else {
      const name = body.name?.trim();
      if (!name) {
        return NextResponse.json({ error: "name is required" }, { status: 400 });
      }
      cube = cubes.createBlank(guildId, name, actor.userId);
    }
    // A cube made inside a theme draft is for theme drafts. An attached library cube keeps its type.
    if (body.kind !== "existing") setCubeDraftType(db, cube.id, "theme");

    const allowedCubeIds = [...(draft.config.allowedCubeIds ?? []), cube.id];
    persistAllowedCubeIds(db, row.id, allowedCubeIds);
    void broadcaster.draft({ kind: "seats", slug });

    const pools = cubes.getCubePools(cube.id);
    return NextResponse.json(
      {
        cube: {
          id: cube.id,
          name: cube.name,
          archetype: cube.archetype,
          mainCount: pools.main.length,
          extraCount: pools.extra.length,
        },
        allowedCubeIds,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add cube";
    const failure = cardFetchErrorResponse(error);
    if (failure) return failure;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;
  const { slug } = await params;
  const { db, row } = await loadDraft(slug);
  if (!row) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
  if (row.created_by_user_id !== actor.userId) {
    return NextResponse.json({ error: "Only the host can edit cubes" }, { status: 403 });
  }
  if (row.status !== "pending") {
    return NextResponse.json({ error: "Cubes can only be edited before the draft starts" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { cubeId?: number };
  const cubeId = body.cubeId;
  if (!Number.isInteger(cubeId)) {
    return NextResponse.json({ error: "cubeId is required" }, { status: 400 });
  }

  const drafts = createDraftService(db);
  const draft = drafts.findById(row.id);
  const allowedCubeIds = (draft.config.allowedCubeIds ?? []).filter((id) => id !== cubeId);
  persistAllowedCubeIds(db, row.id, allowedCubeIds);

  // Detach only — the cube stays in the library (delete it from its editor instead).
  db.prepare("delete from draft_player_cube where draft_id = ? and cube_id = ?").run(row.id, cubeId);
  void broadcaster.draft({ kind: "seats", slug });

  return NextResponse.json({ ok: true, allowedCubeIds });
}
