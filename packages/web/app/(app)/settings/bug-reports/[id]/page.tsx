import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BugReportServiceError, createBugReportService } from "@yugidraft/shared/services";
import { SheetRoot } from "@/components/sheet";
import { getDb } from "@/lib/db";
import { requireReportOwner, reportCursor } from "@/lib/bug-reports/owner-access";

export const dynamic = "force-dynamic";
export default async function BugReportPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireReportOwner();
  if (!access.ok) {
    if (access.response.status === 401) redirect("/sign-in");
    if (access.response.status === 403) notFound();
    return <SheetRoot><p role="alert">Reports are unavailable.</p></SheetRoot>;
  }
  const id = reportCursor((await params).id);
  if (!id) notFound();
  let report;
  try { report = createBugReportService(getDb()).get(id, access.guildId); }
  catch (error) { if (error instanceof BugReportServiceError && error.status === 404) notFound(); throw error; }
  const capture = report.diagnostics as { moment?: unknown; deck?: { id?: number; format?: string; source?: string; deck?: unknown } } | null;
  return <SheetRoot>
    <header className="page-h sheet-head"><div><h1 className="t-title">Report #{report.publicId}</h1><p className="page-sub">Owner access only</p></div></header>
    <div className="grid gap-4 p-4 text-sm">
      <Link className="underline" href="/settings/bug-reports">All reports</Link>
      <p>Submitter: {report.submitter?.username} · User {report.submitter?.userId} · {report.submitter?.email ?? "Email unknown"}</p>
      <p>Page: {report.path} · Sent at: {report.createdAt}</p>
      <p>{report.description}</p><p>Expected: {report.expected}</p>
      {report.duelSlug ? <div className="grid gap-2">
        <p>Duel: {report.duelSlug}</p>
        {capture?.moment ? <a className="underline" href={`/api/admin/bug-reports/${report.id}/replay`}>Open replay at this moment</a>
          : <Link className="underline" href={`/duels/${encodeURIComponent(report.duelSlug)}/replay`}>Open duel replay</Link>}
        <p>Replays and Jump in are available after the duel ends.</p>
      </div> : null}
      {capture?.deck ? <div><p>Deck: {capture.deck.id ?? "Unsaved"} · Format: {capture.deck.format ?? "Unknown"}</p>
        {capture.deck.deck ? <a className="underline" href={`/api/admin/bug-reports/${report.id}/deck`}>{capture.deck.source === "editor" ? "Deck in the editor at report time" : "Saved deck"} (.ydk)</a> : null}</div> : null}
      <h2 className="font-semibold">Context and versions</h2><pre className="overflow-auto whitespace-pre-wrap">{JSON.stringify({ context: report.context, moment: capture?.moment }, null, 2)}</pre>
      <details><summary>Board and full public log</summary><pre className="overflow-auto whitespace-pre-wrap">{JSON.stringify(report.diagnostics, null, 2)}</pre></details>
      <a className="underline" href={`/api/admin/bug-reports/${report.id}`}>All saved data (JSON)</a>
    </div>
  </SheetRoot>;
}
