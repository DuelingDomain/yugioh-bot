import { SECTION_KINDS, type Release, type ReleaseSection, type ReleaseSectionKind } from "./types";

export const SECTION_META: Record<ReleaseSectionKind, { label: string; emoji: string; hint: string }> = {
  new: { label: "New", emoji: "✨", hint: "Something players can do now that they could not do before." },
  improvements: { label: "Improvements", emoji: "⚡", hint: "Something that works better than it did." },
  cards: { label: "Card data", emoji: "📜", hint: "New cards, ban lists and script fixes." },
  fixes: { label: "Fixes", emoji: "🔧", hint: "A bug that is gone." },
  howto: { label: "How to use", emoji: "🔎", hint: "Short steps, one per line." },
};

/** Numeric parts of "0.2.2". A part that is not a number counts as 0. */
function parts(version: string): number[] {
  return version.split(".").map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/** Negative when a is older than b, positive when newer, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** True when the newest release is newer than the last one this person saw (or they saw none). */
export function isUnseen(latest: Release | undefined, lastSeenVersion: string | null): boolean {
  if (!latest) return false;
  return lastSeenVersion === null || compareVersions(latest.version, lastSeenVersion) > 0;
}

/**
 * Pages that must never be interrupted by the reveal: a live duel, a replay, a draft room. (A remote duel is a duel
 * page too.) The chip and its ping still show; only the card that pops up by itself is held back.
 */
export function isQuietPath(pathname: string): boolean {
  return pathname.startsWith("/duels/") || pathname.startsWith("/draft/") || pathname.startsWith("/admin/watch/");
}

/** True while another dialog holds the screen. The board's own panels are not modal (aria-modal="false"). */
export function modalIsOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector('[role="dialog"][aria-modal="true"]:not([inert]), [role="alertdialog"]:not([inert]), dialog[open]') !== null;
}

/** Text with **bold** marks, as plain text. */
export function stripRich(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1");
}

/** How many changes a release lists: every item except the how-to steps. */
export function changeCount(release: Pick<Release, "sections">): number {
  return release.sections.reduce((sum, s) => sum + (s.kind === "howto" ? 0 : s.items.length), 0);
}

export function sectionItemCount(release: Pick<Release, "sections">, kind: ReleaseSectionKind): number {
  return release.sections.filter((s) => s.kind === kind).reduce((sum, s) => sum + s.items.length, 0);
}

/** "DDOM-0202" for 0.2.2: a set-code line for the card, from the version. */
export function setCode(version: string): string {
  const [major = 0, minor = 0, patch = 0] = parts(version);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `DDOM-${major > 0 ? major : ""}${pad(minor)}${pad(patch)}`;
}

/** "4 NOV 2026", in the viewer's time zone. */
export function cardDate(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).toUpperCase();
}

/** "4 November 2026" */
export function longDate(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** "24 Oct 2026" */
export function shortDate(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** The three small stat words at the foot of the card: NEW 3, FIX 1, then card data or improvements. */
export function cardStats(release: Pick<Release, "sections">): string[] {
  const n = (kind: ReleaseSectionKind) => sectionItemCount(release, kind);
  const stats: string[] = [];
  if (n("new")) stats.push(`NEW ${n("new")}`);
  if (n("improvements")) stats.push(`IMPROVED ${n("improvements")}`);
  if (n("fixes")) stats.push(`FIX ${n("fixes")}`);
  if (n("cards")) stats.push(`CARDS ${n("cards")}`);
  return stats.slice(0, 3);
}

/** The title with its version split off, so the version can be set in gold: ["Dueling Domain ", "v0.2.2"]. */
export function splitTitle(release: Pick<Release, "title" | "version">): [string, string | null] {
  const tag = `v${release.version}`;
  const at = release.title.lastIndexOf(tag);
  if (at < 0) return [release.title, null];
  return [release.title.slice(0, at), release.title.slice(at, at + tag.length)];
}

/** Sections in the order of the notes, empty ones dropped, and one entry per kind. */
export function orderedSections(sections: ReleaseSection[]): ReleaseSection[] {
  return SECTION_KINDS.map((kind) => ({ kind, items: sections.filter((s) => s.kind === kind).flatMap((s) => s.items) })).filter((s) => s.items.length > 0);
}
