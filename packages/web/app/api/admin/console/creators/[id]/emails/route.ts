import { CreatorAccessError, MAX_EMAILS_PER_ADD } from "@yugidraft/shared/services/creator-access";
import type { AddEmailsResponse } from "@/lib/admin-console/creators-types";
import { busyResponse, creatorAccess, creatorErrorResponse, ownerJson, parseId, requireOwnerMutation } from "@/lib/admin-console/creators";
import { releaseOwnerSends, reserveOwnerSends } from "@/lib/creator-send-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Add 1-20 allowlist emails: each one gets a grant and a Clerk invitation now. The whole batch must fit the budget. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const guard = await requireOwnerMutation(request, { body: true });
  if (!guard.ok) return guard.response;
  const id = parseId((await params).id);
  if (id === null) return ownerJson({ error: "invalid_id" }, 400);
  const { emails } = guard.body;
  if (!Array.isArray(emails) || emails.length === 0 || !emails.every((email) => typeof email === "string")) {
    return ownerJson({ error: "invalid_emails" }, 400);
  }
  if (emails.length > MAX_EMAILS_PER_ADD) return ownerJson({ error: "too_many_emails" }, 400);
  const wait = reserveOwnerSends(emails.length);
  if (wait !== null) return busyResponse(wait);
  try {
    const results = await creatorAccess().addAllowlistEmails(id, emails as string[], guard.userId);
    // Only outcomes that made no Clerk call give their send back.
    releaseOwnerSends(emails.length - results.filter((r) => r.outcome !== "already" && r.outcome !== "invalid").length);
    const body: AddEmailsResponse = { results };
    return ownerJson(body);
  } catch (error) {
    // The service refuses a missing or archived creator before any send.
    if (error instanceof CreatorAccessError) releaseOwnerSends(emails.length);
    return creatorErrorResponse(error, "add_emails");
  }
}
