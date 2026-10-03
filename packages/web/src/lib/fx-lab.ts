/**
 * The FX lab (/dev/fx-lab) is a review page for the duel animations, and /dev/table-preview shows the multiplayer
 * table on fixtures. Both are off in production: it
 * opens only when DUEL_FX_LAB=1 is set in the web server's environment (read at request time), or
 * in `next dev`. The auth callback uses the same switch to let the page and the card art through
 * without a login.
 */
export function fxLabEnabled(): boolean {
  return process.env.DUEL_FX_LAB === "1" || process.env.NODE_ENV === "development";
}

/**
 * Paths that need no login while the lab is on: the lab page, the multiplayer table preview (/dev/table-preview
 * and the pages under it) and the card art route.
 */
export function isFxLabPublicPath(pathname: string): boolean {
  return (
    pathname === "/dev/fx-lab" ||
    pathname === "/dev/table-preview" ||
    pathname.startsWith("/dev/table-preview/") ||
    /^\/api\/cards\/\d+\/image$/.test(pathname)
  );
}
