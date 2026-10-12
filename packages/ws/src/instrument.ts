import { isMainThread } from "node:worker_threads";
import "dotenv/config";
import * as Sentry from "@sentry/node";
import { isExpectedError, redactEvent, type ObservabilityAdapter } from "@yugidraft/shared/observability";
import { bootstrapObservability } from "@yugidraft/shared/observability/node-bootstrap";

if (isMainThread) bootstrapObservability(() => {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT,
    release: process.env.SENTRY_RELEASE,
    sendDefaultPii: false,
    tracesSampleRate: 0.05,
    integrations: defaults => defaults.filter(integration => !["Console", "LocalVariables", "OnUncaughtException", "OnUnhandledRejection"].includes(integration.name)),
    beforeSend: (event, hint) => isExpectedError(hint.originalException) ? null : redactEvent(event),
    beforeSendTransaction: event => redactEvent(event),
    beforeBreadcrumb: breadcrumb => redactEvent(breadcrumb),
  });
  const adapter: ObservabilityAdapter = {
    report(error, context) {
      Sentry.captureException(error, {
        ...(context.userId === undefined ? {} : { user: { id: String(context.userId) } }),
        tags: context.tags,
        extra: context.extra,
      });
    },
    log(level, message, fields) {
      Sentry.addBreadcrumb(redactEvent({ level: level === "warn" ? "warning" : level, message, data: fields }));
      // Keep operational logs available when remote reporting is configured.
      console[level](redactEvent(message), redactEvent(fields));
    },
    async flush(timeoutMs) { await Sentry.flush(timeoutMs); },
  };
  return adapter;
});
