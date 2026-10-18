import { report } from "../observability/index.js";

export const DEFAULT_GENESYS_SYNC_CRON = "0 6 * * 0";

type ScheduledJob = { stop(): unknown; destroy(): unknown };

/** Shared lifecycle; bot/worker supply their existing node-cron scheduler. */
export function createGenesysPointsSync(options: {
  cards: { syncGenesysPoints(options?: { effectiveDate?: string; expectedRevision?: string }): Promise<unknown> };
  schedule: (expression: string, tick: () => void, options: { timezone: string }) => ScheduledJob;
  expression?: string;
  timezone?: string;
  effectiveDate?: string;
  expectedRevision?: string;
  onError?: (error: unknown) => void;
}) {
  let scheduled: ScheduledJob | undefined;
  let pending: Promise<void> | undefined;
  let closed = false;
  function tick(): Promise<void> {
    if (closed) return Promise.resolve();
    return pending ??= Promise.resolve()
      .then(async () => { await options.cards.syncGenesysPoints({ effectiveDate: options.effectiveDate, expectedRevision: options.expectedRevision }); })
      .catch(error => {
        if (options.onError) options.onError(error);
        else report(error, { tags: { operation: "[genesys] points sync failed" } });
      })
      .finally(() => { pending = undefined; });
  }
  return {
    tick,
    async start() {
      if (closed || scheduled) return;
      scheduled = options.schedule(options.expression ?? DEFAULT_GENESYS_SYNC_CRON, () => { void tick(); },
        { timezone: options.timezone ?? "UTC" });
      await tick();
    },
    async stop() {
      closed = true;
      await scheduled?.stop();
      await pending;
      await scheduled?.destroy();
    },
  };
}
