import * as Sentry from "@sentry/nextjs";
import { initializeSentry } from "./src/lib/sentry";

initializeSentry(process.env.NEXT_PUBLIC_SENTRY_DSN, process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT, process.env.NEXT_PUBLIC_SENTRY_RELEASE);
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
