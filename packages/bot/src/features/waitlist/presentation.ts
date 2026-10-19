import { createHash } from "node:crypto";
import { normalizeEmailDomain } from "@yugidraft/shared/util/email-domain";
import type { WaitlistAction } from "@yugidraft/shared/services/waitlist-decisions";

export const noMentions = { parse: [] as never[], repliedUser: false };
export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  return normalizeEmailDomain(email) ?? email;
}
export function emailHash(value: string): string {
  return createHash("sha256").update(`email:${normalizeEmail(value)}`).digest("hex");
}
export function safeText(value: string, limit = 200): string {
  return value.replace(/[\\`*_~|<>\r\n\u2028\u2029]/g, " ").slice(0, limit);
}
export function emailText(value: string, limit = 320): string {
  const email = normalizeEmail(value);
  const at = email.lastIndexOf("@");
  const shown = process.env.DISCORD_ADMIN_SHOW_FULL_EMAIL === "1" ? email
    : at > 0 ? `${Array.from(email)[0]}***${email.slice(at)}` : "Email unavailable";
  return "`" + shown.replace(/`/g, "ˋ").replace(/[\r\n\u2028\u2029]/g, " ").slice(0, limit) + "`";
}
export function discordTime(at: number): string {
  return `<t:${Math.floor(at / 1000)}:f>`;
}
export function decisionText(action: WaitlistAction): string {
  return `${action.decision === "approve" ? "Approved" : "Rejected"} by ${safeText(action.actor_name ?? "owner", 80)} · ${discordTime(action.completed_at ?? action.attempted_at ?? action.created_at)} (${action.source === "discord" ? "Discord" : "web"})`;
}
export function decisionPayload(action: WaitlistAction): Record<string, unknown> {
  return { content: decisionText(action), embeds: [], components: [], allowed_mentions: { parse: [] } };
}
