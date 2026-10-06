import { createUserService, type User } from "@yugidraft/shared/services";
import { getDb } from "./db";

export function ensureAuthIdentity(input: {
  discordUserId: string;
  displayName: string;
  providerEmail?: unknown;
  providerVerified?: unknown;
  captureEmail: boolean;
}): User {
  return createUserService(getDb()).ensureDiscord({
    discordUserId: input.discordUserId,
    displayName: input.displayName,
    ...(input.captureEmail ? {
      email: typeof input.providerEmail === "string" ? input.providerEmail : null,
      emailVerified: input.providerVerified === true,
    } : {}),
  });
}

/** Only the signed token's explicit Discord identity can resolve a legacy session. */
export function resolveJwtIdentity(discordUserId: unknown): User | null {
  if (typeof discordUserId !== "string" || !/^[0-9]{1,25}$/.test(discordUserId)) return null;
  const users = createUserService(getDb());
  return users.findByDiscordId(discordUserId) ?? users.ensureDiscord({
    discordUserId,
    displayName: `Duelist ${discordUserId}`,
  });
}
