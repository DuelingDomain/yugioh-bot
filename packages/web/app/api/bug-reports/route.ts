import { NextResponse } from "next/server";
import { BugReportServiceError, createBugReportService, createDuelService, createPlayerService } from "@yugidraft/shared/services";
import { webBaseUrl } from "@/lib/announce-bot";
import { parseBugReportRequest } from "@/lib/bug-report";
import { bugReportRepo, commentOnIssue, createGithubIssue, getOpenFromAppIssue } from "@/lib/bug-report-github";
import { buildReportContext } from "@/lib/bug-reports/server-context";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { requireWebAccess } from "@/lib/web-access";

export const runtime = "nodejs";

/**
 * Saves a bug report and opens a GitHub issue for it. The full report (with the reporter's player id) stays in the
 * database. The public issue gets only the report id and the public context. A GitHub failure never loses the report:
 * the answer is still 200 with `issue: null`.
 *
 * With `duplicateOf` the player said an open issue is the same bug. The report is saved and linked to that issue and a
 * "+1" comment (the same public context) is added to it: no new issue. The issue must be open and filed by the app.
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
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, ...(parsed.fieldErrors ? { fieldErrors: parsed.fieldErrors } : {}) }, { status: 400 });
  const report = parsed.value;

  const db = getDb();
  const player = createPlayerService(db).findOrCreate(guildId, actor.userId, actor.userName);
  const reports = createBugReportService(db);

  // Check the target before anything is saved, so a refused +1 costs the player nothing.
  let target: { number: number; url: string; verified: boolean } | null = null;
  if (report.duplicateOf !== undefined) {
    const checked = await getOpenFromAppIssue(report.duplicateOf);
    if (checked.ok) target = { number: checked.issue.number, url: checked.issue.url, verified: true };
    else if (checked.reason === "unavailable" && reports.ownsIssue(guildId, report.duplicateOf)) {
      // GitHub cannot be asked (no token, or it failed): accept only an issue one of our reports opened, and do not comment.
      target = { number: report.duplicateOf, url: `https://github.com/${bugReportRepo()}/issues/${report.duplicateOf}`, verified: false };
    } else {
      return NextResponse.json({ error: "That issue is not open for reports. Send your report as a new one." }, { status: 409 });
    }
  }

  // The duel facts and the log come from the server, never from the browser's copy.
  report.context = await buildReportContext({ guildId, playerId: player.id, duels: createDuelService(db), duelSlug: report.duelSlug, client: report.context });

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
      duplicateOf: target?.number ?? null,
    });
  } catch (error) {
    if (error instanceof BugReportServiceError) {
      const headers = error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined;
      return NextResponse.json({ error: error.message }, { status: error.status, headers });
    }
    console.error("[api/bug-reports] save failed", error);
    return NextResponse.json({ error: "Could not save the report" }, { status: 500 });
  }

  const issueInput = {
    reportId: saved.id,
    description: saved.description,
    expected: saved.expected,
    path: saved.path,
    duelSlug: saved.duelSlug,
    context: report.context,
    baseUrl: webBaseUrl(request),
  };
  // Removed from the text the player wrote (not from the whole issue): the Discord id, the session name, the stored
  // display name and the guild id. Bare "Unknown" and values under 3 characters are skipped by `redactText`.
  const redact = [actor.userId, actor.userName, player.displayName, guildId];

  if (target) {
    reports.recordIssue(saved.id, guildId, { number: target.number, url: target.url });
    const commented = target.verified ? await commentOnIssue(target.number, issueInput, redact) : { ok: false as const, error: "GitHub could not check the issue, so no comment was added" };
    if (!commented.ok) {
      reports.recordIssueError(saved.id, guildId, commented.error);
      console.warn(`[api/bug-reports] report ${saved.id} saved as +1 for #${target.number} without a comment: ${commented.error}`);
    }
    return NextResponse.json({ id: saved.id, issue: { number: target.number, url: target.url }, duplicate: true });
  }

  const issue = await createGithubIssue(issueInput, redact);
  if (issue.ok) {
    reports.recordIssue(saved.id, guildId, { number: issue.number, url: issue.url });
    return NextResponse.json({ id: saved.id, issue: { number: issue.number, url: issue.url } });
  }
  reports.recordIssueError(saved.id, guildId, issue.error);
  console.warn(`[api/bug-reports] report ${saved.id} saved without an issue: ${issue.error}`);
  return NextResponse.json({ id: saved.id, issue: null });
}
