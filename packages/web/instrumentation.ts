import { log } from "@yugidraft/shared/observability";
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      const { startWebHealth } = await import("./src/lib/vps-health-reporter");
      startWebHealth();
      const { startPhoneCleanup } = await import("./src/lib/remote/phone-server");
      startPhoneCleanup();
    }
  }
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
  if (process.env.NODE_ENV !== "production" || process.env.NEXT_RUNTIME !== "nodejs") return;
  const checks: Array<[string, string | undefined]> = [
    ["WS_INTERNAL_URL", process.env.WS_INTERNAL_URL],
    ["WS_INTERNAL_SECRET", process.env.WS_INTERNAL_SECRET],
    ["BOT_ANNOUNCE_URL", process.env.BOT_ANNOUNCE_URL],
    ["BOT_ANNOUNCE_SECRET", process.env.BOT_ANNOUNCE_SECRET],
  ];
  for (const [name, value] of checks) {
    if (!value) {
      log("warn", "[startup] missing broadcast configuration", { name });
    }
  }
}

export const onRequestError = Sentry.captureRequestError;
