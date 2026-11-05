import type Database from "better-sqlite3";
import { createClerkBackend } from "@yugidraft/shared/clerk";
import { createReleaseEmailOutbox, createResendProvider, emailConfig, missingEmailConfig, type AudienceClerk, type EmailProvider } from "@yugidraft/shared/email";
import { createLoop } from "./loop.js";

/** Independent of Discord/bot enablement; stop() waits for any in-flight provider request. */
export function createEmailDrain(options: {
  db: Database.Database; env?: Record<string, string | undefined>; clerk?: AudienceClerk; provider?: EmailProvider;
}) {
  const env = options.env ?? process.env, config = emailConfig(env);
  const outbox = createReleaseEmailOutbox(options.db, config);
  const enabled = missingEmailConfig(config).length === 0 && !!(options.clerk || env.CLERK_SECRET_KEY);
  // Construction does no network I/O, and missing mail configuration never initializes a sender.
  const clerk = enabled ? options.clerk ?? createClerkBackend({ secretKey: env.CLERK_SECRET_KEY! }) : undefined;
  const provider = enabled ? options.provider ?? createResendProvider({ apiKey: config.apiKey }) : undefined;
  return createLoop(async () => { if (clerk && provider) await outbox.drain({ clerk, provider }); }, 1000);
}
