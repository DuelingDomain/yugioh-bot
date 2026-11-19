export const DEFAULT_RETURN = "/dashboard";
export const TOURNAMENT_BRIDGE_START = "/api/tournament-bridge/start";
const RETURN_ORIGIN = "https://return.invalid";

export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return DEFAULT_RETURN;
  try {
    // Check decoded characters too: browsers normalize slashes and dot segments.
    const decoded = decodeURIComponent(value);
    if (/^\/\/|\\|[\u0000-\u001f\u007f]/.test(decoded)) return DEFAULT_RETURN;
    for (const path of [value, decoded]) {
      const url = new URL(path, RETURN_ORIGIN);
      if (url.origin !== RETURN_ORIGIN || url.pathname.startsWith("//") || /^\/(sign-in|sign-up|sso-callback)/.test(url.pathname)) return DEFAULT_RETURN;
    }
    return value;
  } catch {
    return DEFAULT_RETURN;
  }
}

export function isTournamentBridgeReturn(value: unknown): boolean {
  return new URL(safeReturnPath(value), RETURN_ORIGIN).pathname === TOURNAMENT_BRIDGE_START;
}

/** Replay the bridge destination after Discord even when sessionStorage is unavailable. */
export function ssoCallbackPath(returnTo: string): string {
  return isTournamentBridgeReturn(returnTo)
    ? `/sso-callback?${new URLSearchParams({ redirect_url: returnTo })}`
    : "/sso-callback";
}

export function existingPlayerStartPath(returnTo: string): string {
  return `/api/auth/existing-player/start?${new URLSearchParams({ redirect_url: returnTo })}`;
}
