import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createBugReportService } from "@yugidraft/shared/services";
import { SheetRoot } from "@/components/sheet";
import { getDb } from "@/lib/db";
import { requireReportOwner, reportCursor } from "@/lib/bug-reports/owner-access";

export const metadata = { title: "Bug reports" };
export const dynamic = "force-dynamic";

export default async function BugReportsPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const access = await requireReportOwner();
  if (!access.ok) {
    if (access.response.status === 401) redirect("/sign-in");
    if (access.response.status === 403) notFound();
    return <SheetRoot><p role="alert">Reports are unavailable. Try again later.</p></SheetRoot>;
  }
  const before = reportCursor((await searchParams).before);
  const reports = createBugReportService(getDb()).list(access.guildId, before, 51);
  const hasMore = reports.length > 50;
  const page = reports.slice(0, 50);
  return (
    <SheetRoot>
      <header className="page-h sheet-head">
        <div><h1 className="t-title">Bug reports</h1><p className="page-sub">Submitter details and saved duel data. Owner access only.</p></div>
      </header>
      {page.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Saved bug reports, newest first</caption>
            <thead><tr>{["Report", "Submitter", "Sent at (UTC)", "Duel", "GitHub", "Saved data"].map(label => <th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead>
            <tbody>{page.map(report => (
              <tr key={report.id} className="border-t border-border align-top">
                <th scope="row" className="p-3 font-medium">Report #{report.publicId}</th>
                <td className="p-3">
                  <div>{report.submitter.username}</div>
                  <div className="text-xs text-text-secondary">User {report.submitter.userId}</div>
                  <div className="text-xs text-text-secondary">{report.submitter.email ?? "Email unknown"}</div>
                </td>
                <td className="p-3"><time dateTime={report.createdAt}>{report.createdAt.replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}</time></td>
                <td className="p-3">{report.duelSlug ? <Link className="underline" href={`/duels/${encodeURIComponent(report.duelSlug)}/replay`}>Open duel</Link> : "No duel"}</td>
                <td className="p-3">
                  {report.githubIssueUrl ? <a className="underline" href={report.githubIssueUrl} target="_blank" rel="noreferrer">Issue #{report.githubIssueNumber}</a> : "Issue unavailable"}
                  {report.githubError ? <p className="text-xs text-text-secondary">{report.githubError}</p> : null}
                </td>
                <td className="p-3"><a className="underline" href={`/api/admin/bug-reports/${report.id}`} target="_blank" rel="noreferrer">Board and log (JSON)</a></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="p-3 text-sm text-text-secondary">No reports.</p>}
      <nav aria-label="Report pages" className="flex gap-4 p-3 text-sm">
        {before ? <Link className="underline" href="/settings/bug-reports">Newest reports</Link> : null}
        {hasMore ? <Link className="underline" href={`/settings/bug-reports?before=${page.at(-1)!.id}`}>Older reports</Link> : null}
      </nav>
    </SheetRoot>
  );
}
