/**
 * The FX lab (/dev/fx-lab) is a review page for the duel animations. It is off in production: it
 * opens only when DUEL_FX_LAB=1 is set in the web server's environment (read at request time), or
 * in `next dev`. The auth callback uses the same switch to let the page and the card art through
 * without a login.
 */
export function fxLabEnabled(): boolean {
  return process.env.DUEL_FX_LAB === "1" || process.env.NODE_ENV === "development";
}

/** Paths that need no login while the lab is on: the page itself and the card art route. */
export function isFxLabPublicPath(pathname: string): boolean {
  return pathname === "/dev/fx-lab" || /^\/api\/cards\/\d+\/image$/.test(pathname);
}
