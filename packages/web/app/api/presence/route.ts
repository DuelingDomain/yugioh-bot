import { isPresenceRoute, recordPresence } from "@yugidraft/shared/presence";
import { requireWebAccess } from "@/lib/web-access";
import { getDb } from "@/lib/db";
import { webOrigin } from "@/lib/web-origin";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const bad = { status: 400, headers };

/** Heartbeat from signed-in pages: keeps only the caller's latest route template and time. */
export async function POST(request: Request): Promise<Response> {
  const access = await requireWebAccess();
  if (!access.ok) return access.response;
  if (process.env.PRESENCE_ENABLED === "0") return new Response(null, { status: 204, headers });
  let origin: string | null = null;
  try { origin = webOrigin(); } catch { /* WEB_URL missing: fall through to the refusal. */ }
  if (!origin || request.headers.get("origin") !== origin) return Response.json({ error: "invalid_origin" }, { status: 403, headers });
  // Small fixed payload; read a bounded stream even without a Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "invalid_route" }, bad);
  try {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 256) { await reader.cancel(); return Response.json({ error: "invalid_route" }, bad); }
      chunks.push(value);
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!isPresenceRoute(payload?.route)) return Response.json({ error: "invalid_route" }, bad);
    if (!recordPresence(getDb(), access.userId, access.userName, payload.route)) {
      return Response.json({ error: "rate_limited" }, { status: 429, headers: { ...headers, "Retry-After": "30" } });
    }
    return new Response(null, { status: 204, headers });
  } catch { return Response.json({ error: "invalid_route" }, bad); }
  finally { reader.releaseLock(); }
}
