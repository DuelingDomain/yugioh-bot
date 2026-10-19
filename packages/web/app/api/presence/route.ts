import { isPresenceRoute, recordPresence } from "@yugidraft/shared/presence";
import { waitlistActionOrigin } from "@yugidraft/shared/notify";
import { requireWebAccess } from "@/lib/web-access";
import { getDb } from "@/lib/db";

const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request): Promise<Response> {
  const access = await requireWebAccess();
  if (!access.ok) return access.response;
  if (process.env.DISCORD_ONLINE_STATUS_ENABLED !== "1") return new Response(null, { status: 204, headers });
  if (request.headers.get("origin") !== waitlistActionOrigin()) return Response.json({ error: "invalid_origin" }, { status: 403, headers });
  // Small fixed payload; read a bounded stream even without a Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "invalid_route" }, { status: 400, headers });
  try {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 256) { await reader.cancel(); return Response.json({ error: "invalid_route" }, { status: 400, headers }); }
      chunks.push(value);
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!isPresenceRoute(payload?.route)) return Response.json({ error: "invalid_route" }, { status: 400, headers });
    if (!recordPresence(getDb(), access.userId, payload.route)) return Response.json({ error: "rate_limited" }, { status: 429, headers: { ...headers, "Retry-After": "30" } });
    return new Response(null, { status: 204, headers });
  } catch { return Response.json({ error: "invalid_route" }, { status: 400, headers }); }
  finally { reader.releaseLock(); }
}
export const runtime = "nodejs";
