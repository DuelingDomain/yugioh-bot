import type { ObservabilityAdapter } from "./index.js";
import { redactEvent, redactText } from "./redact.js";

export const consoleAdapter: ObservabilityAdapter = {
  report(error, context) {
    console.error(redactEvent({
      name: error instanceof Error ? error.name : "Error",
      message: redactText(error instanceof Error ? error.message : String(error)),
      stack: error instanceof Error ? error.stack : undefined,
      tags: context.tags,
      extra: context.extra,
      ...(context.userId === undefined ? {} : { user: { id: String(context.userId) } }),
    }));
  },
  log(level, message, fields) {
    console[level](redactText(message), redactEvent(fields));
  },
  async flush() {},
};
