import { cardFetchErrorResponse } from "@/lib/card-fetch-errors";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { createCardCatalogService, createCubeService } from "@yugidraft/shared/services";
import type { Cube } from "@yugidraft/shared/types";
import { broadcaster } from "@/lib/notify";
import { setCubeDraftType } from "@/lib/cube-type";
import {
  invalidateThemeLobby, pendingThemeDraft, ThemeDraftMutationError,
  themeDraftMutationBody, themeDraftMutationResponse,
} from "@/lib/theme-draft-validation";

export const runtime = "nodejs";
type Context = { params: Promise<{ slug: string }> };

export async function POST(request: Request, { params }: Context) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  const userId = session.user.id;
  const { slug } = await params;
  const db = getDb();
  const guildId = env.discordGuildId;

  try {
    const initial = pendingThemeDraft(db, slug, guildId, userId, true);
    const body = await themeDraftMutationBody(request);
    const kind = body.kind;
    if (!["archetype", "blank", "existing"].includes(kind as string)) {
      throw new ThemeDraftMutationError("INVALID_BODY", "kind must be archetype, blank or existing");
    }
    if (kind === "existing" && (!Number.isSafeInteger(body.cubeId) || (body.cubeId as number) <= 0)) {
      throw new ThemeDraftMutationError("INVALID_BODY", "cubeId must be a positive integer");
    }
    const label = kind === "archetype" ? body.archetype : body.name;
    if (kind !== "existing" && (typeof label !== "string" || !label.trim())) {
      throw new ThemeDraftMutationError("INVALID_BODY", `${kind === "archetype" ? "archetype" : "name"} is required`);
    }
    // Body parsing can yield too; avoid creating a cube for an already closed lobby.
    pendingThemeDraft(db, slug, guildId, userId, true);
    const cubes = createCubeService(db, createCardCatalogService(db));
    let seeded: Cube | undefined;
    if (kind === "archetype") {
      try {
        const archetype = (label as string).trim();
        seeded = await cubes.createFromArchetype(guildId, archetype, userId, { name: archetype });
        setCubeDraftType(db, seeded.id, "theme");
      } catch (error) {
        const failure = cardFetchErrorResponse(error);
        if (failure) return failure;
        return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to add cube" }, { status: 400 });
      }
    }

    const result = db.transaction(() => {
      let draft;
      try {
        draft = pendingThemeDraft(db, slug, guildId, userId, true);
        if (draft.id !== initial.id) throw new ThemeDraftMutationError("DRAFT_NOT_FOUND", "Draft not found");
      } catch (error) {
        if (seeded && error instanceof ThemeDraftMutationError) {
          throw new ThemeDraftMutationError("CUBE_ATTACH_CONFLICT", "The cube was saved in your library, but the draft changed before it could be attached.", seeded.id);
        }
        throw error;
      }
      let cube: Cube;
      if (seeded || kind === "existing") {
        const cubeId = seeded?.id ?? body.cubeId;
        if (!db.prepare("select id from cubes where id = ? and guild_id = ?").get(cubeId, guildId)) {
          throw new ThemeDraftMutationError("CUBE_NOT_FOUND", "Cube not found");
        }
        cube = cubes.findCube(cubeId as number);
      } else {
        cube = cubes.createBlank(guildId, (label as string).trim(), userId);
        setCubeDraftType(db, cube.id, "theme");
      }
      if ((draft.config.allowedCubeIds ?? []).includes(cube.id)) {
        throw new ThemeDraftMutationError("CUBE_ALREADY_ATTACHED", "That cube is already in this draft");
      }
      const allowedCubeIds = [...(draft.config.allowedCubeIds ?? []), cube.id];
      db.prepare("update drafts set config_json = ? where id = ?")
        .run(JSON.stringify({ ...draft.config, allowedCubeIds }), draft.id);
      invalidateThemeLobby(db, draft.id);
      const pools = cubes.getCubePools(cube.id);
      return {
        cube: { id: cube.id, name: cube.name, archetype: cube.archetype, mainCount: pools.main.length, extraCount: pools.extra.length },
        allowedCubeIds,
      };
    }).immediate();
    void broadcaster.draft({ kind: "seats", slug });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    // Library name validation remains a 400; unexpected DB/service errors propagate.
    if (error instanceof Error && error.name === "CubeNameTakenError") return NextResponse.json({ error: error.message }, { status: 400 });
    return themeDraftMutationResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  const userId = session.user.id;
  const { slug } = await params;
  const db = getDb();
  const guildId = env.discordGuildId;

  try {
    pendingThemeDraft(db, slug, guildId, userId, true);
    const { cubeId } = await themeDraftMutationBody(request);
    if (!Number.isSafeInteger(cubeId) || (cubeId as number) <= 0) {
      throw new ThemeDraftMutationError("INVALID_BODY", "cubeId must be a positive integer");
    }
    const result = db.transaction(() => {
      const draft = pendingThemeDraft(db, slug, guildId, userId, true);
      // A deleted library cube may still be attached: allow detaching that stale reference.
      const cube = db.prepare("select guild_id from cubes where id = ?").get(cubeId) as { guild_id: string } | undefined;
      if (cube ? cube.guild_id !== guildId : !(draft.config.allowedCubeIds ?? []).includes(cubeId as number)) {
        throw new ThemeDraftMutationError("CUBE_NOT_FOUND", "Cube not found");
      }
      const allowedCubeIds = (draft.config.allowedCubeIds ?? []).filter((id) => id !== cubeId);
      const nextConfig = { ...draft.config, allowedCubeIds };
      if (nextConfig.themeAssignments) {
        nextConfig.themeAssignments = Object.fromEntries(Object.entries(nextConfig.themeAssignments).filter(([, id]) => id !== cubeId));
      }
      const claims = db.prepare("delete from draft_player_cube where draft_id = ? and cube_id = ?").run(draft.id, cubeId);
      const changed = claims.changes > 0 || JSON.stringify(nextConfig) !== JSON.stringify(draft.config);
      if (changed) {
        db.prepare("update drafts set config_json = ? where id = ?").run(JSON.stringify(nextConfig), draft.id);
        invalidateThemeLobby(db, draft.id);
      }
      return { allowedCubeIds, changed };
    }).immediate();
    if (result.changed) void broadcaster.draft({ kind: "seats", slug });
    return NextResponse.json({ ok: true, allowedCubeIds: result.allowedCubeIds });
  } catch (error) {
    return themeDraftMutationResponse(error);
  }
}
