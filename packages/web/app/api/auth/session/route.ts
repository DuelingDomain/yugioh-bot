import { auth, SessionUnavailableError } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json(await auth(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { if (!(error instanceof SessionUnavailableError)) throw error; return Response.json({ error: "session_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
