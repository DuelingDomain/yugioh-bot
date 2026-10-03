import { NextResponse } from "next/server";
import { BugReportServiceError, createBugReportService, createPlayerService } from "@yugidraft/shared/services";
import { webBaseUrl } from "@/lib/announce-bot";
import { parseBugReportRequest } from "@/lib/bug-report";
import { createGithubIssue } from "@/lib/bug-report-github";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { requireWebAccess } from "@/lib/web-access";

export const runtime = "nodejs";

/**
 * Saves a bug report and opens a GitHub issue for it. The full report (with the reporter's player id) stays in the
 * database. The public issue gets only the report id and the public context. A GitHub failure never loses the report:
 * the answer is still 200 with `issue: null`.
 */
export async function POST(request: Request) {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;
  const guildId = env.discordGuildId;
  if (!guildId) return NextResponse.json({ error: "Guild is not configured" }, { status: 500 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const parsed = parseBugReportRequest(raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const report = parsed.value;

  const db = getDb();
  const player = createPlayerService(db).findOrCreate(guildId, actor.userId, actor.userName);
  const reports = createBugReportService(db);
  let saved;
  try {
    saved = reports.create({
      guildId,
      playerId: player.id,
      path: report.path,
      duelSlug: report.duelSlug ?? null,
      description: report.description,
      expected: report.expected ?? null,
      context: report.context,
    });
  } catch (error) {
    if (error instanceof BugReportServiceError) {
      const headers = error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined;
      return NextResponse.json({ error: error.message }, { status: error.status, headers });
    }
    console.error("[api/bug-reports] save failed", error);
    return NextResponse.json({ error: "Could not save the report" }, { status: 500 });
  }

  const issue = await createGithubIssue(
    {
      reportId: saved.id,
      description: saved.description,
      expected: saved.expected,
      path: saved.path,
      duelSlug: saved.duelSlug,
      context: report.context,
      baseUrl: webBaseUrl(request),
    },
    // Last line of defence: nothing that names the reporter or the guild may reach the public issue.
    [actor.userId, actor.userName, guildId],
  );
  if (issue.ok) {
    reports.recordIssue(saved.id, guildId, { number: issue.number, url: issue.url });
    return NextResponse.json({ id: saved.id, issue: { number: issue.number, url: issue.url } });
  }
  reports.recordIssueError(saved.id, guildId, issue.error);
  console.warn(`[api/bug-reports] report ${saved.id} saved without an issue: ${issue.error}`);
  return NextResponse.json({ id: saved.id, issue: null });
}
