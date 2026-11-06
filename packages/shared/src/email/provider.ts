import nodemailer from "nodemailer";
import type { EmailMessage } from "./render.js";

export class EmailProviderError extends Error {
  constructor(readonly code: "transport" | "rate_limited" | "rejected" | "provider_auth" | "provider_policy" | "unknown_outcome", readonly permanent = false, readonly retryAfterMs = 0) {
    super(code); this.name = "EmailProviderError";
  }
}
export interface EmailProvider { send(body: string): Promise<{ id: string }>; close?(): void }
export type EmailTransportMessage = Omit<EmailMessage, "reply_to"> & { replyTo: string };
export interface EmailTransport {
  sendMail(message: EmailTransportMessage): Promise<{ messageId: string }>;
  close(): void;
}
function classify(error: unknown): EmailProviderError {
  const err = error as { code?: string; originalCode?: string; responseCode?: number; response?: string; command?: string; timeoutType?: string; message?: string; syscall?: string } | null;
  const status = err?.responseCode ?? 0, command = err?.command ?? "";
  // Inspect details only for classification; never persist SMTP text or private values.
  if (status === 535 || (err?.code === "EAUTH" && !(status >= 400 && status < 500))) return new EmailProviderError("provider_auth");
  if (status >= 400 && status < 500) return new EmailProviderError("rate_limited");
  if (status >= 500 && status < 600) {
    const response = (err?.response ?? err?.message ?? "").replace(/[^\s<>@]+@[^\s<>@]+/g, "");
    const addressFailure = /\b5\.1\.\d+\b/.test(response) || /\b(?:user unknown|no such user|does not exist)\b/i.test(response);
    if (/^RCPT TO\b/i.test(command) && addressFailure && !/\b5\.7\.\d+\b/.test(response)) return new EmailProviderError("rejected", true);
    return new EmailProviderError("provider_policy");
  }
  // In the pinned pool implementation this error is emitted only for a close before any message bytes
  // were read (including a reused connection's 421). maxRequeues=0 preserves outbox ownership of retry.
  if (err?.code === "ECONNECTION" && err.message === "Reached maximum number of retries after connection was closed")
    return new EmailProviderError("transport");
  // Implicit TLS certificate validation failures are reported as ESOCKET, with the original Node code.
  if (err?.code === "ESOCKET" && ["CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "ERR_TLS_CERT_ALTNAME_INVALID",
    "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"].includes(err.originalCode ?? "")) return new EmailProviderError("transport");
  // Nodemailer uses CONN for socket failures even AFTER DATA. Only proven setup failures are safe.
  if (["EDNS", "ETLS", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(err?.code ?? "")
    || err?.syscall === "connect"
    || err?.originalCode === "ECONNREFUSED"
    || ["CONNECT_TIMEOUT", "GREETING_TIMEOUT", "UPGRADE_TIMEOUT"].includes(err?.timeoutType ?? "")
    || ["EHLO", "HELO", "STARTTLS", "MAIL FROM", "RCPT TO"].includes(command)
    || (err?.code === "EPROTOCOL" && /^Invalid greeting\b/i.test(err?.message ?? ""))) return new EmailProviderError("transport");
  return new EmailProviderError("unknown_outcome");
}
/** No network until send(). One pooled TLS connection; the durable outbox owns every retry. */
export function createSmtpProvider(options: { host: string; user: string; password: string; transport?: EmailTransport }): EmailProvider {
  const transport = options.transport ?? nodemailer.createTransport({
    host: options.host, port: 465, secure: true, auth: { user: options.user, pass: options.password },
    pool: true, maxConnections: 1, maxRequeues: 0,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    disableFileAccess: true, disableUrlAccess: true,
  });
  return {
    async send(body) {
      const message = JSON.parse(body) as EmailMessage;
      // Copy only rendered fields: no CC/BCC, attachments, provider tags or Sent-folder/IMAP writes.
      if (message.to.length !== 1) throw new EmailProviderError("rejected", true);
      try {
        const result = await transport.sendMail({ from: message.from, to: message.to, replyTo: message.reply_to,
          subject: message.subject, html: message.html, text: message.text, headers: message.headers });
        if (!result.messageId) throw new EmailProviderError("unknown_outcome");
        return { id: result.messageId };
      } catch (error) {
        if (error instanceof EmailProviderError) throw error;
        throw classify(error);
      }
    },
    close: () => transport.close(),
  };
}
