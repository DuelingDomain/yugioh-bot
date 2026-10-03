import { NextResponse } from "next/server";
import { createBugReportService, createPlayerService, type BugReport } from "@yugidraft/shared/services";
import { parseBugReportRequest } from "@/lib/bug-report";
import { listOpenFromAppIssues } from "@/lib/bug-report-github";
import { candidateFromRow, isSameDuelMoment, takePrecheckSlot } from "@/lib/bug-reports/precheck";
import { matchKnownLimits } from "@/lib/bug-reports/known-limits";
import { formatFromTitle, rankCandidates, type DuplicateCandidate } from "@/lib/bug-reports/similarity";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { requireWebAccess } from "@/lib/web-access";

export const runtime = "nodejs";

/**
 * Runs before the player sends a report. Answers with the known problems the text matches and the open issues that look
 * like the same bug (at most 3). It only reads: nothing is saved and nothing is sent to GitHub. With no GitHub token, or
 * when GitHub fails, the candidates come from saved reports that own an issue.
 */
export async function POST(request: Request) {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;
  const guildId = env.discordGuildId;
  if (!guildId) return NextResponse.json({ error: "Guild is not configured" }, { status: 500 });

  const slot = takePrecheckSlot(`${guildId}:${actor.userId}`);
  if (!slot.ok) {
    return NextResponse.json({ error: "Too many checks. Try again soon." }, { status: 429, headers: { "Retry-After": String(slot.retryAfterSeconds) } });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const parsed = parseBugReportRequest(raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, ...(parsed.fieldErrors ? { fieldErrors: parsed.fieldErrors } : {}) }, { status: 400 });
  const report = parsed.value;
  const text = `${report.description}\n${report.expected}`;
  const format = report.context.format;

  const knownLimits = matchKnownLimits(text, { format, duelMode: report.context.duelMode });

  const db = getDb();
  const player = createPlayerService(db).findOrCreate(guildId, actor.userId, actor.userName);
  const reports = createBugReportService(db);
  const sameDuelRows: BugReport[] = report.duelSlug
    ? reports.listWithIssueInDuel(guildId, report.duelSlug, player.id).filter((row) => isSameDuelMoment(row, { turn: report.context.turn }))
    : [];
  const sameDuelNumbers = new Set(sameDuelRows.map((row) => row.githubIssueNumber!));

  const owner = db.prepare("select discord_user_id, display_name from players where id = ?");
  const redactFor = (row: BugReport) => {
    const who = owner.get(row.playerId) as { discord_user_id?: string; display_name?: string } | undefined;
    return [who?.discord_user_id ?? "", who?.display_name ?? "", guildId];
  };
  const fromRow = (row: BugReport, sameDuel: boolean): DuplicateCandidate => ({
    ...candidateFromRow(row, row.githubIssueUrl!, redactFor(row)),
    sameDuel,
  });

  let candidates: DuplicateCandidate[];
  const open = await listOpenFromAppIssues();
  if (open.ok) {
    // Only issues GitHub shows as open: a same-duel issue that was closed since is simply not in the list.
    candidates = open.issues.map((issue) => ({ ...issue, format: formatFromTitle(issue.title), sameDuel: sameDuelNumbers.has(issue.number) }));
  } else {
    candidates = reports.listWithIssue(guildId).map((row) => fromRow(row, sameDuelNumbers.has(row.githubIssueNumber!)));
    // A same-duel report can be older than the newest rows that were listed.
    for (const row of sameDuelRows) {
      if (!candidates.some((c) => c.number === row.githubIssueNumber)) candidates.push(fromRow(row, true));
    }
  }

  const duplicates = rankCandidates({ text, format }, candidates).map((c) => ({
    number: c.number,
    url: c.url,
    title: c.title,
    sameDuel: c.sameDuel === true,
    score: Math.round(c.score * 100) / 100,
  }));
  return NextResponse.json({ knownLimits, duplicates });
}
