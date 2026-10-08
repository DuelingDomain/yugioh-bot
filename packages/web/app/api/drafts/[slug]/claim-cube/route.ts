import { NextResponse } from "next/server";
import { requireWebAccess } from "@/lib/web-access";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { broadcaster } from "@/lib/notify";
import {
  invalidateThemeLobby, pendingThemeDraft, ThemeDraftMutationError,
  themeDraftMutationBody, themeDraftMutationResponse,
} from "@/lib/theme-draft-validation";

export const runtime = "nodejs";
type Context = { params: Promise<{ slug: string }> };

async function mutateClaim(request: Request, { params }: Context, release: boolean) {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;
  const userId = actor.userId;
  const { slug } = await params;
  const db = getDb();
  const guildId = env.discordGuildId;

  try {
    pendingThemeDraft(db, slug, guildId, userId);
    const body = release ? undefined : await themeDraftMutationBody(request);
    const cubeId = release ? null : body!.cubeId;
    const changed = db.transaction(() => {
      const draft = pendingThemeDraft(db, slug, guildId, userId);
      if ((draft.config.themeSelection ?? "player_pick") !== "player_pick") {
        throw new ThemeDraftMutationError("THEME_SELECTION_REQUIRED", "This draft does not allow player cube picks");
      }
      const player = db.prepare(`select p.id from players p join draft_players dp on dp.player_id = p.id
        where p.guild_id = ? and p.user_id = ? and dp.draft_id = ?`)
        .get(guildId, userId, draft.id) as { id: number } | undefined;
      if (!player) throw new ThemeDraftMutationError("NOT_JOINED", "Join the draft first");
      if (!release) {
        if (!Number.isSafeInteger(cubeId) || (cubeId as number) <= 0) {
          throw new ThemeDraftMutationError("INVALID_BODY", "cubeId must be a positive integer");
        }
        if (!(draft.config.allowedCubeIds ?? []).includes(cubeId as number)) {
          throw new ThemeDraftMutationError("CUBE_NOT_ALLOWED", "Cube is not allowed for this draft");
        }
        if (!db.prepare("select id from cubes where id = ? and guild_id = ?").get(cubeId, guildId)) {
          throw new ThemeDraftMutationError("CUBE_NOT_FOUND", "Cube not found");
        }
        if ((draft.config.uniqueThemes ?? true) && db.prepare(
          "select 1 from draft_player_cube where draft_id = ? and cube_id = ? and player_id != ?",
        ).get(draft.id, cubeId, player.id)) {
          throw new ThemeDraftMutationError("CUBE_TAKEN", "That cube is already taken");
        }
      }
      const current = db.prepare("select cube_id from draft_player_cube where draft_id = ? and player_id = ?")
        .get(draft.id, player.id) as { cube_id: number } | undefined;
      if ((current?.cube_id ?? null) === cubeId) return false;
      if (release) {
        db.prepare("delete from draft_player_cube where draft_id = ? and player_id = ?").run(draft.id, player.id);
      } else {
        db.prepare(`insert into draft_player_cube (draft_id, player_id, cube_id) values (?, ?, ?)
          on conflict (draft_id, player_id) do update set cube_id = excluded.cube_id`).run(draft.id, player.id, cubeId);
      }
      invalidateThemeLobby(db, draft.id, { playerIds: [player.id] });
      return true;
    }).immediate();
    if (changed) void broadcaster.draft({ kind: "seats", slug });
    return NextResponse.json({ ok: true, cubeId });
  } catch (error) {
    return themeDraftMutationResponse(error);
  }
}

export async function POST(request: Request, context: Context) {
  return mutateClaim(request, context, false);
}

export async function DELETE(request: Request, context: Context) {
  return mutateClaim(request, context, true);
}
