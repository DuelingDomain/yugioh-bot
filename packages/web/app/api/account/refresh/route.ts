import { resolveSessionIdentity } from "@/lib/session-identity";
export async function POST() {
  const result = await resolveSessionIdentity({ forceSync: true });
  const headers = { "Cache-Control": "no-store" };
  if (!result.ok) return Response.json({ error: result.status === 401 ? "unauthorized" : "session_unavailable" }, { status: result.status, headers });
  return Response.json({ user: { id: String(result.identity.userId) }, conflict: result.identity.conflict }, { headers });
}
