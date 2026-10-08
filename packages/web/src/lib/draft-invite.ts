/**
 * Browser side of draft visibility. The shared pieces (address helpers, the redeem result, the labels) live in
 * `invite-link.ts`; this file is the draft's client on top of them.
 */
import type { DraftVisibility } from "@yugidraft/shared/types";
import { draftInviteApi, InviteError } from "./invite-link";

export {
  INVITE_PARAM,
  readInviteParam,
  signInHref,
  stripInviteParam,
  VISIBILITY_HELP,
  VISIBILITY_LABEL,
  type RedeemResult,
} from "./invite-link";

export const DraftInviteError = InviteError;
export type DraftInviteError = InviteError;

/** POST /api/drafts/[slug]/invite. Gives the signed-in user read access; it does not take a seat. */
export const redeemDraftInvite = (slug: string, code: string) => draftInviteApi.redeem(slug, code);

/** GET /invite (host only): the current link. The server creates the code the first time. */
export const fetchInviteUrl = (slug: string) => draftInviteApi.fetchUrl(slug);

/** POST /invite/reset (host only): a new link. The old one stops admitting new people; people already in keep access. */
export const resetInviteUrl = (slug: string) => draftInviteApi.resetUrl(slug);

/** PATCH /visibility (host only, pending drafts only). */
export const patchVisibility = (slug: string, visibility: DraftVisibility) => draftInviteApi.patchVisibility(slug, visibility);
