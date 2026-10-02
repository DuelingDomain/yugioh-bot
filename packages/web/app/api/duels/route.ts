import { isDuelFormat, multiDomainBlockReason, multiplayerTableBlockReason, type DuelTableCapabilities } from "@yugidraft/shared/duels";
import { NextRequest, NextResponse } from "next/server";
import { callDuelHost, duelErrorResponse, requireDuelActor } from "@/lib/duel-host";
import { multiplayerTablesEnabled } from "@/lib/duel-table-capabilities";
import { notifyDuelChange } from "@/lib/notify-duel";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  try {
    const archived = request.nextUrl.searchParams.get("archived") === "1";
    if (!archived) {
      return NextResponse.json({ duels: actor.duels.list(actor.guildId, actor.playerId) });
    }
    const scope = request.nextUrl.searchParams.get("scope") ?? "mine";
    if (scope !== "mine" && scope !== "all") {
      return NextResponse.json({ error: "Scope must be mine or all" }, { status: 400 });
    }
    return NextResponse.json({ duels: actor.duels.list(actor.guildId, actor.playerId, { archived: true, scope }) });
  } catch (error) {
    return duelErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;

  let body: { name?: unknown; mode?: unknown; masterRule?: unknown; settings?: unknown; format?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; mode?: unknown; masterRule?: unknown; settings?: unknown; format?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected a duel object" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name : "";
  const mode = body.mode;
  if (mode !== "normal" && mode !== "domain") {
    return NextResponse.json({ error: "Duel mode must be normal or domain" }, { status: 400 });
  }
  const format = body.format ?? "1v1";
  if (!isDuelFormat(format)) {
    return NextResponse.json({ error: "Duel format must be 1v1, tag, ffa3, or ffa4" }, { status: 400 });
  }
  const tableBlocked = multiplayerTableBlockReason(format, multiplayerTablesEnabled());
  if (tableBlocked) return NextResponse.json({ error: tableBlocked }, { status: 400 });
  if (format !== "1v1") {
    const result = await callDuelHost({ op: "capabilities", guildId: actor.guildId, playerId: actor.playerId });
    if (!result.ok) return result.response;
    const data = result.data as Partial<DuelTableCapabilities> | null;
    const blocked = multiplayerTableBlockReason(format, data?.multiplayerTables === true)
      ?? multiDomainBlockReason(mode, format, data?.multiDomainCoreReady === true);
    if (blocked) return NextResponse.json({ error: blocked }, { status: 400 });
  }

  try {
    const session = actor.duels.create({
      guildId: actor.guildId,
      organizerPlayerId: actor.playerId,
      name,
      mode,
      format,
      masterRule: body.masterRule as 1 | 2 | 3 | 4 | 5 | undefined,
      settings: body.settings,
    });
    try {
      await notifyDuelChange(session.slug, actor.guildId);
    } catch {
      // Create already committed.
    }
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    return duelErrorResponse(error);
  }
}
