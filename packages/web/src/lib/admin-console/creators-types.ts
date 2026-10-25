/**
 * CONTRACT FILE: the wire shapes of the creator fast-track routes. Frozen; changes go through the lead.
 * Service shapes come from @yugidraft/shared/services/creator-access (type-only imports are safe in client code).
 * All owner routes: requireWebAccess, isOwnerUser else 404 { error: "not_found" }, mutating routes need
 * Origin === webOrigin() else 403 { error: "invalid_origin" }. Headers cache-control: private, no-store.
 */
import type {
  AddEmailResult, Creator, CreatorDetail, CreatorLink, CreatorSummary, LinkState, ResendResult,
} from "@yugidraft/shared/services/creator-access";

export type { AddEmailResult, Creator, CreatorDetail, CreatorGrant, CreatorJoinedPerson, CreatorLink, CreatorSummary, LinkState } from "@yugidraft/shared/services/creator-access";

/**
 * Admin console section "creators": GET /api/admin/console/creators?start=<local midnight epoch ms>
 * returns SectionResult<CreatorsData> (same envelope and guard as every other section, polled every 30 s).
 */
export interface CreatorsData {
  creators: CreatorSummary[];
  /** Creator sign-ups since `start` (default: last 24 h). Overview tile "Creator sign-ups today". */
  signUpsToday: number;
  /** Sends left in the shared hourly Clerk budget (80 per hour for links, emails and resends). */
  sendBudgetLeft: number;
}

/** POST /api/admin/console/creators  body CreateCreatorBody -> 201 CreateCreatorResponse | 400 { error } */
export interface CreateCreatorBody { name: string; channelUrl?: string | null; notes?: string | null; email?: string | null }
export interface CreateCreatorResponse { creator: Creator; email?: AddEmailResult }

/** GET /api/admin/console/creators/[id] -> 200 CreatorDetailResponse | 404 { error: "not_found" } */
export interface CreatorDetailResponse extends CreatorDetail {
  /** Absolute join URL per link id: `${WEB_URL}/join/<code>`. */
  linkUrls: Record<number, string>;
}

/** PATCH /api/admin/console/creators/[id]  body UpdateCreatorBody -> 200 { creator } */
export interface UpdateCreatorBody { name?: string; channelUrl?: string | null; notes?: string | null; archived?: boolean }

/** POST /api/admin/console/creators/[id]/links  body CreateLinkBody -> 201 CreateLinkResponse */
export interface CreateLinkBody { label?: string | null; maxUses: number; expiresInDays: number }
export interface CreateLinkResponse { link: CreatorLink; url: string }

/** POST /api/admin/console/creators/[id]/links/[linkId]/revoke  (no body) -> 200 RevokeLinkResponse */
export interface RevokeLinkResponse { revoked: true; invitationsRevoked: number }

/** POST /api/admin/console/creators/[id]/emails  body AddEmailsBody (1-20) -> 200 AddEmailsResponse | 429 busy */
export interface AddEmailsBody { emails: string[] }
export interface AddEmailsResponse { results: AddEmailResult[] }

/** POST /api/admin/console/creators/grants/[id]/resend  (no body) -> 200 ResendResponse | 429 busy */
export interface ResendResponse { result: ResendResult["kind"] }

/** 429 body for every send path when a limit is hit. No use is claimed. */
export interface BusyResponse { error: "busy"; retryAfterSeconds: number }

/**
 * Public join: POST /api/join/[code]  JSON body JoinBody, Origin must equal webOrigin().
 *  200 { status: "sent" }      claimed+sent, same inbox already granted, or existing account (generic, no leak)
 *  409 { status: LinkState }   full / expired / revoked: show the waitlist form (source "creator:<code>")
 *  404 { status: "revoked" }   unknown code reads like a closed link
 *  400 { error: "invalid_email" } | 403 { error: "invalid_origin" } | 415 | 429 BusyResponse
 *  503 { error: "retry_later" } Clerk failed; the grant is failed and no use is counted
 * Honeypot `company` non-empty -> 200 { status: "sent" } with no write. Body max 2 KB.
 * Limits: 5 posts per IP per 10 min, 20 sends per link per hour, 80 sends per hour in all (shared budget).
 * The response never contains a ticket, invitation URL, invitation id or grant id.
 */
export interface JoinBody { email: string; company?: string }
export type JoinResponse = { status: "sent" } | { status: LinkState } | { error: string; retryAfterSeconds?: number };

/** What /join/[code] page renders from (server side, via publicLink). */
export interface JoinPageProps { code: string; state: LinkState; creatorName: string; spotsLeft: number }
