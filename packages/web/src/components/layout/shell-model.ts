import { navItems, type NavItem } from "@/lib/nav-items";

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
export function activeNavHref(pathname: string, playerId: number | null = null): string | null {
  if (profilePlayerId(pathname) !== null) {
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

export const FALLBACK_TITLE = "YugiDraft";

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
