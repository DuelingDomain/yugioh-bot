export const ACTIVE_GAME_NOTICE = "You have an active game. Returning you to it.";
export const ACTIVE_GAME_URL = "/api/duels/active";

export type ActiveDuel = {
  slug: string;
  state: "lobby" | "playing";
  role: "host" | "guest";
  format: "1v1" | "tag" | "ffa3" | "ffa4";
};

const FORMATS = new Set(["1v1", "tag", "ffa3", "ffa4"]);

/** Reads the body of `GET /api/duels/active`. Anything unexpected counts as "no active duel". */
export function parseActiveDuel(body: unknown): ActiveDuel | null {
  if (!body || typeof body !== "object") return null;
  const active = (body as { active?: unknown }).active;
  if (!active || typeof active !== "object") return null;
  const { slug, state, role, format } = active as Record<string, unknown>;
  if (typeof slug !== "string" || slug === "") return null;
  if (state !== "lobby" && state !== "playing") return null;
  if (role !== "host" && role !== "guest") return null;
  if (typeof format !== "string" || !FORMATS.has(format)) return null;
  return { slug, state, role, format: format as ActiveDuel["format"] };
}

/** Pages that must keep working while a game runs: auth, sign-out, API, static assets, dev previews. */
const EXEMPT_PREFIXES = [
  "/api", "/_next", "/sign-in", "/sign-up", "/sso-callback", "/login", "/access", "/welcome-back", "/monitoring", "/dev",
];

function stripTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function isExemptPath(pathname: string): boolean {
  return EXEMPT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    || pathname === "/favicon.ico" || pathname === "/icon.svg" || pathname === "/apple-icon.png" || pathname.startsWith("/icons/");
}

/** The room page of one duel. */
export function activeRoomPath(slug: string): string {
  return `/duels/${encodeURIComponent(slug)}`;
}

/** The slug when `pathname` is a duel room page (or a page below it), else null. */
export function duelSlugFromPath(pathname: string): string | null {
  const match = /^\/duels\/([^/]+)(?:\/|$)/.exec(stripTrailingSlash(pathname));
  if (!match) return null;
  const slug = match[1]!;
  // `new` and `dev-presets` are pages of their own, not rooms.
  if (slug === "new" || slug === "dev-presets") return null;
  try { return decodeURIComponent(slug); } catch { return slug; }
}

/**
 * Where to send the player, or null to leave the page alone. Only a game in progress pulls the player back;
 * a lobby has its own leave warning. The duel's own room (and pages below it) stay reachable.
 */
export function activeGameRedirect(pathname: string, active: ActiveDuel | null): string | null {
  if (!active || active.state !== "playing") return null;
  const path = stripTrailingSlash(pathname);
  if (isExemptPath(path)) return null;
  if (duelSlugFromPath(path) === active.slug) return null;
  return activeRoomPath(active.slug);
}

export type ActiveGameChecker = {
  /** `fresh` skips the short cache; use it after leaving a duel room. */
  get(options?: { fresh?: boolean }): Promise<ActiveDuel | null>;
  invalidate(): void;
};

/**
 * Asks the server which duel the player is in. The answer is cached for `ttlMs` and a request already on its way
 * is shared. A failed request is "no active duel" (never trap a player behind an outage) and is not cached.
 */
export function createActiveGameChecker({
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
  ttlMs = 5000,
}: {
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  ttlMs?: number;
} = {}): ActiveGameChecker {
  let cached: { value: ActiveDuel | null; at: number } | null = null;
  let inFlight: Promise<ActiveDuel | null> | null = null;
  let generation = 0;

  async function read(mine: number): Promise<ActiveDuel | null> {
    try {
      const response = await fetchImpl(ACTIVE_GAME_URL, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) return null;
      const value = parseActiveDuel(await response.json());
      if (mine === generation) cached = { value, at: now() };
      return value;
    } catch {
      return null;
    }
  }

  function load(): Promise<ActiveDuel | null> {
    const request: Promise<ActiveDuel | null> = read(++generation).finally(() => {
      if (inFlight === request) inFlight = null;
    });
    inFlight = request;
    return request;
  }

  return {
    get({ fresh = false } = {}) {
      if (!fresh && cached && now() - cached.at < ttlMs) return Promise.resolve(cached.value);
      // A fresh read never reuses a request that started before it was asked for.
      if (!fresh && inFlight) return inFlight;
      return load();
    },
    invalidate() {
      cached = null;
      inFlight = null;
      generation += 1;
    },
  };
}
