import { NextResponse } from "next/server";

/** Replay JSON is highly repetitive. Compress as a stream to avoid a second full response buffer.
 * Authorization and metadata redaction must finish before calling this helper.
 */
export function replayResponse(data: unknown, request: Request): NextResponse {
  const response = NextResponse.json(data, { headers: { "cache-control": "private, no-store", vary: "Accept-Encoding" } });
  const gzip = request.headers.get("accept-encoding")?.split(",").some(value => {
    const [name, ...parameters] = value.trim().toLowerCase().split(";");
    const quality = parameters.map(parameter => parameter.trim()).find(parameter => parameter.startsWith("q="));
    return name.trim() === "gzip" && (quality === undefined || Number(quality.slice(2)) > 0);
  });
  if (!gzip || !response.body) return response;
  response.headers.set("content-encoding", "gzip");
  return new NextResponse(response.body.pipeThrough(new CompressionStream("gzip")), { headers: response.headers });
}
