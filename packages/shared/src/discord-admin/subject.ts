import { createHash } from "node:crypto";
import { normalizeEmailDomain } from "../util/email-domain.js";

export function normalizedNoticeEmail(email: string): string {
  const value = email.trim().toLowerCase();
  return normalizeEmailDomain(value) ?? value;
}

export function notificationSubjectHash(subject: { email?: string; subjectId?: string }): string | null {
  const email = subject.email ? normalizedNoticeEmail(subject.email) : "";
  const key = email ? `email:${email}` : subject.subjectId ? `clerk:${subject.subjectId}` : null;
  return key === null ? null : createHash("sha256").update(key).digest("hex");
}
