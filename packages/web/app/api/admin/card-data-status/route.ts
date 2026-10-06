import { NextResponse } from "next/server";
import { createPlayerService } from "@yugidraft/shared/services";
import type { CardDataStatus } from "@yugidraft/shared/types";
import { requireWebAccess } from "@/lib/web-access";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { callEngineDataStatus } from "@/lib/duel-host";

export const runtime = "nodejs";

/**
 * GET /api/admin/card-data-status -> CardDataStatus (exported by @yugidraft/shared/types).
 * {
 *   generatedAt: ISO timestamp,
 *   engine: { bundleVersion, preparedAt, preparedAtSource, sources: { database, scripts, strings }, cardCount, cdbFiles },
 *   catalog: { lastSuccessfulSyncAt, lastCardCachedAt, totalCards, revision, newestSets },
 *   gap: { catalogMissingFromEngineCount, catalogMissingFromEngine: [{ id, name, setCode, setReleaseDate }], engineMissingFromCatalogCount },
 *   upstream: { checkedAt, expiresAt, sources: { database, scripts, strings }, babelCdbFiles: { status, files } },
 *   updateWorkflow: { lastRunStatus, lastRun, pullRequestStatus, openPullRequest }
 * }
 * Engine source pins include repository/pinnedSha/pinnedCommitDate. Upstream sources
 * include status/defaultBranch/latestSha/latestCommitDate/behindCommits/behindDays/comparison.
 * Unknown remote values are null with status="unknown"; an empty successful workflow/PR
 * lookup is null with status="ok". Dates are ISO timestamps or YYYY-MM-DD release dates.
 * Local SQLite/engine failures return 503; GitHub failures preserve a 200 local snapshot.
 * lastSuccessfulSyncAt is the scheduled SETS sync, not a full card import. Counts describe
 * the local cached catalog; gaps count alias/artwork families, newest known printing first.
 * preparedAtSource="manifest-mtime" explicitly identifies an estimate for old bundles.
 * GitHub results cache for one hour (including failures); local gaps cache by bundleVersion
 * and persisted catalog revision. HTTP responses are never cached. Guild admin access uses
 * discord-web-access via requireWebAccess: no session=401, denied=403, verification down=503.
 */
export async function GET() {
  const actor = await requireWebAccess("admin");
  if (!actor.ok) return actor.response;
  try {
    const player = createPlayerService(getDb()).findOrCreate(env.discordGuildId, actor.userId, actor.userName);
    const result = await callEngineDataStatus({ guildId: env.discordGuildId, playerId: player.id });
    if (!result.ok) return result.response;
    const status: CardDataStatus = result.data;
    return NextResponse.json(status, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[api/admin/card-data-status]", error);
    return NextResponse.json({ error: "Card data status is unavailable" }, { status: 503 });
  }
}
