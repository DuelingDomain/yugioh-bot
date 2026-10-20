import { NextResponse } from "next/server";
import { BugReportServiceError, createBugReportService } from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";
import { requireReportOwner, reportCursor, REPORT_PRIVATE_HEADERS } from "@/lib/bug-reports/owner-access";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireReportOwner();
  if (!access.ok) return access.response;
  const id = reportCursor((await params).id);
  if (!id) return NextResponse.json({ error: "Report not found" }, { status: 404, headers: REPORT_PRIVATE_HEADERS });
  try {
    const report = createBugReportService(getDb()).get(id, access.guildId);
    return NextResponse.json(report, { headers: REPORT_PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof BugReportServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: REPORT_PRIVATE_HEADERS });
    }
    throw error;
  }
}
