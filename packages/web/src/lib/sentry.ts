import * as Sentry from "@sentry/nextjs";
import { isExpectedError, redactEvent, setObservabilityAdapter, type ObservabilityAdapter } from "@yugidraft/shared/observability";

export function initializeSentry(dsn: string | undefined, environment: string | undefined, release: string | undefined): void {
  if (!dsn) return;
  try {
    Sentry.init({
      dsn, environment, release,
      sendDefaultPii: false,
      tracesSampleRate: 0.05,
      integrations: defaults => defaults.filter(integration => !["Console", "Breadcrumbs", "LocalVariables"].includes(integration.name)),
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
        console[level](redactEvent(message), redactEvent(fields));
      },
      async flush(timeoutMs) { await Sentry.flush(timeoutMs); },
    };
    setObservabilityAdapter(adapter);
  } catch {}
}
