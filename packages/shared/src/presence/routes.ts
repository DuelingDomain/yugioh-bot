/** Closed vocabulary shared by browser and server. Never persist an input pathname. */
export const PRESENCE_ROUTES = {
  "/app": "App", "/dashboard": "Dashboard", "/admin": "Admin console",
  "/decks": "Decks", "/decks/new": "Deck builder", "/decks/[id]": "Deck builder", "/decks/draft/[slug]": "Draft deck builder",
  "/duels": "Duel lobby", "/duels/new": "New duel table", "/duels/[slug]": "Duel",
  "/duels/[slug]/replay": "Replay", "/duels/dev-presets": "Duel practice",
  "/drafts": "Drafts", "/drafts/new": "New draft", "/drafts/new/theme": "New theme draft",
  "/drafts/new/cube": "New cube draft", "/draft/[slug]": "Draft",
  "/tournaments": "Tournaments", "/tournaments/new": "New tournament",
  "/tournament/[slug]": "Tournament", "/tournament/[slug]/standings": "Tournament standings",
  "/cubes": "Cubes", "/cubes/[id]": "Cube editor", "/leaderboard": "Leaderboard",
  "/player/[id]": "Player profile", "/settings": "Settings", "/settings/account": "Account settings",
  "/settings/bug-reports": "Bug reports", "/settings/card-data": "Card data",
} as const;
export type PresenceRoute = keyof typeof PRESENCE_ROUTES;
export function isPresenceRoute(value: unknown): value is PresenceRoute {
  return typeof value === "string" && Object.hasOwn(PRESENCE_ROUTES, value);
}
export function presenceRoute(pathname: string): PresenceRoute {
  if (isPresenceRoute(pathname)) return pathname;
  const patterns: [RegExp, PresenceRoute][] = [
    [/^\/decks\/draft\/[^/]+$/, "/decks/draft/[slug]"], [/^\/decks\/[^/]+$/, "/decks/[id]"],
    [/^\/duels\/[^/]+\/replay$/, "/duels/[slug]/replay"], [/^\/duels\/[^/]+$/, "/duels/[slug]"],
    [/^\/draft\/[^/]+$/, "/draft/[slug]"], [/^\/tournament\/[^/]+\/standings$/, "/tournament/[slug]/standings"],
    [/^\/tournament\/[^/]+$/, "/tournament/[slug]"], [/^\/cubes\/[^/]+$/, "/cubes/[id]"],
    [/^\/player\/[^/]+$/, "/player/[id]"], [/^\/settings\/account(?:\/.*)?$/, "/settings/account"],
  ];
  return patterns.find(([pattern]) => pattern.test(pathname))?.[1] ?? "/app";
}
