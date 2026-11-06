import type Database from "better-sqlite3";
import { randomBytes, randomUUID } from "node:crypto";
import { createReleaseService, publishedRelease, ReleaseError, type Release } from "../services/releases.js";
import { discoverEmailAudience, type AudienceClerk, type AudienceCounts, type EmailAudience, type EmailRecipient } from "./audience.js";
import { decrypt, encrypt, hash, missingEmailConfig, unsubscribeToken, type EmailConfig } from "./storage.js";
import { renderReleaseEmail } from "./render.js";
import { EmailProviderError, type EmailProvider } from "./provider.js";

const LEASE_MS = 60_000, DAY_MS = 86400_000, SEND_INTERVAL_MS = 12_000;
export interface EmailSendState {
  state: "none" | "queued" | "sending" | "done" | "needs_review" | "not_configured";
  queued: number; sent: number; failed: number; total: number; confirmedAt?: string; lastError?: string;
}
interface SendRow {
  id: string; release_id: string; release_json: string; status: string; confirmed_at: number;
  available_at: number; attempts: number; lease_token: string | null; lease_expires_at: number | null; last_error: string | null;
}
interface DeliveryRow {
  id: number; send_id: string; recipient_key: string; payload_encrypted: string;
  status: string; first_attempt_at: number | null;
  attempts: number; safe_rejections: number; lease_token: string; lease_expires_at: number;
}
interface FrozenPayload {
  recipient: EmailRecipient; body: string; unsubscribeUrl: string;
  settings: Pick<EmailConfig, "from" | "replyTo" | "postalAddress" | "webUrl">;
}
interface PreviewRow {
  token_hash: string; release_id: string; owner_user_id: number; release_hash: string;
  audience_hash: string; counts_json: string; payload_encrypted: string; expires_at: number;
}
const emptyState = (state: EmailSendState["state"]): EmailSendState => ({ state, queued: 0, sent: 0, failed: 0, total: 0 });

