import type {
  CardDataGapCard,
  CardDataStatus,
  EngineDataSource,
  UpstreamSourceStatus,
} from "@yugidraft/shared/types";

export const SOURCE_ORDER: EngineDataSource[] = ["database", "scripts", "strings"];

export const SOURCE_LABEL: Record<EngineDataSource, string> = {
  database: "BabelCDB",
  scripts: "CardScripts",
  strings: "Strings",
};

export type OverallState = "up-to-date" | "behind" | "unknown";

export interface CardDataSummary {
  state: OverallState;
  /** The key reason, one sentence. */
  headline: string;
  /** Every reason, key reason first. */
  reasons: string[];
}

const DAY_MS = 86_400_000;

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : "unknown";
}

export function commitUrl(repository: string, sha: string | null | undefined): string | null {
  if (!sha) return null;
  const repo = repository.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/+$/, "");
  return /^[\w.-]+\/[\w.-]+$/.test(repo) ? `https://github.com/${repo}/commit/${sha}` : null;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** "3 days ago", "just now". Future values read as "just now". */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return null;
  const diff = Math.max(0, now - time);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${plural(minutes, "minute")} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${plural(hours, "hour")} ago`;
  return `${plural(Math.floor(diff / DAY_MS), "day")} ago`;
}

export function absoluteTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Accepts ISO timestamps and YYYY-MM-DD release dates. */
export function absoluteDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function isSourceBehind(source: UpstreamSourceStatus): boolean {
  if (source.status !== "ok") return false;
  if (source.comparison === "behind" || source.comparison === "diverged") return true;
  return (source.behindCommits ?? 0) > 0;
}

function baseName(file: string): string {
  return (file.split("/").pop() ?? file).toLowerCase();
}

/** Upstream release-*.cdb files that the loaded bundle does not list. Empty when the upstream lookup failed. */
export function newUpstreamCdbFiles(status: CardDataStatus): string[] {
  if (status.upstream.babelCdbFiles.status !== "ok") return [];
  const loaded = new Set(status.engine.cdbFiles.map(baseName));
  return status.upstream.babelCdbFiles.files.filter((file) => /^release-.*\.cdb$/i.test(baseName(file)) && !loaded.has(baseName(file)));
}

function behindSentence(sources: UpstreamSourceStatus[]): string {
  const days = Math.max(0, ...sources.map((s) => s.behindDays ?? 0));
  const commits = sources.reduce((sum, s) => sum + (s.behindCommits ?? 0), 0);
  if (days > 0) return `Engine data ${plural(days, "day")} behind Project Ignis`;
  if (commits > 0) return `Engine data ${plural(commits, "commit")} behind Project Ignis`;
  return "Engine data is behind Project Ignis";
}

export function summarize(status: CardDataStatus): CardDataSummary {
  const sources = SOURCE_ORDER.map((key) => status.upstream.sources[key]);
  const behind = sources.filter(isSourceBehind);
  const unknown = sources.filter((s) => s.status !== "ok");
  const newCdbs = newUpstreamCdbFiles(status);
  const gap = status.gap.catalogMissingFromEngineCount;

  const reasons: string[] = [];
  if (behind.length) reasons.push(behindSentence(behind));
  if (newCdbs.length) reasons.push(`${plural(newCdbs.length, "new release file")} upstream not loaded`);
  if (gap > 0) reasons.push(`${plural(gap, "TCG card")} not in the duel engine`);

  if (reasons.length) return { state: "behind", headline: reasons[0], reasons };

  const unknownReasons: string[] = [];
  if (unknown.length === sources.length) unknownReasons.push("Cannot reach GitHub, so engine data age is unknown");
  else if (unknown.length) unknownReasons.push(`${plural(unknown.length, "engine source")} could not be checked against GitHub`);
  if (status.upstream.babelCdbFiles.status !== "ok" && !unknown.length) unknownReasons.push("New release files could not be checked");
  if (unknownReasons.length) return { state: "unknown", headline: unknownReasons[0], reasons: unknownReasons };

  return { state: "up-to-date", headline: "Engine data matches Project Ignis and the catalog has no gaps", reasons: [] };
}

/** Newest release first; cards without a date go last. Equal dates keep the server order. */
export function sortGap(cards: CardDataGapCard[]): CardDataGapCard[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => {
      const da = a.card.setReleaseDate ?? "";
      const db = b.card.setReleaseDate ?? "";
      if (da !== db) return da < db ? 1 : -1;
      return a.index - b.index;
    })
    .map((entry) => entry.card);
}

export function filterGap(cards: CardDataGapCard[], query: string): CardDataGapCard[] {
  const q = query.trim().toLowerCase();
  if (!q) return cards;
  return cards.filter((card) =>
    card.name.toLowerCase().includes(q) || String(card.id).includes(q) || (card.setCode ?? "").toLowerCase().includes(q),
  );
}
