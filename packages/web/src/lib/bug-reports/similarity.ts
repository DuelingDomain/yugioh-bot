import { BUG_FORMATS, type BugFormat } from "../bug-report";

/** A bug that may be the one the player is describing: an open from-app issue, or a local report that owns an issue. */
export interface DuplicateCandidate {
  number: number;
  url: string;
  title: string;
  /** Title and the start of the description: what the similarity reads. */
  text: string;
  format?: BugFormat;
  /** Another player reported this issue in the same duel (same turn, or within 10 minutes). */
  sameDuel?: boolean;
}

export interface RankedCandidate extends DuplicateCandidate {
  score: number;
}

const STOP = new Set([
  "the", "and", "for", "but", "not", "was", "were", "are", "has", "had", "have", "that", "this", "with", "when", "then",
  "after", "before", "from", "into", "just", "its", "can", "did", "does", "got", "get", "bug", "you", "your", "they", "them",
  "what", "which", "would", "should", "could", "there", "will", "only", "also", "very", "some", "than", "too", "all",
]);

/** Lower case, bracket tags like [Bug] [FFA3] removed, every other mark turned into a space. */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\[[^\]]*\]/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function wordSet(text: string): Set<string> {
  return new Set(normalizeText(text).split(" ").filter((word) => word.length >= 3 && !STOP.has(word)));
}

function trigramSet(text: string): Set<string> {
  const flat = ` ${normalizeText(text).split(" ").filter((word) => !STOP.has(word)).join(" ")} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= flat.length; i += 1) out.add(flat.slice(i, i + 3));
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared;
}

/** 0 to 1: half the word overlap (Jaccard), half the letter-triple overlap (Dice). Catches "freezes" against "froze". */
export function textSimilarity(a: string, b: string): number {
  const wa = wordSet(a);
  const wb = wordSet(b);
  const ta = trigramSet(a);
  const tb = trigramSet(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  const jaccard = overlap(wa, wb) / (wa.size + wb.size - overlap(wa, wb));
  const dice = (2 * overlap(ta, tb)) / (ta.size + tb.size);
  return 0.5 * jaccard + 0.5 * dice;
}

export const SIMILARITY_THRESHOLD = 0.3;
const SAME_FORMAT_BONUS = 0.08;

/** The format named by an issue title tag such as `[FFA3]`, so open issues need no stored format. */
export function formatFromTitle(title: string): BugFormat | undefined {
  const tag = /\[(1v1|FFA3|FFA4|Tag)\]/i.exec(title)?.[1]?.toLowerCase();
  return BUG_FORMATS.find((format) => format === tag);
}

/**
 * The best candidates for a new report. A candidate from the same duel always comes first and needs no score. The rest
 * must reach the threshold; a candidate of the same format gets a small bonus. At most `limit` are returned.
 */
export function rankCandidates(
  query: { text: string; format?: BugFormat },
  candidates: readonly DuplicateCandidate[],
  options: { threshold?: number; limit?: number } = {},
): RankedCandidate[] {
  const threshold = options.threshold ?? SIMILARITY_THRESHOLD;
  const limit = options.limit ?? 3;
  const seen = new Set<number>();
  const scored: RankedCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.number)) continue;
    seen.add(candidate.number);
    const base = textSimilarity(query.text, candidate.text);
    const bonus = query.format && candidate.format === query.format ? SAME_FORMAT_BONUS : 0;
    scored.push({ ...candidate, score: Math.min(1, base + bonus) });
  }
  const same = scored.filter((c) => c.sameDuel).sort((a, b) => b.score - a.score);
  const rest = scored.filter((c) => !c.sameDuel && c.score >= threshold).sort((a, b) => b.score - a.score);
  return [...same, ...rest].slice(0, limit);
}