export function createReleaseEmailOutbox(db: Database.Database, config: EmailConfig) {
  const releaseService = createReleaseService(db);
  const findSend = (releaseId: string) => db.prepare<[string], SendRow>("select * from release_email_sends where release_id=?").get(releaseId);
  const configured = () => missingEmailConfig(config).length === 0;
  function refresh(sendId: string): void {
    if (db.prepare("select 1 from release_email_sends where id=? and status='needs_review' and counts_json is null").get(sendId)) return;
    const rows = db.prepare<[string], { status: string; n: number; attempts: number }>("select status,count(*) n,sum(attempts) attempts from release_email_deliveries where send_id=? group by status").all(sendId);
    const pending = rows.some(r => ["pending", "retry", "processing"].includes(r.status));
    const review = rows.some(r => r.status === "needs_review");
    const status = review ? "needs_review" : pending ? rows.some(r => r.attempts > 0) ? "sending" : "queued" : "done";
    db.prepare("update release_email_sends set status=? where id=? and status!='preparing'").run(status, sendId);
  }
  function state(releaseId: string): EmailSendState {
    const send = findSend(releaseId);
    if (!send) return emptyState(configured() ? "none" : "not_configured");
    if (send.status !== "preparing") refresh(send.id);
    const current = findSend(releaseId)!;
    const rows = db.prepare<[string], { status: string; n: number }>("select status,count(*) n from release_email_deliveries where send_id=? group by status").all(send.id);
    const count = (statuses: string[]) => rows.filter(r => statuses.includes(r.status)).reduce((n, r) => n + r.n, 0);
    const status = !configured() && !["done", "needs_review"].includes(current.status) ? "not_configured"
      : current.status === "preparing" ? "queued" : current.status as EmailSendState["state"];
    return { state: status, queued: count(["pending", "retry", "processing"]), sent: count(["accepted", "delivered"]),
      failed: count(["failed", "suppressed", "needs_review"]), total: rows.reduce((n, r) => n + r.n, 0), confirmedAt: new Date(send.confirmed_at).toISOString(),
      ...(current.last_error ? { lastError: current.last_error } : {}) };
  }
  function requireConfig(): void {
    if (!configured()) throw new ReleaseError("not_configured", 503);
  }
  function messageBody(release: Release, recipient: EmailRecipient, settings: EmailConfig, url: string): string {
    return JSON.stringify(renderReleaseEmail(release, recipient, settings, url));
  }
  function insertDeliveries(sendId: string, release: Release, audience: EmailAudience, now: number): void {
    for (const recipient of audience.recipients) {
      const url = new URL("/unsubscribe", config.webUrl); url.searchParams.set("t", unsubscribeToken(db, recipient.email));
      const settings = { from: config.from, replyTo: config.replyTo, postalAddress: config.postalAddress, webUrl: config.webUrl };
      const body = messageBody(release, recipient, config, url.href);
      const payload: FrozenPayload = { recipient, body, unsubscribeUrl: url.href, settings };
      const suppressed = !!db.prepare("select 1 from email_unsubscribes where recipient_key=?").get(recipient.key);
      // Legacy idempotency_key is a local audit ID only; SMTP receives no idempotency key.
      db.prepare(`insert into release_email_deliveries(send_id,recipient_key,payload_encrypted,idempotency_key,status,available_at,subject_clerk_id)
        values(?,?,?,?,?,?,?) on conflict(send_id,recipient_key) do nothing`)
        .run(sendId, recipient.key, suppressed ? null : encrypt(payload, config), `release/${sendId}/${recipient.key}`, suppressed ? "suppressed" : "pending", now, recipient.variant === "members" ? recipient.sourceId : null);
    }
    db.prepare("update release_email_sends set status='queued',audience_hash=?,counts_json=?,lease_token=null,lease_expires_at=null,last_error=null where id=?")
      .run(hash(JSON.stringify(audience.recipients)), JSON.stringify(audience.counts), sendId);
    refresh(sendId);
  }
  async function preview(releaseId: string, ownerUserId: number, clerk: AudienceClerk): Promise<{ token: string; counts: AudienceCounts; expiresAt: string; estimatedMinutes: number }> {
    requireConfig();
    const release = publishedRelease(releaseService.get(releaseId));
    if (findSend(releaseId)) throw new ReleaseError("email_already_reserved", 409);
    const audience = await discoverEmailAudience(db, clerk);
    const now = Date.now(), expires = now + 15 * 60_000, token = randomBytes(32).toString("base64url");
    db.transaction(() => {
      db.prepare("delete from release_email_previews where expires_at<=?").run(now);
      db.prepare(`insert into release_email_previews(token_hash,release_id,owner_user_id,release_hash,audience_hash,counts_json,payload_encrypted,expires_at,created_at)
        values(?,?,?,?,?,?,?,?,?)`).run(hash(token), releaseId, ownerUserId, hash(JSON.stringify(release)), hash(JSON.stringify(audience.recipients)),
        JSON.stringify(audience.counts), encrypt(audience, config), expires, now);
    }).immediate();
    return { token, counts: audience.counts, expiresAt: new Date(expires).toISOString(), estimatedMinutes: Math.ceil(audience.counts.total * SEND_INTERVAL_MS / 60_000) };
  }
  async function confirm(releaseId: string, ownerUserId: number, token: string): Promise<EmailSendState> {
    return db.transaction(() => {
      if (findSend(releaseId)) return state(releaseId);
      if (!configured()) return emptyState("not_configured");
      const row = db.prepare<[string], PreviewRow>("select * from release_email_previews where token_hash=?").get(hash(token));
      const release = publishedRelease(releaseService.get(releaseId));
      if (!row) throw new ReleaseError("preview_expired", 410);
      if (row.release_id !== releaseId || row.owner_user_id !== ownerUserId
        || row.release_hash !== hash(JSON.stringify(release))) throw new ReleaseError("invalid_preview", 409);
      if (row.expires_at <= Date.now()) throw new ReleaseError("preview_expired", 410);
      const audience = decrypt<EmailAudience>(row.payload_encrypted, config);
      if (hash(JSON.stringify(audience.recipients)) !== row.audience_hash) throw new ReleaseError("invalid_preview", 409);
      const id = randomUUID(), now = Date.now();
      db.prepare(`insert into release_email_sends(id,release_id,owner_user_id,confirmed_at,release_json,template_version,status,available_at)
        values(?,?,?,?,?,'release-v1','queued',?)`).run(id, releaseId, ownerUserId, now, JSON.stringify(release), now);
      insertDeliveries(id, release, audience, now);
      db.prepare("delete from release_email_previews where release_id=?").run(releaseId);
      return state(releaseId);
    }).immediate();
  }
  async function renewingLease<T>(table: "release_email_sends" | "release_email_deliveries", id: string | number, token: string,
    work: () => Promise<T>, now: () => number): Promise<T> {
    const renew = () => db.prepare(`update ${table} set lease_expires_at=? where id=? and lease_token=?`).run(now() + LEASE_MS, id, token);
    // Discovery and SMTP may outlast a lease. Renew while they run, then once more under the same fencing token.
    const timer = setInterval(() => { try { renew(); } catch { /* The final fenced write fails closed. */ } }, LEASE_MS / 3);
    timer.unref();
    try { const result = await work(); renew(); return result; }
    finally { clearInterval(timer); }
  }
  /** Publish reserves automatic sends synchronously; complete their audience on the worker without holding a DB lock. */
  async function prepareAutomatic(clerk: AudienceClerk, now: () => number): Promise<void> {
    const send = db.transaction(() => {
      const row = db.prepare<[number, number], SendRow>(`select * from release_email_sends where status='preparing'
        and available_at<=? and (lease_expires_at is null or lease_expires_at<=?) order by confirmed_at limit 1`).get(now(), now());
      if (!row) return undefined;
      const lease = randomUUID();
      db.prepare("update release_email_sends set lease_token=?,lease_expires_at=?,attempts=attempts+1 where id=?").run(lease, now() + LEASE_MS, row.id);
      return { ...row, lease_token: lease, attempts: row.attempts + 1 };
    }).immediate();
    if (!send) return;
    try {
      const audience = await renewingLease("release_email_sends", send.id, send.lease_token, () => discoverEmailAudience(db, clerk, now()), now);
      db.transaction(() => {
        const current = db.prepare("select 1 from release_email_sends where id=? and status='preparing' and lease_token=? and lease_expires_at>?").get(send.id, send.lease_token, now());
        if (current) insertDeliveries(send.id, JSON.parse(send.release_json), audience, now());
      }).immediate();
    } catch {
      db.prepare(`update release_email_sends set available_at=?,lease_token=null,lease_expires_at=null,last_error='audience_unavailable'
        where id=? and status='preparing' and lease_token=?`).run(now() + Math.min(3600000, 10000 * 2 ** Math.min(send.attempts, 9)), send.id, send.lease_token);
    }
  }
  function resetDailyBudget(now: number): void {
    const day = Math.floor(now / DAY_MS) * DAY_MS;
    db.prepare(`insert into email_budget(id,next_attempt_at,day_started_at,attempts) values(1,0,?,0)
      on conflict(id) do update set day_started_at=excluded.day_started_at,attempts=0 where email_budget.day_started_at<excluded.day_started_at`).run(day);
  }
  function claim(now: number): DeliveryRow | undefined {
    return db.transaction(() => {
      // SMTP cannot deduplicate. A durable attempt without a result is NEVER reclaimed for sending.
      db.prepare(`update release_email_sends set last_error='unknown_outcome' where id in
        (select send_id from release_email_deliveries where status in ('pending','retry','processing')
        and first_attempt_at is not null and (lease_expires_at is null or lease_expires_at<=?))`).run(now);
      db.prepare(`update release_email_deliveries set status='needs_review',last_error='unknown_outcome',lease_token=null,lease_expires_at=null
        where status in ('pending','retry','processing') and first_attempt_at is not null
        and (lease_expires_at is null or lease_expires_at<=?)`).run(now);
      db.prepare("delete from release_email_previews where expires_at<=?").run(now);
      db.prepare("update release_email_deliveries set payload_encrypted=null where status='needs_review' and first_attempt_at<?").run(now - 30 * DAY_MS);
      resetDailyBudget(now);
      const budget = db.prepare<[], { next_attempt_at: number; attempts: number }>("select * from email_budget where id=1").get()!;
      if (budget.next_attempt_at > now || budget.attempts >= config.dailyLimit) return undefined;
      const row = db.prepare<[number, number], DeliveryRow>(`select * from release_email_deliveries where
        ((status in ('pending','retry') and available_at<=?) or (status='processing' and lease_expires_at<=?))
        and first_attempt_at is null and payload_encrypted is not null order by status='retry', id limit 1`).get(now, now);
      if (!row) return undefined;
      const lease = randomUUID();
      db.prepare("update release_email_deliveries set status='processing',lease_token=?,lease_expires_at=? where id=?").run(lease, now + LEASE_MS, row.id);
      return { ...row, status: "processing", lease_token: lease, lease_expires_at: now + LEASE_MS };
    }).immediate();
  }
  function finish(row: DeliveryRow, status: string, error: string, clearPayload = true, safeRejection = false): boolean {
    return db.transaction(() => {
      const changed = db.prepare(`update release_email_deliveries set status=?,last_error=?,safe_rejections=safe_rejections+?,payload_encrypted=case when ? then null else payload_encrypted end,
        lease_token=null,lease_expires_at=null where id=? and status='processing' and lease_token=?`)
        .run(status, error, safeRejection ? 1 : 0, clearPayload ? 1 : 0, row.id, row.lease_token);
      if (changed.changes && status === "needs_review") db.prepare("update release_email_sends set last_error=? where id=?").run(error, row.send_id);
      refresh(row.send_id);
      return changed.changes > 0;
    }).immediate();
  }
  async function drain(options: { clerk: AudienceClerk; provider: EmailProvider; now?: () => number }): Promise<void> {
    if (!configured()) return;
    // WAL/NORMAL can lose a committed attempt on power loss. Sync every email-writer commit before SMTP.
    db.pragma("synchronous = FULL");
    const now = options.now ?? Date.now;
    await prepareAutomatic(options.clerk, now);
    let audience: EmailAudience | undefined;
    // Dispatch reserves the persisted 12-second spacing and daily cap. Each tick processes at most ten rows.
    for (let n = 0; n < 10; n++) {
      const row = claim(now()); if (!row) break;
      try {
        if (db.prepare("select 1 from email_unsubscribes where recipient_key=?").get(row.recipient_key)
          || !db.prepare("select 1 from email_consents where recipient_key=?").get(row.recipient_key)) {
          finish(row, "suppressed", "suppressed"); continue;
        }
        let payload = decrypt<FrozenPayload>(row.payload_encrypted, config);
        if (row.first_attempt_at === null) {
          audience ??= await renewingLease("release_email_deliveries", row.id, row.lease_token, () => discoverEmailAudience(db, options.clerk, now()), now);
          const current = audience.recipients.find(r => r.key === row.recipient_key);
          if (!current) { finish(row, "suppressed", "ineligible"); continue; }
          // An account wins over an old invite. Expired/revoked/replaced tickets lose the invite CTA before the first attempt.
          const recipient = { ...current, inviteUrl: current.inviteUrl === payload.recipient.inviteUrl ? current.inviteUrl : null };
          const release = JSON.parse(db.prepare<[string], { release_json: string }>("select release_json from release_email_sends where id=?").get(row.send_id)!.release_json) as Release;
          payload = { ...payload, recipient, body: messageBody(release, recipient, { ...config, ...payload.settings }, payload.unsubscribeUrl) };
        }
        const started = db.transaction(() => {
          // Fence immediately before network I/O, and recheck suppression after asynchronous discovery.
          if (db.prepare("select 1 from email_unsubscribes where recipient_key=?").get(row.recipient_key)) return false;
          const at = now();
          resetDailyBudget(at); // Discovery may have crossed UTC midnight.
          const budget = db.prepare<[], { next_attempt_at: number; attempts: number; day_started_at: number }>("select * from email_budget where id=1").get()!;
          if (budget.next_attempt_at > at || budget.attempts >= config.dailyLimit) {
            const available = Math.max(budget.next_attempt_at, budget.attempts >= config.dailyLimit ? budget.day_started_at + DAY_MS : at);
            db.prepare(`update release_email_deliveries set status='retry',available_at=?,lease_token=null,lease_expires_at=null
              where id=? and status='processing' and lease_token=? and lease_expires_at>?`)
              .run(available, row.id, row.lease_token, at);
            refresh(row.send_id);
            return false;
          }
          const marked = db.prepare(`update release_email_deliveries set first_attempt_at=?,attempts=attempts+1,payload_encrypted=?,subject_clerk_id=?
            where id=? and status='processing' and lease_token=? and lease_expires_at>? and first_attempt_at is null`)
            .run(at, encrypt(payload, config), payload.recipient.variant === "members" ? payload.recipient.sourceId : null, row.id, row.lease_token, at).changes > 0;
          if (marked) db.prepare("update email_budget set next_attempt_at=?,attempts=attempts+1 where id=1").run(at + SEND_INTERVAL_MS);
          return marked;
        }).immediate();
        if (!started) continue;
        row.first_attempt_at = now();
        const accepted = await renewingLease("release_email_deliveries", row.id, row.lease_token, () => options.provider.send(payload.body), now);
        db.transaction(() => {
          const acceptedRow = db.prepare(`update release_email_deliveries set status='accepted',provider_id=?,accepted_at=?,payload_encrypted=null,subject_clerk_id=null,
            lease_token=null,lease_expires_at=null,last_error=null where id=? and status='processing' and lease_token=?`)
            .run(accepted.id, now(), row.id, row.lease_token);
          if (!acceptedRow.changes) return;
          db.prepare("update release_email_sends set last_error=null where id=?").run(row.send_id);
          db.prepare("update email_budget set failures=0 where id=1").run();
          refresh(row.send_id);
        }).immediate();
      } catch (error) {
        const providerError = error instanceof EmailProviderError ? error : undefined;
        const unknownOutcome = row.first_attempt_at !== null && (!providerError || providerError.code === "unknown_outcome");
        const code = unknownOutcome ? "unknown_outcome" : providerError?.code === "provider_auth" || providerError?.code === "provider_policy"
          ? providerError.code : providerError && !providerError.permanent ? "provider_unavailable" : providerError?.code ?? "audience_or_storage_unavailable";
        if (unknownOutcome) {
          db.transaction(() => {
            if (!finish(row, "needs_review", code, false)) return;
            const { failures } = db.prepare<[], { failures: number }>("select failures from email_budget where id=1").get()!;
            const delay = Math.max(Math.min(3600000, SEND_INTERVAL_MS * 2 ** Math.min(failures, 9)), providerError?.retryAfterMs ?? 0);
            db.prepare("update email_budget set next_attempt_at=max(next_attempt_at,?),failures=failures+1 where id=1").run(now() + delay);
          }).immediate();
        } else if (providerError?.permanent) {
          finish(row, "failed", code, true, providerError.safeRejection);
        } else {
          db.transaction(() => {
            const failures = db.prepare<[], { failures: number }>("select failures from email_budget where id=1").get()!.failures;
            const delay = Math.max(code === "provider_auth" || code === "provider_policy" ? 3600000
              : Math.min(3600000, SEND_INTERVAL_MS * 2 ** Math.min(failures, 9)), providerError?.retryAfterMs ?? 0);
            const rejections = row.safe_rejections + (providerError?.safeRejection ? 1 : 0), failed = rejections >= 5;
            // An explicit SMTP rejection/setup failure proves no delivery. Clear the attempt marker atomically with the pause.
            const retried = db.prepare(`update release_email_deliveries set status=?,safe_rejections=?,payload_encrypted=case when ? then null else payload_encrypted end,
              first_attempt_at=null,attempts=max(0,attempts-?),available_at=?,last_error=?,lease_token=null,lease_expires_at=null
              where id=? and status='processing' and lease_token=?`)
              .run(failed ? "failed" : "retry", rejections, failed ? 1 : 0, row.first_attempt_at !== null ? 1 : 0, now() + delay, code, row.id, row.lease_token);
            if (!retried.changes) return;
            db.prepare("update email_budget set next_attempt_at=max(next_attempt_at,?),failures=failures+1 where id=1").run(now() + delay);
            db.prepare("update release_email_sends set last_error=? where id=?").run(code, row.send_id);
            refresh(row.send_id);
          }).immediate();
        }
      }
    }
  }
  return { preview, confirm, state, drain };
}
