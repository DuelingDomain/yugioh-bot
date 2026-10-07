import { NextResponse } from "next/server";
import type { getDb } from "./db";
import { env } from "./env";

export function cubeReferenceAccess(
  db: ReturnType<typeof getDb>,
  cubeIds: unknown,
  options: { allowMissing?: boolean } = {},
) {
  if (cubeIds === undefined) return null;
  if (!Array.isArray(cubeIds) || cubeIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    return NextResponse.json({ error: "Invalid cube ids" }, { status: 400 });
  }
  const find = db.prepare("select guild_id from cubes where id = ?");
  for (const id of cubeIds) {
    const cube = find.get(id) as { guild_id: string } | undefined;
    if (cube ? cube.guild_id !== env.discordGuildId : !options.allowMissing) {
      return NextResponse.json({ error: "Cube not found" }, { status: 404 });
    }
  }
  return null;
}

export async function cubeWriteAccess(
  db: ReturnType<typeof getDb>,
  cubeId: number,
  actor: { userId: number; discordUserId: string | null },
) {
  const cube = db
    .prepare("select created_by_user_id from cubes where id = ? and guild_id = ?")
    .get(cubeId, env.discordGuildId) as { created_by_user_id: number } | undefined;
  if (!cube) return NextResponse.json({ error: "Cube not found" }, { status: 404 });
  if (cube.created_by_user_id === actor.userId) return null;
  return NextResponse.json({ error: "Only the cube creator can edit this cube" }, { status: 403 });
}
