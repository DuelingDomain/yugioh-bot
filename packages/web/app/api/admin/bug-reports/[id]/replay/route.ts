import { NextResponse } from "next/server";
import { createBugReportService, BugReportServiceError } from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";
import { requireReplayOwnerActor } from "@/lib/replay-fork-access";
import { reportCursor, REPORT_PRIVATE_HEADERS } from "@/lib/bug-reports/owner-access";
import { callDuelHost } from "@/lib/duel-host";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireReplayOwnerActor();
  if (!actor.ok) return actor.response;
  const id = reportCursor((await params).id);
  if (!id) return NextResponse.json({ error: "Report not found" }, { status: 404, headers: REPORT_PRIVATE_HEADERS });
  try {
    const report = createBugReportService(getDb()).get(id, actor.guildId);
    if (!report.duelSlug) return NextResponse.json({ error: "This report has no duel" }, { status: 409, headers: REPORT_PRIVATE_HEADERS });
    const result = await callDuelHost({ op: "bug-replay-frame", slug: report.duelSlug, reportId: id,
      guildId: actor.guildId, playerId: actor.playerId, userId: actor.userId });
    if (!result.ok) return result.response;
    // Owner access can change during a detached replay build.
    const current = await requireReplayOwnerActor();
    if (!current.ok) return current.response;
    if (current.userId !== actor.userId || current.guildId !== actor.guildId || current.playerId !== actor.playerId) {
      return NextResponse.json({ error: "Access changed" }, { status: 404, headers: REPORT_PRIVATE_HEADERS });
    }
    const data = result.data as { href: string; frameId: string };
    if (new URL(request.url).searchParams.get("json") === "1") return NextResponse.json(data, { headers: REPORT_PRIVATE_HEADERS });
    return new NextResponse(null, { status: 303, headers: { ...REPORT_PRIVATE_HEADERS, Location: data.href } });
  } catch (error) {
    if (error instanceof BugReportServiceError) return NextResponse.json({ error: error.message }, { status: error.status, headers: REPORT_PRIVATE_HEADERS });
    throw error;
  }
}
