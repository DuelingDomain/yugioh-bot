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
 *   gap: { recentSetsMissingFromEngineCount, recentSetsUnknownCount, recentSets, cachedCatalogMissingCount, cachedCatalogMissing, cachedCatalogIdMismatch },
 *   upstream: { checkedAt, expiresAt, sources: { database, scripts, strings }, babelCdbFiles: { status, files } },
 *   updateWorkflow: { lastRunStatus, lastRun, pullRequestStatus, openPullRequest }
 * }
 * Engine source pins include repository/pinnedSha/pinnedCommitDate (the source's "data as of" date). Upstream sources
 * include status/defaultBranch/latestSha/latestCommitDate/behindCommits/behindDays/comparison.
 * Unknown remote values are null with status="unknown"; an empty successful workflow/PR
 * lookup is null with status="ok". Dates are ISO timestamps or YYYY-MM-DD release dates.
 * Local SQLite/engine failures return 503; GitHub failures preserve a 200 local snapshot.
 * lastSuccessfulSyncAt is the scheduled SETS sync, not a full card import. The primary gap
 * covers sets released in the last 12 calendar months, fetched through the shared card queue.
 * Each recentSets row has name/code/releaseDate/status/checkedAt/total/missingCount/missingCards/idMismatch.
 * Counts are playable alias/artwork families, excluding skills and tokens. Unknown set totals
 * and missing counts are null; recentSetsUnknownCount reports these sets. The primary count
 * sums known sets and is null only before the first set sync.
 * Same-name/type passcode differences are idMismatch, not missing.
 * The cachedCatalog fields are secondary diagnostics for the incomplete on-demand catalog.
 * Set lists persist in SQLite and refresh on view, at most daily for sets <=60 days old
 * and at most weekly for older sets. Background fetches run one set at a time.
 * preparedAt is null and preparedAtSource is unknown; file mtime is not a preparation date.
 * GitHub metadata caches one hour; failures retry after five minutes, Retry-After, or an
 * exhausted rate-limit reset (x-ratelimit-remaining=0). Permission failures stay per-resource.
 * Cold/stale remote metadata returns immediately while refreshing in the background; checkedAt
 * identifies the last fetch and is null on a cold read before the first refresh completes.
 * defaultBranch is null: HEAD is resolved through the default-branch
 * commits endpoint without a separate repo lookup. The web call has a five-second deadline.
 * Local snapshots live at least 60 seconds and use the host's startup bundle manifest.
 * HTTP responses are never cached. Guild admin access uses
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
