import { NextResponse } from "next/server";
import type Database from "better-sqlite3";
import { DRAFT_READ_ACCESS_ERROR, findDraftReadAccess } from "@yugidraft/shared/services";

/** Apply before loading draft data; route-specific restrictions still apply afterwards. */
export function draftReadAccess(db: Database.Database, slug: string, guildId: string, userId: number) {
  const access = findDraftReadAccess(db, slug, guildId, userId);
  if (!access) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  if (!access.canRead) return NextResponse.json({ error: DRAFT_READ_ACCESS_ERROR }, { status: 404 });
  return null;
}
