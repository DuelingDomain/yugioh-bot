import type { ClerkUserJson } from "./backend.js";

export interface ClerkProfile {
  clerkUserId: string;
  username: string | null;
  displayName: string;
  email: string | null;
  emailVerified: boolean;
  discordUserId: string | null;
  imageUrl: string | null;
}

export function profileFromClerkUser(user: ClerkUserJson): ClerkProfile {
  const primary = user.email_addresses.find(email => email.id === user.primary_email_address_id);
  const email = primary?.email_address.trim().toLowerCase() || null;
  const name = [user.first_name?.trim(), user.last_name?.trim()].filter(Boolean).join(" ");
  const discord = user.external_accounts.find(account => account.provider === "oauth_discord"
    && account.verification?.status === "verified" && /^[0-9]{1,25}$/.test(account.provider_user_id));
  // Only the backend can set private metadata. Recovery proves this account
  // directly with Discord before creating Clerk's email-only user. Preserve it
  // through the first sync, which precedes Clerk linking an external account.
  const recoveredDiscord = user.private_metadata?.existingPlayerDiscordId;
  const recoveryId = typeof recoveredDiscord === "string" && /^[0-9]{1,25}$/.test(recoveredDiscord) ? recoveredDiscord : null;
  return {
    clerkUserId: user.id, username: user.username,
    displayName: name || user.username?.trim() || email?.split("@")[0] || "Duelist",
    email, emailVerified: email !== null && primary?.verification?.status === "verified",
    discordUserId: discord?.provider_user_id ?? recoveryId, imageUrl: user.image_url,
  };
}
