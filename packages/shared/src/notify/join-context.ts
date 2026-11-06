import type Database from "better-sqlite3";
import { notificationSubjectHash, normalizedNoticeEmail } from "../discord-admin/subject.js";
import { resolveCreatorWaitlistAttribution } from "../services/creator-access.js";
import { discordContextText } from "../util/discord-text.js";
import { HEARD_FROM_LABELS, parseHeardFrom } from "../util/heard-from.js";
import type { JoinRequestNotice } from "./join-request.js";

export type WaitlistNoticeSource = "hero" | "footer" | "form" | "app-not-invited" | "creator" | `creator:${string}`;

/** Stored source text is untrusted. Only recognized origins can enter a notice. */
export function waitlistNoticeSource(value?: string): WaitlistNoticeSource {
  const source = value?.trim();
  if (source === "hero" || source === "footer" || source === "app-not-invited" || source === "creator") return source;
  if (source?.startsWith("creator:")) return `creator:${source.slice(8)}`;
  return "form";
}

function requestWhere(db: Database.Database, source: WaitlistNoticeSource | "Clerk waitlist"): string {
  switch (source) {
    case "hero": return "Website: join form at the top of the home page";
    case "footer": return "Website: join form at the bottom of the home page";
    case "app-not-invited": return "App: tried to sign in without an invite, then joined the waitlist";
    case "Clerk waitlist": return "Clerk: added directly to the waitlist in Clerk";
    case "form": return "Website: join form";
    default: {
      const creator = source.startsWith("creator:") ? resolveCreatorWaitlistAttribution(db, source.slice(8)) : null;
      return "Creator link (closed or full)" + (creator ? `: ${creator.creatorName}${creator.linkLabel ? ` · ${creator.linkLabel}` : ""}` : "");
    }
  }
}

export function joinContextFields(db: Database.Database, notice: JoinRequestNotice): { name: string; value: string }[] {
  const email = notice.email?.trim().toLowerCase();
  const local = email ? db.prepare<[string, string], { source: string; heard_from: string | null; heard_from_detail: string | null }>(
    "select source,heard_from,heard_from_detail from waitlist_signups where email in (?,?) limit 1")
    .get(email, normalizedNoticeEmail(email)) : undefined;
  const originalWhere = local ? requestWhere(db, waitlistNoticeSource(local.source)) : undefined;
  let where: string;
  if (notice.source !== "sign-up") {
    where = notice.source === "Clerk waitlist" && originalWhere ? originalWhere : requestWhere(db, notice.source);
  } else if (notice.creatorInvite) {
    const creator = notice.creatorInvite;
    where = creator.kind === "allowlist" ? `Creator email invite: ${creator.creatorName}`
      : `Creator link: ${creator.creatorName}${creator.linkLabel ? ` · ${creator.linkLabel}` : ""}`;
  } else {
    const approval = db.prepare<[string | null, string | null, number], { actor_name: string | null }>(`select actor_name from discord_waitlist_actions
      where (subject_hash=? or subject_clerk_id=?) and decision='approve' and completed_at<=?
      order by completed_at desc limit 1`).get(notificationSubjectHash(notice), notice.subjectId ?? null,
      notice.createdAt ? Date.parse(notice.createdAt) : Date.now());
    where = approval ? `Waitlist: approved${approval.actor_name ? ` by ${approval.actor_name}` : ""}${originalWhere ? ` · Originally: ${originalWhere}` : ""}`
      : "Direct invite or Clerk";
  }
  const fields = [{ name: "Where", value: discordContextText(where) }];
  const heard = notice.heardFrom ?? parseHeardFrom(local?.heard_from, local?.heard_from_detail);
  if (heard) fields.push({ name: "Heard from", value: discordContextText(HEARD_FROM_LABELS[heard.heardFrom] + (heard.detail ? ` · ${heard.detail}` : "")) });
  return fields;
}
