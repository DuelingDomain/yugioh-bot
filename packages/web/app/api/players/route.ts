import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { duelErrorResponse, requireDuelActor } from "@/lib/duel-host";

export const runtime = "nodejs";

const MAX_PLAYERS = 20;
const MAX_QUERY_LENGTH = 100;

/** Guild players for the opponent picker. Excludes the caller. */
export async function GET(request: NextRequest) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  try {
    const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
    const escaped = q.replace(/[\\%_]/g, (char) => `\\${char}`);
    const rows = getDb()
      .prepare(
        `
        select id, display_name
        from players
        where guild_id = ? and id != ? and display_name like ? escape '\\'
        order by display_name collate nocase asc, id asc
        limit ?
      `,
      )
      .all(actor.guildId, actor.playerId, `%${escaped}%`, MAX_PLAYERS) as Array<{ id: number; display_name: string }>;
    return NextResponse.json({ players: rows.map((row) => ({ id: row.id, displayName: row.display_name })) });
  } catch (error) {
    return duelErrorResponse(error);
  }
}
