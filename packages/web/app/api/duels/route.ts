import { isDuelFormat, MULTI_CORE_UNAVAILABLE_MESSAGE, multiDomainBlockReason, multiplayerTablesBlockReason, multiplayerTablesEnabled, type DuelTableCapabilities } from "@yugidraft/shared/duels";
import { NextRequest, NextResponse } from "next/server";
import { createDuelSeriesService, DuelServiceError } from "@yugidraft/shared/services";
import { assertDuelInviteUrl, duelUrl, sendDuelInvite } from "@/lib/announce-bot";
import { getDb } from "@/lib/db";
import { callDuelHost, duelErrorResponse, requireDuelActor } from "@/lib/duel-host";
import { notifyDuelChange } from "@/lib/notify-duel";
import { playerIdentity } from "@/lib/player-lookup";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  try {
    if (request.nextUrl.searchParams.get("hostedWaiting") === "1") {
      return NextResponse.json({ table: actor.duels.waitingHostedTable(actor.guildId, actor.playerId) },
        { headers: { "cache-control": "private, no-store" } });
    }
    const archived = request.nextUrl.searchParams.get("archived") === "1";
    if (!archived) {
      return NextResponse.json({ duels: actor.duels.list(actor.guildId, actor.playerId).map(duel => ({
        ...duel, joinable: duel.joinable && !multiplayerTablesBlockReason(duel.tableType, multiplayerTablesEnabled()),
      })) },
        { headers: { "cache-control": "private, no-store" } });
    }
    const param = (key: string) => {
      const values = request.nextUrl.searchParams.getAll(key);
      if (values.length > 1) throw new DuelServiceError(`Duplicate ${key} parameter`, 400);
      return values[0];
    };
    const scope = param("scope") ?? "mine";
    if (scope !== "mine" && scope !== "all") {
      return NextResponse.json({ error: "Scope must be mine or all" }, { status: 400 });
    }
    const format = param("format");
    if (format !== undefined && !isDuelFormat(format)) {
      throw new DuelServiceError("Duel format must be 1v1, tag, ffa3, or ffa4", 400);
    }
    const limit = param("limit");
    if (limit !== undefined && !/^[1-9]\d*$/.test(limit)) throw new DuelServiceError("Limit must be a positive integer", 400);
    const status = param("status");
    if (status !== undefined && status !== "any" && status !== "completed" && status !== "interrupted" && status !== "cancelled") {
      throw new DuelServiceError("Status must be any, completed, interrupted, or cancelled", 400);
    }
    return NextResponse.json(actor.duels.listHistory(actor.guildId, actor.playerId, {
      scope, from: param("from"), to: param("to"), format, status,
      q: param("q"), card: param("card"), cursor: param("cursor"), limit: limit === undefined ? undefined : Number(limit),
    }), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return duelErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;

  type CreateBody = {
    name?: unknown;
    mode?: unknown;
    masterRule?: unknown;
    /** Includes host-settable genesys: { pointCap: 0..1000 } and Domain FFA firstTurnDraw. */
    settings?: unknown;
    format?: unknown;
    opponentPlayerId?: unknown;
    bestOf?: unknown;
    ranked?: unknown;
  };
  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
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
  // Read the shared deployment flag on every request.
  const tablesBlocked = multiplayerTablesBlockReason(format, multiplayerTablesEnabled());
  if (tablesBlocked) return NextResponse.json({ error: tablesBlocked }, { status: 403 });
  if (format !== "1v1") {
    const result = await callDuelHost({ op: "capabilities", guildId: actor.guildId, playerId: actor.playerId });
    if (!result.ok) return result.response;
    const data = result.data as Partial<DuelTableCapabilities> | null;
    const hostBlocked = multiplayerTablesBlockReason(format, data?.multiplayerTables === true);
    if (hostBlocked) return NextResponse.json({ error: hostBlocked }, { status: 403 });
    if (data?.multiCoreReady !== true) return NextResponse.json({ error: MULTI_CORE_UNAVAILABLE_MESSAGE }, { status: 409 });
    const domainBlocked = multiDomainBlockReason(mode, format, data?.multiDomainCoreReady === true);
    if (domainBlocked) return NextResponse.json({ error: domainBlocked }, { status: 409 });
  }
  const bestOf = body.bestOf ?? 1;
  if (bestOf !== 1 && bestOf !== 3) {
    return NextResponse.json({ error: "Best of must be 1 or 3" }, { status: 400 });
  }
  const ranked = body.ranked ?? false;
  if (typeof ranked !== "boolean") {
    return NextResponse.json({ error: "Ranked must be true or false" }, { status: 400 });
  }
  const opponentPlayerId = body.opponentPlayerId ?? null;
  if (opponentPlayerId !== null && (!Number.isInteger(opponentPlayerId) || (opponentPlayerId as number) < 1)) {
    return NextResponse.json({ error: "opponentPlayerId must be a player id" }, { status: 400 });
  }
  if (opponentPlayerId === actor.playerId) {
    return NextResponse.json({ error: "You cannot challenge yourself" }, { status: 400 });
  }
  if (opponentPlayerId !== null && format !== "1v1") {
    return NextResponse.json({ error: "A challenge is a 1v1 duel" }, { status: 400 });
  }

  try {
    const creation = {
      guildId: actor.guildId, organizerPlayerId: actor.playerId,
      requestKey: request.headers.get("Idempotency-Key") ?? undefined,
      fingerprint: JSON.stringify([name.trim(), mode, format, body.masterRule ?? 5, body.settings ?? null, bestOf, ranked, opponentPlayerId]),
    };
    if (opponentPlayerId !== null) {
      const db = getDb();
      const opponentDiscordUserId = playerIdentity(db, opponentPlayerId as number)?.discordUserId;
      if (opponentDiscordUserId) assertDuelInviteUrl(actor.guildId, request);
      const created = actor.duels.createRequest(creation, () => {
        const { series, duel } = createDuelSeriesService(db).createChallenge({
          guildId: actor.guildId,
          challengerPlayerId: actor.playerId,
          opponentPlayerId: opponentPlayerId as number,
          bestOf,
          ranked,
          mode,
          masterRule: body.masterRule as 1 | 2 | 3 | 4 | 5 | undefined,
          settings: body.settings,
          name: name || undefined,
        });
        return { session: duel, series };
      });
      const { session: duel, series } = created;
      await Promise.allSettled(created.changedSlugs.map(slug => notifyDuelChange(slug, actor.guildId)));
      // True only when the bot accepted the invite; the challenger copies the link when it did not.
      let notified = false;
      try {
        const db = getDb();
        const opponent = playerIdentity(db, opponentPlayerId as number);
        const challenger = playerIdentity(db, actor.playerId);
        if (!created.replayed && opponent) {
          notified = await sendDuelInvite(
            {
              slug: duel.slug,
              guildId: actor.guildId,
              opponentDiscordUserId: opponent.discordUserId,
              challengerName: challenger?.displayName ?? "A player",
              duelName: duel.name,
              bestOf: series!.bestOf,
              ranked: series!.ranked,
              tournamentName: null,
            },
            request,
          );
        }
      } catch (error) {
        console.warn("[api/duels] duel invite failed", error);
      }
      return NextResponse.json({ session: duel, series, notified }, { status: 201 });
    }

    const created = actor.duels.createRequest(creation, () => ({ session: actor.duels.create({
      guildId: actor.guildId,
      organizerPlayerId: actor.playerId,
      name,
      mode,
      format,
      masterRule: body.masterRule as 1 | 2 | 3 | 4 | 5 | undefined,
      settings: body.settings,
      bestOf,
      ranked,
    }) }));
    const { session } = created;
    await Promise.allSettled(created.changedSlugs.map(slug => notifyDuelChange(slug, actor.guildId)));
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    return duelErrorResponse(error);
  }
}
