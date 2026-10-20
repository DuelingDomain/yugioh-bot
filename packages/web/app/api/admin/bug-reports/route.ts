import { NextResponse } from "next/server";
import { createBugReportService } from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";
import { requireReportOwner, reportCursor, REPORT_PRIVATE_HEADERS } from "@/lib/bug-reports/owner-access";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const access = await requireReportOwner();
  if (!access.ok) return access.response;
  const before = reportCursor(new URL(request.url).searchParams.get("before"));
  const reports = createBugReportService(getDb()).list(access.guildId, before, 51);
  const hasMore = reports.length > 50;
  const page = reports.slice(0, 50);
  return NextResponse.json({ reports: page, next: hasMore ? page.at(-1)!.id : null }, { headers: REPORT_PRIVATE_HEADERS });
}
