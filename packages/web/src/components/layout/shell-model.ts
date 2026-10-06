import { navItems, type NavItem } from "@/lib/nav-items";
import type { LiveOpponent } from "@yugidraft/shared/services";
import type { DuelPresencePayload } from "@yugidraft/shared/ws";

/** Sidebar grouping from the b14 board. nav-items.ts keeps its links and icons. */
export const NAV_GROUPS: { label: string | null; hrefs: string[] }[] = [
  { label: null, hrefs: ["/dashboard"] },
  { label: "Compete", hrefs: ["/tournaments", "/drafts", "/duels", "/leaderboard"] },
  { label: "Build", hrefs: ["/decks", "/cubes"] },
];

export const FOOT_HREF = "/settings";

export function navItemByHref(href: string): NavItem | undefined {
  return navItems.find((item) => item.href === href);
}

export function groupedNav(): { label: string | null; items: NavItem[] }[] {
  return NAV_GROUPS.map((g) => ({
    label: g.label,
    items: g.hrefs.map(navItemByHref).filter((i): i is NavItem => Boolean(i)),
  }));
}

const PLAYER_RE = /^\/player\/(\d+)\/?$/;

/** The player id when the path is a profile page. */
export function profilePlayerId(pathname: string): number | null {
  const m = PLAYER_RE.exec(pathname);
  return m ? Number(m[1]) : null;
}

/** True when the page is the signed-in person's own profile. */
export function isOwnProfile(pathname: string, playerId: number | null): boolean {
  const id = profilePlayerId(pathname);
  return id !== null && playerId !== null && id === playerId;
}

/**
 * Which sidebar link is lit for a path. Detail pages light their section
 * (/tournament/x -> Tournaments), someone else's profile lights Leaderboard,
 * and /themes lights Cubes. Your own profile lights none: your name does.
 */
export function activeNavHref(pathname: string, playerId: number | null = null, profileSettled = true): string | null {
  if (profilePlayerId(pathname) !== null) {
    if (!profileSettled) return null;
    return isOwnProfile(pathname, playerId) ? null : "/leaderboard";
  }
  if (pathname === "/tournament" || pathname.startsWith("/tournament/")) return "/tournaments";
  if (pathname === "/draft" || pathname.startsWith("/draft/")) return "/drafts";
  if (pathname === "/themes" || pathname.startsWith("/themes/")) return "/cubes";
  for (const item of navItems) {
    const on = item.match === "exact" ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (on) return item.href;
  }
  return null;
}

export const FALLBACK_TITLE = "Dueling Domain";

/** The phone top bar title: the nav label for the current path, with the board's detail titles. */
export function pageTitle(pathname: string, playerId: number | null = null): string {
  if (pathname === "/tournaments/new") return "New tournament";
  if (pathname === "/tournament" || pathname.startsWith("/tournament/")) return "Tournament";
  if (pathname === "/drafts/new" || pathname.startsWith("/drafts/new/")) return "New draft";
  if (pathname === "/draft" || pathname.startsWith("/draft/")) return "Draft";
  if (pathname.startsWith("/decks/draft/")) return "Draft deck";
  if (/^\/cubes\/[^/]+/.test(pathname)) return "Cube";
  if (pathname === "/themes" || pathname.startsWith("/themes/")) return "Themes";
  if (profilePlayerId(pathname) !== null) return isOwnProfile(pathname, playerId) ? "Your profile" : "Player";
  const href = activeNavHref(pathname, playerId);
  return (href && navItemByHref(href)?.label) || FALLBACK_TITLE;
}
export const PHONE_MAX_WIDTH = 820;

/* ---- Live now ---- */

export type LiveDuelState = "live" | "between" | "waiting";

/** What `GET /api/live` returns. */
export interface LiveNow {
  yourDuel: { href: string; opponent: string; state: LiveDuelState; opponents?: LiveOpponent[] } | null;
  liveCount: number;
  /** Client-only socket snapshot, never inferred from readiness. */
  presence?: Omit<DuelPresencePayload, "slug"> | null;
}

/** Checks the shape of an `/api/live` answer. Anything else counts as "no data" (null). */
export function parseLiveNow(raw: unknown): LiveNow | null {
  if (!raw || typeof raw !== "object") return null;
  const { yourDuel, liveCount } = raw as { yourDuel?: unknown; liveCount?: unknown };
  if (typeof liveCount !== "number" || !Number.isFinite(liveCount) || liveCount < 0) return null;
  if (yourDuel === null) return { yourDuel: null, liveCount: Math.floor(liveCount) };
  if (!yourDuel || typeof yourDuel !== "object") return null;
  const d = yourDuel as { href?: unknown; opponent?: unknown; state?: unknown; opponents?: unknown };
  if (typeof d.href !== "string" || !d.href.startsWith("/") || d.href.startsWith("//")) return null;
  if (typeof d.opponent !== "string") return null;
  if (d.state !== "live" && d.state !== "between" && d.state !== "waiting") return null;
  if (d.opponents !== undefined && (!Array.isArray(d.opponents) || !d.opponents.every((item) =>
    item && Number.isInteger(item.seat) && item.seat >= 0 && typeof item.name === "string" && typeof item.isBot === "boolean"
  ))) return null;
  return { yourDuel: { href: d.href, opponent: d.opponent, state: d.state,
    ...(d.opponents === undefined ? {} : { opponents: d.opponents as LiveOpponent[] }) }, liveCount: Math.floor(liveCount) };
}

export interface LiveRowModel {
  kind: "you" | "live";
  title: string;
  sub: string;
  /** At least one human opponent has a visible duel tab. */
  present: boolean;
  /** The words on the right of the row, only for your own duel. */
  action: string | null;
  href: string;
  /** Tooltip text on the collapsed rail. */
  tip: string;
  /** Accessible name of the row link. */
  name: string;
}

function duels(n: number): string {
  return `${n} ${n === 1 ? "duel" : "duels"}`;
}

/** Which Live now row to show, or null when nothing is live. Your own duel always wins. */
export function liveRowModel(live: LiveNow | null, presence: Omit<DuelPresencePayload, "slug"> | null = null): LiveRowModel | null {
  if (!live) return null;
  const { yourDuel } = live;
  if (yourDuel) {
    const opponent = yourDuel.opponent.trim() || "your opponent";
    const opponents = yourDuel.opponents ?? [];
    const present = opponents.some((seat) => !seat.isBot && presence?.onlineSeats.includes(seat.seat));
    const sub = opponents.length ? opponents.map((seat) => `${seat.name} · ${seat.isBot ? "bot"
      : presence === null ? "presence unavailable" : presence.onlineSeats.includes(seat.seat) ? "in the room" : "away"}`).join("; ")
      : `${opponent} · presence unavailable`;
    return {
      kind: "you",
      title: "Your duel",
      sub,
      present,
      action: "Open duel",
      href: yourDuel.href,
      tip: `Your duel against ${sub}`,
      name: `Your duel against ${sub}. Open duel`,
    };
  }
  if (live.liveCount > 0) {
    const count = duels(live.liveCount);
    return { kind: "live", title: "Live now", sub: count, present: true, action: null, href: "/duels", tip: `Live now, ${count}`, name: `Live now, ${count}` };
  }
  return null;
}

/** The tournament page is wide: between these widths its sidebar starts collapsed. */
export const ROOM_COLLAPSE_QUERY = "(min-width: 1024px) and (max-width: 1360px)";

export function autoCollapseRoute(pathname: string): boolean {
  return pathname === "/tournament" || pathname.startsWith("/tournament/");
}
