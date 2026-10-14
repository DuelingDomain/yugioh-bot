import { initializeSentry } from "./src/lib/sentry";
initializeSentry(process.env.SENTRY_DSN, process.env.SENTRY_ENVIRONMENT, process.env.SENTRY_RELEASE);
