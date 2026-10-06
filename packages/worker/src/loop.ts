/** Coalesce concurrent ticks and drain the current tick when stopped. */
export function createLoop(run: () => Promise<void>, intervalMs?: number) {
  let pending: Promise<void> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let started = false;

  function tick(): Promise<void> {
    if (closed) return Promise.resolve();
    if (pending) return pending;
    pending = Promise.resolve()
      .then(run)
      .catch(error => console.warn("[worker] tick failed", error))
      .finally(() => { pending = undefined; });
    return pending;
  }

  return {
    tick,
    async start() {
      if (started || closed) return;
      started = true;
      await tick();
      if (!closed && intervalMs !== undefined) {
        interval = setInterval(() => { void tick(); }, intervalMs);
      }
    },
    async stop() {
      closed = true;
      clearInterval(interval);
      await pending;
    },
  };
}
