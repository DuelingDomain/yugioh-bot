import { verifyWebhook, type WebhookEvent } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { enqueueJoinRequest, notifyJoinRequest, type JoinRequestNotice } from "@yugidraft/shared/notify";
import { resolveCreatorSignUpAttribution } from "@yugidraft/shared/services/creator-access";
import { normalizeEmailDomain } from "@yugidraft/shared/util/email-domain";
import { parseHeardFrom } from "@yugidraft/shared/util/heard-from";
import { getDb } from "@/lib/db";

const MAX_BODY_BYTES = 64 * 1024;
const RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const RECEIPT_CLEANUP_BATCH = 100;

function eventTime(createdAt: number, timestamp?: number): string {
  const time = Number.isFinite(createdAt) ? createdAt
    : typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : Date.now();
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function eventNotice(event: WebhookEvent): JoinRequestNotice | undefined {
  if (event.type === "waitlistEntry.created") {
    if (typeof event.data?.email_address !== "string" || !event.data.email_address.trim()) return;
    return { email: event.data.email_address, clerkEntryId: event.data.id,
      source: "Clerk waitlist", createdAt: eventTime(event.data.created_at, event.timestamp) };
  }
  if (event.type === "user.created") {
    if (typeof event.data?.id !== "string" || !event.data.id.trim()) return;
    const emails = Array.isArray(event.data.email_addresses) ? event.data.email_addresses : [];
    if (emails.some(address => typeof address?.email_address !== "string" || !address.email_address.trim())) return;
    const email = emails.find(address => address.id === event.data.primary_email_address_id)?.email_address ?? emails[0]?.email_address;
    return {
      email, subjectId: event.data.id, source: "sign-up",
      createdAt: eventTime(event.data.created_at, event.timestamp),
    };
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  const contentLength = request.headers.get("content-length");
  if (contentLength === null) {
    return Response.json({ error: "length_required" }, { status: 411, headers });
  }
  if (Number(contentLength) > MAX_BODY_BYTES) {
    return Response.json({ error: "body_too_large" }, { status: 413, headers });
  }
  const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!signingSecret) return Response.json({ error: "webhook_not_configured" }, { status: 503, headers });

  let event: WebhookEvent;
  try {
    // Verify the original body and all Svix headers before any database effects.
    event = await verifyWebhook(request, { signingSecret });
  } catch {
    // SDK errors can contain request data. Never log or return them.
    return Response.json({ error: "invalid_signature" }, { status: 400, headers });
  }

  // Signed but unusable events are permanent: retain their receipt and acknowledge.
  let notice = eventNotice(event);

  try {
    const db = getDb();
    const now = Date.now();
    const receipt = db.transaction(() => {
      const inserted = db.prepare(`
        insert into clerk_webhook_receipts (svix_id, received_at) values (?, ?)
        on conflict(svix_id) do nothing
      `).run(request.headers.get("svix-id")!.trim(), new Date(now).toISOString());
      let outboxHandled = false;
      if (inserted.changes !== 0) {
        if (notice && event.type === "user.created") {
          const creatorInvite = resolveCreatorSignUpAttribution(db, {
            email: notice.email ?? null, clerkUserId: event.data.id,
            grantId: event.data.public_metadata?.ddGrant, createdAt: Date.parse(notice.createdAt!),
          }) ?? undefined;
          let heardFrom = parseHeardFrom(event.data.unsafe_metadata?.heardFrom, event.data.unsafe_metadata?.heardFromDetail);
          if (!heardFrom && notice.email) {
            const email = notice.email.trim().toLowerCase();
            const row = db.prepare<[string, string], { heard_from: string; heard_from_detail: string | null }>(
              "select heard_from,heard_from_detail from waitlist_signups where email in (?,?) and heard_from is not null limit 1")
              .get(email, normalizeEmailDomain(email) ?? email);
            if (row) heardFrom = parseHeardFrom(row.heard_from, row.heard_from_detail);
          }
          notice = { ...notice, creatorInvite, heardFrom: heardFrom ?? undefined };
        }
        // Receipt and durable alert commit together; a failed write remains retryable.
        if (notice) outboxHandled = enqueueJoinRequest(db, notice);
        // The expiry index and batch bound keep each new delivery cheap.
        db.prepare(`delete from clerk_webhook_receipts where svix_id in (
          select svix_id from clerk_webhook_receipts
          where received_at < ? order by received_at limit ?
        )`).run(new Date(now - RECEIPT_RETENTION_MS).toISOString(), RECEIPT_CLEANUP_BATCH);
      }
      return { changes: inserted.changes, outboxHandled };
    })();
    // The same shared claim also deduplicates different event IDs and local joins.
    if (receipt.changes !== 0 && notice && !receipt.outboxHandled) void notifyJoinRequest(db, notice);
  } catch {
    // Keep storage errors retryable; Discord errors are contained by the notifier.
    return Response.json({ error: "retry_later" }, { status: 503, headers });
  }
  return Response.json({ received: true }, { status: 200, headers });
}

export const runtime = "nodejs";
