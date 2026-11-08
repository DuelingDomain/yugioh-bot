import { NextResponse } from "next/server";

/** Plain JSON. Do not compress in the route: since Next 16.4.5, sendResponse drops content-encoding from route
 * responses, so a body gzipped here reaches the browser as gzip bytes labelled as JSON. Next's `compress` middleware
 * does not gzip route responses either (its headers arrive as arrays), so compression must come from a proxy.
 * Authorization and metadata redaction must finish before calling this helper.
 */
export function replayResponse(data: unknown): NextResponse {
  return NextResponse.json(data, { headers: { "cache-control": "private, no-store", vary: "Accept-Encoding" } });
}
