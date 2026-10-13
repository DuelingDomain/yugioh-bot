import { NextResponse } from "next/server";
import type { getDb } from "./db";
import { env } from "./env";
import type { DraftConfig } from "@yugidraft/shared/types";

export function cubeReferenceAccess(
  db: ReturnType<typeof getDb>,
  cubeIds: unknown,
  options: { allowMissing?: boolean; userId?: string; existingCubeIds?: number[] } = {},
) {
  if (cubeIds === undefined) return null;
  if (!Array.isArray(cubeIds) || cubeIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    return NextResponse.json({ error: "Invalid cube ids" }, { status: 400 });
  }
  const find = db.prepare("select guild_id, created_by_user_id from cubes where id = ?");
  for (const id of cubeIds) {
    const cube = find.get(id) as { guild_id: string; created_by_user_id: string | null } | undefined;
    const existing = options.existingCubeIds?.includes(id) ?? false;
    if (cube
      ? cube.guild_id !== env.discordGuildId || (options.userId !== undefined && cube.created_by_user_id !== options.userId && !existing)
      : !(options.allowMissing && (options.userId === undefined || existing))) {
      return NextResponse.json({ error: "Cube not found" }, { status: 404 });
    }
  }
  return null;
}

/** New references require ownership. References already attached to this draft survive. */
export function draftCubeReferenceAccess(
  db: ReturnType<typeof getDb>, config: DraftConfig, userId: string, existing?: DraftConfig,
) {
  const denied = cubeReferenceAccess(db, config.allowedCubeIds, {
    userId, allowMissing: existing !== undefined, existingCubeIds: existing?.allowedCubeIds,
  });
  if (denied) return denied;
  const sourceId = config.poolSource?.cubeId;
  // The pool-source sanitizer drops malformed metadata. A valid ID must pass access first.
  if (!Number.isSafeInteger(sourceId) || sourceId! <= 0) return null;
  return cubeReferenceAccess(db, [sourceId], {
    userId, allowMissing: existing !== undefined,
    existingCubeIds: existing?.poolSource ? [existing.poolSource.cubeId] : [],
  });
}

/** Library reads and writes use the same owner check and conceal foreign cubes. */
export function cubeOwnerAccess(
  db: ReturnType<typeof getDb>,
  cubeId: number,
  actor: { userId: string },
) {
  const cube = db
    .prepare("select created_by_user_id from cubes where id = ? and guild_id = ?")
    .get(cubeId, env.discordGuildId) as { created_by_user_id: string } | undefined;
  if (cube?.created_by_user_id === actor.userId) return null;
  return NextResponse.json({ error: "Cube not found" }, { status: 404 });
}
