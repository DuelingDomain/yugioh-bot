import { buildCommentBody, buildIssueBody, issueTitle, redactText, type IssueBodyInput } from "./bug-report";

const DEFAULT_REPO = "imran443/yugioh-bot";
const ISSUE_LABELS = ["bug", "needs-triage", "from-app"];
const TIMEOUT_MS = 10_000;

export type IssueResult =
  /** `warning`: the issue exists but is not as asked (for example the from-app label is missing); the route records it. */
  | { ok: true; number: number; url: string; warning?: string }
  | { ok: false; error: string };

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "duelists-kingdom-bug-reports",
    "Content-Type": "application/json",
  };
}

/** The repo to file issues in. A value that is not `owner/name` falls back to the default. */
export function bugReportRepo(): string {
  const configured = process.env.BUG_REPORT_GITHUB_REPO?.trim();
  return configured && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(configured) ? configured : DEFAULT_REPO;
}

function hasFromAppLabel(labels: unknown): boolean {
  return Array.isArray(labels) && labels.some((label) => (typeof label === "string" ? label : (label as { name?: unknown } | null)?.name) === "from-app");
}

/**
 * Opens one GitHub issue for a saved report. Never throws: a missing token, a network error or a GitHub refusal comes
 * back as `{ ok: false, error }` so the report stays saved. The error text never holds the token. If GitHub refuses the
 * labels (422), the issue is sent once more without them. A 403 is not retried: it is often a rate limit, and a second
 * call would only use more quota. The labels in the answer are checked: with no from-app label the issue is still
 * reported as made, with a `warning`, because duplicate checks only list issues that have that label.
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
      headers: githubHeaders(token!),
      body: JSON.stringify({ title, body, ...(labels ? { labels } : {}) }),
    });
  }

  try {
    let response = await post(ISSUE_LABELS);
    let retriedWithoutLabels = false;
    if (response.status === 422) {
      response = await post(null);
      retriedWithoutLabels = true;
    }
    if (!response.ok) {
      const detail = await response.json().then((json: unknown) =>
        json && typeof json === "object" && "message" in json && typeof json.message === "string" ? json.message : "", () => "");
      return { ok: false, error: scrub(`GitHub answered ${response.status}${detail ? `: ${detail}` : ""}`) };
    }
    const issue = (await response.json()) as { number?: unknown; html_url?: unknown; labels?: unknown };
    if (typeof issue.number !== "number" || typeof issue.html_url !== "string") {
      return { ok: false, error: "GitHub answered without an issue number" };
    }
    const warning = hasFromAppLabel(issue.labels)
      ? undefined
      : retriedWithoutLabels
        ? "GitHub refused the labels, so the issue was made without them (no from-app label)"
        : "The issue was made without the from-app label, so duplicate checks will not list it";
    return { ok: true, number: issue.number, url: issue.html_url, ...(warning ? { warning } : {}) };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, error: timedOut ? "GitHub did not answer within 10 seconds" : scrub(`GitHub request failed: ${error instanceof Error ? error.message : "unknown error"}`) };
  }
}

async function errorDetail(response: Response): Promise<string> {
  const detail = await response.json().then((json: unknown) =>
    json && typeof json === "object" && "message" in json && typeof json.message === "string" ? json.message : "", () => "");
  return `GitHub answered ${response.status}${detail ? `: ${detail}` : ""}`;
}

function failure(error: unknown, token: string): string {
  const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
  return timedOut ? "GitHub did not answer within 10 seconds" : `GitHub request failed: ${error instanceof Error ? error.message : "unknown error"}`.split(token).join("[token]").slice(0, 300);
}

/** An open issue the app filed (label from-app). `text` is the title plus the start of the description, for matching. */
export interface FromAppIssue {
  number: number;
  url: string;
  title: string;
  text: string;
}

export type IssueListResult = { ok: true; issues: FromAppIssue[] } | { ok: false; error: string };
export type IssueCheckResult =
  | { ok: true; issue: FromAppIssue }
  /** `not_eligible`: missing, closed, a pull request, or not filed by the app. `unavailable`: GitHub could not tell. */
  | { ok: false; reason: "not_eligible" | "unavailable"; error: string };

const LIST_TTL_MS = 60_000;
let listCache: { repo: string; at: number; issues: FromAppIssue[] } | null = null;

/** Clears the 60 second issue list cache (tests, and after the report route comments on an issue). */
export function resetGithubIssueCache(): void {
  listCache = null;
}

