import { verifyWebhook, type WebhookEvent } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { notifyJoinRequest, type JoinRequestNotice } from "@yugidraft/shared/notify";
import { getDb } from "@/lib/db";

const MAX_BODY_BYTES = 64 * 1024;

function eventTime(createdAt: number, timestamp?: number): string {
  const date = new Date(Number.isFinite(createdAt) ? createdAt : timestamp ?? Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function eventNotice(event: WebhookEvent): JoinRequestNotice | undefined {
  if (event.type === "waitlistEntry.created") {
    if (typeof event.data?.email_address !== "string" || !event.data.email_address.trim()) return;
    return { email: event.data.email_address, source: "Clerk waitlist", createdAt: eventTime(event.data.created_at, event.timestamp) };
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
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
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
  const notice = eventNotice(event);

  try {
    const db = getDb();
    const receipt = db.prepare(`
      insert into clerk_webhook_receipts (svix_id, received_at) values (?, ?)
      on conflict(svix_id) do nothing
    `).run(request.headers.get("svix-id")!.trim(), new Date().toISOString());
    // The same shared claim also deduplicates different event IDs and local joins.
    if (receipt.changes !== 0 && notice) void notifyJoinRequest(db, notice);
  } catch {
    // Keep storage errors retryable; Discord errors are contained by the notifier.
    return Response.json({ error: "retry_later" }, { status: 503, headers });
  }
  return Response.json({ received: true }, { status: 200, headers });
}

export const runtime = "nodejs";
