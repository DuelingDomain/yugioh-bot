import { NextResponse } from "next/server";
import { createBugReportService, type BugReport } from "@yugidraft/shared/services";
import { parseBugReportRequest } from "@/lib/bug-report";
import { bugReportRepo, listOpenFromAppIssues } from "@/lib/bug-report-github";
import { candidateFromRow, isSameDuelMoment, takePrecheckSlot } from "@/lib/bug-reports/precheck";
import { matchKnownLimits } from "@/lib/bug-reports/known-limits";
import { formatFromTitle, rankCandidates, type DuplicateCandidate } from "@/lib/bug-reports/similarity";
import { readJsonBody } from "@/lib/bug-reports/read-body";
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

  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const raw = read.value;
  const parsed = parseBugReportRequest(raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, ...(parsed.fieldErrors ? { fieldErrors: parsed.fieldErrors } : {}) }, { status: 400 });
  const report = parsed.value;
  const text = `${report.description}\n${report.expected}`;
  const format = report.context.format;

  const knownLimits = matchKnownLimits(text, { format, duelMode: report.context.duelMode });

  const db = getDb();
  // A read only look-up: a player with no row has no reports, and a check must not create the row. -1 matches no player.
  const playerId = (db.prepare("select id from players where guild_id = ? and user_id = ?").get(guildId, actor.userId) as { id: number } | undefined)?.id ?? -1;
  const reports = createBugReportService(db);
  const sameDuelRows: BugReport[] = report.duelSlug
    ? reports.listWithIssueInDuel(guildId, report.duelSlug, playerId).filter((row) => isSameDuelMoment(row, { turn: report.context.turn }))
    : [];
  const sameDuelNumbers = new Set(sameDuelRows.map((row) => row.githubIssueNumber!));

  const owner = db.prepare("select u.discord_user_id, p.display_name from players p join users u on u.id = p.user_id where p.id = ?");
  const redactFor = (row: BugReport) => {
    const who = owner.get(row.playerId) as { discord_user_id?: string | null; display_name?: string } | undefined;
    return [who?.discord_user_id ?? "", who?.display_name ?? "", guildId];
  };
  const fromRow = (row: BugReport, sameDuel: boolean): DuplicateCandidate => ({
    ...candidateFromRow(row, `https://github.com/${bugReportRepo()}/issues/${row.githubIssueNumber}`, redactFor(row)),
    sameDuel,
  });

  let candidates: DuplicateCandidate[];
  const open = await listOpenFromAppIssues();
  if (open.ok) {
    // Only issues GitHub shows as open: a same-duel issue that was closed since is simply not in the list.
    candidates = open.issues.map((issue) => ({ ...issue, format: formatFromTitle(issue.title), sameDuel: sameDuelNumbers.has(issue.number) }));
  } else {
    console.warn(`[api/bug-reports/precheck] issue lookup failed: ${open.error}`);
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