/** The description part of an issue body made by `buildIssueBody`, without the code fence. */
function descriptionOf(body: unknown): string {
  if (typeof body !== "string") return "";
  const match = /## Description\s+([\s\S]*?)(?:\n## |$)/.exec(body);
  return (match?.[1] ?? "").replace(/^`{3,}\w*\n?|\n?`{3,}\s*$/g, "").trim().slice(0, 500);
}

function toFromAppIssue(raw: unknown): FromAppIssue | null {
  if (!raw || typeof raw !== "object") return null;
  const issue = raw as { number?: unknown; html_url?: unknown; title?: unknown; body?: unknown; state?: unknown; pull_request?: unknown; labels?: unknown };
  if (typeof issue.number !== "number" || typeof issue.html_url !== "string" || typeof issue.title !== "string") return null;
  if (issue.pull_request || issue.state !== "open") return null;
  const labels = Array.isArray(issue.labels) ? issue.labels : [];
  const fromApp = labels.some((label) => (typeof label === "string" ? label : (label as { name?: unknown } | null)?.name) === "from-app");
  if (!fromApp) return null;
  return { number: issue.number, url: issue.html_url, title: issue.title, text: `${issue.title} ${descriptionOf(issue.body)}`.trim() };
}

/**
 * The open issues the app filed, newest 100, cached for 60 seconds. Never throws. Needs the token: with none, or when
 * GitHub fails, it answers `{ ok: false }` and the caller falls back to the saved reports.
 */
export async function listOpenFromAppIssues(): Promise<IssueListResult> {
  const token = process.env.BUG_REPORT_GITHUB_TOKEN?.trim();
  if (!token) return { ok: false, error: "BUG_REPORT_GITHUB_TOKEN is not set" };
  const repo = bugReportRepo();
  if (listCache && listCache.repo === repo && Date.now() - listCache.at < LIST_TTL_MS) return { ok: true, issues: listCache.issues };
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/issues?state=open&labels=from-app&per_page=100`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: githubHeaders(token),
    });
    if (!response.ok) return { ok: false, error: (await errorDetail(response)).split(token).join("[token]").slice(0, 300) };
    const raw = (await response.json()) as unknown;
    if (!Array.isArray(raw)) return { ok: false, error: "GitHub answered with an unexpected list" };
    const issues = raw.map(toFromAppIssue).filter((issue): issue is FromAppIssue => issue !== null);
    listCache = { repo, at: Date.now(), issues };
    return { ok: true, issues };
  } catch (error) {
    return { ok: false, error: failure(error, token) };
  }
}

/**
 * Asks GitHub about one issue number, fresh each time: the report route comments only on an issue that is open, filed by
 * the app (label from-app) and not a pull request. Never throws.
 */
export async function getOpenFromAppIssue(number: number): Promise<IssueCheckResult> {
  const token = process.env.BUG_REPORT_GITHUB_TOKEN?.trim();
  if (!token) return { ok: false, reason: "unavailable", error: "BUG_REPORT_GITHUB_TOKEN is not set" };
  try {
    const response = await fetch(`https://api.github.com/repos/${bugReportRepo()}/issues/${number}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: githubHeaders(token),
    });
    if (response.status === 404 || response.status === 410) return { ok: false, reason: "not_eligible", error: "The issue does not exist" };
    if (!response.ok) return { ok: false, reason: "unavailable", error: (await errorDetail(response)).split(token).join("[token]").slice(0, 300) };
    const issue = toFromAppIssue(await response.json());
    return issue ? { ok: true, issue } : { ok: false, reason: "not_eligible", error: "The issue is closed or was not filed by the app" };
  } catch (error) {
    return { ok: false, reason: "unavailable", error: failure(error, token) };
  }
}

/** Adds the +1 comment to an issue. Never throws. */
export async function commentOnIssue(number: number, input: IssueBodyInput, redact: readonly string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = process.env.BUG_REPORT_GITHUB_TOKEN?.trim();
  if (!token) return { ok: false, error: "BUG_REPORT_GITHUB_TOKEN is not set" };
  try {
    const response = await fetch(`https://api.github.com/repos/${bugReportRepo()}/issues/${number}/comments`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: githubHeaders(token),
      body: JSON.stringify({ body: buildCommentBody(input, redact) }),
    });
    if (!response.ok) return { ok: false, error: (await errorDetail(response)).split(token).join("[token]").slice(0, 300) };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: failure(error, token) };
  }
}
