import { buildIssueBody, issueTitle, redactText, type IssueBodyInput } from "./bug-report";

const DEFAULT_REPO = "imran443/yugioh-bot";
const ISSUE_LABELS = ["bug", "needs-triage", "from-app"];
const TIMEOUT_MS = 10_000;

export type IssueResult =
  | { ok: true; number: number; url: string }
  | { ok: false; error: string };

/** The repo to file issues in. A value that is not `owner/name` falls back to the default. */
export function bugReportRepo(): string {
  const configured = process.env.BUG_REPORT_GITHUB_REPO?.trim();
  return configured && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(configured) ? configured : DEFAULT_REPO;
}

/**
 * Opens one GitHub issue for a saved report. Never throws: a missing token, a network error or a GitHub refusal comes
 * back as `{ ok: false, error }` so the report stays saved. The error text never holds the token. If GitHub refuses the
 * labels (422 or 403), the issue is sent once more without them.
 */
export async function createGithubIssue(input: IssueBodyInput, redact: readonly string[]): Promise<IssueResult> {
  const token = process.env.BUG_REPORT_GITHUB_TOKEN?.trim();
  if (!token) return { ok: false, error: "BUG_REPORT_GITHUB_TOKEN is not set" };
  const url = `https://api.github.com/repos/${bugReportRepo()}/issues`;
  const title = redactText(issueTitle(input.description, input.context), redact);
  const body = buildIssueBody(input, redact);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const scrub = (text: string) => text.split(token).join("[token]").slice(0, 300);

  async function post(labels: string[] | null): Promise<Response> {
    return fetch(url, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "duelists-kingdom-bug-reports",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, body, ...(labels ? { labels } : {}) }),
    });
  }

  try {
    let response = await post(ISSUE_LABELS);
    if (response.status === 422 || response.status === 403) response = await post(null);
    if (!response.ok) {
      const detail = await response.json().then((json: unknown) =>
        json && typeof json === "object" && "message" in json && typeof json.message === "string" ? json.message : "", () => "");
      return { ok: false, error: scrub(`GitHub answered ${response.status}${detail ? `: ${detail}` : ""}`) };
    }
    const issue = (await response.json()) as { number?: unknown; html_url?: unknown };
    if (typeof issue.number !== "number" || typeof issue.html_url !== "string") {
      return { ok: false, error: "GitHub answered without an issue number" };
    }
    return { ok: true, number: issue.number, url: issue.html_url };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, error: timedOut ? "GitHub did not answer within 10 seconds" : scrub(`GitHub request failed: ${error instanceof Error ? error.message : "unknown error"}`) };
  }
}
