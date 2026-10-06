import type { CardDataStatus, EngineDataSource, UpstreamSourceStatus } from "@yugidraft/shared/types";

const REPOS: Record<EngineDataSource, string> = {
  database: "ProjectIgnis/BabelCDB",
  scripts: "ProjectIgnis/CardScripts",
  strings: "ProjectIgnis/Strings",
};

function freshSource(key: EngineDataSource): UpstreamSourceStatus {
  return {
    status: "ok", repository: REPOS[key], defaultBranch: "master", latestSha: `${key[0]}1234567890abcdef`,
    latestCommitDate: "2026-09-29T10:00:00Z", behindCommits: 0, behindDays: 0, comparison: "identical",
  };
}

/** A fully current snapshot. Tests override the parts they care about. */
export function freshStatus(): CardDataStatus {
  const sources = { database: freshSource("database"), scripts: freshSource("scripts"), strings: freshSource("strings") };
  return {
    generatedAt: "2026-10-06T12:00:00Z",
    engine: {
      bundleVersion: "bundle-2026-09-29",
      preparedAt: "2026-09-30T08:00:00Z",
      preparedAtSource: "manifest",
      sources: {
        database: { repository: REPOS.database, pinnedSha: "d1234567890abcdef", pinnedCommitDate: "2026-09-29T10:00:00Z" },
        scripts: { repository: REPOS.scripts, pinnedSha: "s1234567890abcdef", pinnedCommitDate: "2026-09-29T10:00:00Z" },
        strings: { repository: REPOS.strings, pinnedSha: "t1234567890abcdef", pinnedCommitDate: "2026-09-29T10:00:00Z" },
      },
      cardCount: 13012,
      cdbFiles: ["cards.cdb", "release-rota.cdb"],
    },
    catalog: {
      lastSuccessfulSyncAt: "2026-10-06T06:00:00Z",
      lastCardCachedAt: "2026-10-06T11:00:00Z",
      totalCards: 9876,
      revision: 4,
      newestSets: [{ name: "Rage of the Abyss", code: "RA05", releaseDate: "2026-09-26" }],
    },
    gap: { catalogMissingFromEngineCount: 0, catalogMissingFromEngine: [], engineMissingFromCatalogCount: 3 },
    upstream: {
      checkedAt: "2026-10-06T11:30:00Z",
      expiresAt: "2026-10-06T12:30:00Z",
      sources,
      babelCdbFiles: { status: "ok", files: ["cards.cdb", "release-rota.cdb"] },
    },
    updateWorkflow: {
      lastRunStatus: "ok",
      lastRun: { conclusion: "success", status: "completed", date: "2026-10-05T03:00:00Z", url: "https://github.com/DuelingDomain/yugioh-bot/actions/runs/1" },
      pullRequestStatus: "ok",
      openPullRequest: null,
    },
  };
}

export function unknownSource(key: EngineDataSource): UpstreamSourceStatus {
  return {
    status: "unknown", repository: REPOS[key], defaultBranch: null, latestSha: null, latestCommitDate: null,
    behindCommits: null, behindDays: null, comparison: "unknown",
  };
}

export function behindStatus(): CardDataStatus {
  const status = freshStatus();
  status.upstream.sources.database = {
    ...status.upstream.sources.database, latestSha: "dffffffffffffffff", latestCommitDate: "2026-10-02T10:00:00Z",
    behindCommits: 12, behindDays: 3, comparison: "behind",
  };
  return status;
}

export function gapCards(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: 10_000 + i,
    name: `Gap Card ${i}`,
    setCode: `RA05-EN${String(i).padStart(3, "0")}`,
    setReleaseDate: i < count / 2 ? "2026-09-26" : "2025-03-14",
  }));
}
