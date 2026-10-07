import type { SessionIdentity } from "@/lib/session-identity";

export type AccountConflict = NonNullable<SessionIdentity["conflict"]>;

/** What the account page says when linking found a conflict. `both_have_history` is the contract's exact sentence. */
export const CONFLICT_MESSAGES: Record<AccountConflict, string> = {
  both_have_history: "Both accounts have activity. Nothing was merged. Email support@duelingdomain.com and we can merge them.",
  discord_claimed: "That Discord account is already connected to another Dueling Domain account. Nothing was changed.",
};

export const REFRESH_FAILED_MESSAGE = "We couldn't check your connected accounts just now. Try again in a moment.";
