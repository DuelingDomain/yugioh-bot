import { NextResponse } from "next/server";

/**
 * Archetype bridges (the Bridges tab, the "See bridges" offer in the Cards search and POST /api/cards/bridges/*)
 * are off unless BRIDGES_ENABLED=1 is set in the web server's environment (read at request time). Only the server
 * reads it: the app layout hands the answer to the page, so no NEXT_PUBLIC variable is involved.
 */
export function bridgesEnabled(): boolean {
  return process.env.BRIDGES_ENABLED === "1";
}

/** What every bridges route answers while the flag is off: as if the route were not there. */
export function bridgesOffResponse(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "cache-control": "private, no-store" } });
}
