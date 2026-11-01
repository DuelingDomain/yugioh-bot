import { getDb } from "@/lib/db";
import { isOwnerUser } from "@/lib/owner-access";
import { requireWebAccess } from "@/lib/web-access";
import { identifyRemoteVisionCard, readRemoteVisionAIRequest, RemoteVisionAIError, takeRemoteVisionAISlot } from "@/lib/remote-vision-ai";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!isOwnerUser(actor.userId) || process.env.REMOTE_VISION_AI !== "1" || !apiKey) {
    return Response.json({ error: "not_found" }, { status: 404, headers });
  }
  const input = await readRemoteVisionAIRequest(request);
  if (!input.ok) return input.response;
  try {
    const db = getDb();
    const retryAfter = takeRemoteVisionAISlot(db, actor.userId);
    if (retryAfter !== null) return Response.json({ error: "rate_limited" }, { status: 429, headers: { ...headers, "Retry-After": String(retryAfter) } });
    return Response.json(await identifyRemoteVisionCard(db, input.value.jpegBase64, apiKey, input.value.candidateNames), { headers });
  } catch (error) {
    // Provider/decoder errors may echo private image data; never log them.
    const status = error instanceof RemoteVisionAIError ? error.status : 503;
    return Response.json({ error: status === 504 ? "ai_timeout" : "ai_unavailable" }, { status, headers });
  }
}
