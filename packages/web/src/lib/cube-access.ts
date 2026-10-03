import { NextResponse } from "next/server";
import type { getDb } from "./db";
import { env } from "./env";
import { checkDiscordWebAccess, webAccessError } from "./discord-web-access";

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

export async function cubeWriteAccess(db: ReturnType<typeof getDb>, cubeId: number, userId: string) {
  const cube = db
    .prepare("select created_by_user_id from cubes where id = ? and guild_id = ?")
    .get(cubeId, env.discordGuildId) as { created_by_user_id: string } | undefined;
  if (!cube) return NextResponse.json({ error: "Cube not found" }, { status: 404 });
  if (cube.created_by_user_id === userId) return null;
  const decision = await checkDiscordWebAccess(userId, "admin");
  return decision.ok ? null : NextResponse.json({ error: webAccessError(decision.status) }, { status: decision.status });
}
