import { NextResponse } from "next/server";
import { BugReportServiceError, createBugReportService } from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";
import { requireReportOwner, reportCursor, REPORT_PRIVATE_HEADERS } from "@/lib/bug-reports/owner-access";
import type { DuelDeck } from "@yugidraft/shared/duels";

export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireReportOwner();
  if (!access.ok) return access.response;
  const id = reportCursor((await params).id);
  if (!id) return NextResponse.json({ error: "Report not found" }, { status: 404, headers: REPORT_PRIVATE_HEADERS });
  try {
    const report = createBugReportService(getDb()).get(id, access.guildId);
    const capture = (report.diagnostics as { deck?: { deck?: DuelDeck } } | null)?.deck;
    if (!capture?.deck) return NextResponse.json({ error: "No saved deck" }, { status: 404, headers: REPORT_PRIVATE_HEADERS });
    const deck = capture.deck;
    const text = ["#created by private bug report", "#main", ...deck.main, "#extra", ...deck.extra, "!side", ...deck.side,
      ...(deck.deckMaster ? ["#deckmaster", deck.deckMaster] : [])].join("\n") + "\n";
    return new NextResponse(text, { headers: { ...REPORT_PRIVATE_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="report-${id}.ydk"` } });
  } catch (error) {
    if (error instanceof BugReportServiceError) return NextResponse.json({ error: error.message }, { status: error.status, headers: REPORT_PRIVATE_HEADERS });
    throw error;
  }
}
