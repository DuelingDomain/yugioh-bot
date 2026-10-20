import type { ClerkBackend } from "@yugidraft/shared/clerk";
import { getWaitlistAction } from "@yugidraft/shared/services/waitlist-decisions";
import type { ClaimedOutbox } from "@yugidraft/shared/discord-admin";
import type { FeatureContext, Stop } from "../../runtime/types.js";
import { findEntry } from "./clerk.js";
import { decisionPayload, discordTime, emailHash, emailText, safeText } from "./presentation.js";

const alertKinds = new Set(["waitlist_alert", "signup_alert"]);
type Payload = { embeds?: { title?: string; timestamp?: string; fields?: { name: string; value: string; inline?: boolean }[] }[]; [key: string]: unknown };

async function renderAlert(row: ClaimedOutbox, context: FeatureContext, backend: () => ClerkBackend): Promise<ClaimedOutbox> {
  const payload = JSON.parse(row.payload_json) as Payload;
  const action = row.waitlist_action_id ? getWaitlistAction(context.db, row.waitlist_action_id) : null;
  if (action?.completed_at != null) return { ...row, payload_json: JSON.stringify({ ...payload, ...decisionPayload(action) }) };
  const embed = payload.embeds?.[0];
  if (!embed) return row;
  const fields = (embed.fields ?? []).filter(field => !["When", "Position", "Pending", "Pending (known)"].includes(field.name));
  let pending: number | undefined;
  let position: number | undefined;
  let email: string | undefined;
  try {
    const clerk = backend();
    // One bounded page gives the pending count even for a large queue. Position
    // is shown only when known; never label a local count as the Clerk count.
    const page = await clerk.listWaitlistEntries({ status: "pending", orderBy: "+created_at", limit: 500 });
    pending = page.totalCount;
    const index = action?.clerk_entry_id ? page.data.findIndex(entry => entry.id === action.clerk_entry_id) : -1;
    if (index >= 0) { position = index + 1; email = page.data[index].email_address; }
    if (process.env.DISCORD_ADMIN_SHOW_FULL_EMAIL === "1") {
      if (!email && action?.clerk_entry_id) email = (await findEntry(clerk, action.clerk_entry_id))?.email_address;
      if (!action && row.subject_clerk_id) {
        const user = await clerk.getUser(row.subject_clerk_id);
        email = user.email_addresses.find(address => address.id === user.primary_email_address_id)?.email_address;
      }
    }
  } catch { /* Alerts remain deliverable during a Clerk outage. The stored body is masked. */ }
  // A changed Clerk address must not reveal a different subject's email.
  if (email && emailHash(email) === row.subject_hash) {
    const emailField = fields.find(field => field.name === "Email");
    if (emailField) emailField.value = emailText(email);
  }
  const timestamp = Date.parse(embed.timestamp ?? "");
  fields.push({ name: "When", value: discordTime(Number.isFinite(timestamp) ? timestamp : row.created_at), inline: true });
  if (position !== undefined) fields.push({ name: "Position", value: String(position), inline: true });
  if (pending !== undefined) fields.push({ name: "Pending", value: String(pending), inline: true });
  else {
    const known = context.db.prepare<[], { count: number }>("select count(*) as count from discord_waitlist_actions where completed_at is null").get()!.count;
    fields.push({ name: "Pending (known)", value: String(known), inline: true });
  }
  const source = fields.find(field => field.name === "Source");
  if (source) source.value = safeText(source.value);
  return { ...row, payload_json: JSON.stringify({ ...payload, embeds: [{ ...embed, fields }],
    ...(row.kind === "signup_alert" ? { components: [] } : {}), allowed_mentions: { parse: [] } }) };
}

/**
 * The Phase 0 consumer accepts complete JSON and claims synchronously. Buffer a
 * single claimed batch while Clerk enriches it, then return it on the next poll.
 * SQLite still owns leases, retries, rate budgets, nonces and acknowledgements.
 * Full emails exist only in memory; the stored transient body stays masked.
 */
export function installWaitlistOutbox(context: FeatureContext, backend: () => ClerkBackend): Stop {
  const original = context.shared.claimOutbox;
  let ready: { claimed: ClaimedOutbox; rendered: ClaimedOutbox } | undefined;
  let preparing: Promise<void> | undefined;
  let stopped = false;
  const refresh = (row: ClaimedOutbox, rendered = row): ClaimedOutbox | null => {
    const current = context.db.prepare<[number], ClaimedOutbox>("select * from discord_outbox where id=? and status='processing'").get(row.id);
    if (!current || current.lease_token !== row.lease_token) return null;
    if (current.lease_expires_at <= Date.now() + 5000) {
      context.shared.markFailed(current, { code: "transport" }); return null;
    }
    const action = current.waitlist_action_id ? getWaitlistAction(context.db, current.waitlist_action_id) : null;
    let payload: Payload;
    try { payload = JSON.parse(current.payload_json) as Payload; }
    catch {
      context.shared.markFailed(current, { code: "invalid_payload", permanent: true }); return null;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      context.shared.markFailed(current, { code: "invalid_payload", permanent: true }); return null;
    }
    if (action?.completed_at != null) return { ...current, payload_json: JSON.stringify({ ...payload, ...decisionPayload(action) }) };
    // Discard enrichment when a web decision or privacy operation changed the body.
    return { ...current, payload_json: current.payload_json === row.payload_json ? rendered.payload_json : current.payload_json };
  };
  const wrapper: typeof original = limit => {
    if (stopped || context.signal.aborted || !Number.isSafeInteger(limit) || limit <= 0) return [];
    if (ready) {
      const prepared = ready;
      ready = undefined;
      const fresh = refresh(prepared.claimed, prepared.rendered);
      return fresh ? [fresh] : [];
    }
    if (preparing) return [];
    const rows = original(1);
    const alerts = rows.filter(row => alertKinds.has(row.kind));
    const immediate = rows.filter(row => !alertKinds.has(row.kind)).map(row => row.kind === "waitlist_decision" ? refresh(row) : row)
      .filter((row): row is ClaimedOutbox => row !== null);
    if (alerts.length) {
      preparing = (async () => {
        for (const row of alerts) {
          try { ready = { claimed: row, rendered: await renderAlert(row, context, backend) }; }
          catch { context.shared.markFailed(row, { code: "invalid_payload", permanent: true }); }
        }
      })().finally(() => { preparing = undefined; });
    }
    return immediate;
  };
  context.shared.claimOutbox = wrapper;
  return async () => {
    if (stopped) return;
    stopped = true;
    if (context.shared.claimOutbox === wrapper) context.shared.claimOutbox = original;
    await preparing;
    if (ready) context.shared.markFailed(ready.claimed, { code: "transport" });
    ready = undefined;
  };
}
