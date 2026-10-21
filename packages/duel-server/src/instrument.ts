import { isMainThread } from "node:worker_threads";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { isExpectedError, redactEvent, type ObservabilityAdapter } from "@yugidraft/shared/observability";
import { bootstrapObservability } from "@yugidraft/shared/observability/node-bootstrap";

// Workers inherit --import. Keep the SDK and its instrumentation graph in the
// host: engine threads already send their errors there for reporting.
if (isMainThread) {
  config({ path: process.env.DOTENV_CONFIG_PATH ?? fileURLToPath(new URL("../../../.env", import.meta.url)) });
  const Sentry = await import("@sentry/node");
  bootstrapObservability(() => {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT,
      release: process.env.SENTRY_RELEASE,
      sendDefaultPii: false,
      dataCollection: {
        urlQueryParams: false, userInfo: false, cookies: false, httpHeaders: false, httpBodies: [],
        graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false },
        databaseQueryData: false, stackFrameVariables: false,
      },
      tracesSampleRate: 0.05,
      integrations: defaults => defaults.filter(integration => !["Console", "LocalVariables", "OnUncaughtException", "OnUnhandledRejection"].includes(integration.name)),
      beforeSend: (event, hint) => isExpectedError(hint.originalException) ? null : redactEvent(event),
      beforeSendTransaction: event => redactEvent(event),
      beforeSendSpan: span => redactEvent(span),
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
}
