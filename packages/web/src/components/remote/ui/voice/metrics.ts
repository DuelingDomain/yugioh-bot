export type Stage = "stage1" | "stage2";
export type ModelLoad = { totalMs: number; fetchMs: number; initMs: number; bytes: number };
export type StageWork = { stage: Stage; busyMs: number; audioMs: number };

/** Elapsed worker work / elapsed wall time. This estimates a single core, not OS CPU accounting. */
export function cpuShare(busyMs: number, wallMs: number) {
  return wallMs > 0 ? { msPerSecond: busyMs * 1000 / wallMs, percent: busyMs * 100 / wallMs } : null;
}
export function latencySummary(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, meanMs: sorted.length ? sorted.reduce((sum, n) => sum + n, 0) / sorted.length : null,
    p95Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null };
}

export class VoiceMetrics {
  private started: number | undefined;
  private stopped: number | undefined;
  private busy = { stage1: 0, stage2: 0 };
  private loads: Partial<Record<Stage, ModelLoad>> = {};
  private latencies: number[] = [];
  private idle: { started: number; busy: Record<Stage, number> } | undefined;
  private idleWallMs = 0;
  private idleBusy = { stage1: 0, stage2: 0 };
  private counts = { stage1Hits: 0, stage2Runs: 0, stage2Confirmations: 0, stage2Rejections: 0, stage2QueueDrops: 0 };
  start(now = performance.now()) { this.started ??= now; }
  stop(now = performance.now()) { this.setIdle(false, now); this.stopped = now; }
  work(work: StageWork) { this.busy[work.stage] += work.busyMs; }
  load(stage: Stage, load: ModelLoad) { this.loads[stage] = load; }
  hit(count: number) { this.counts.stage1Hits += count; }
  queueDrop() { this.counts.stage2QueueDrops++; }
  run() { this.counts.stage2Runs++; }
  verification(confirmed: boolean) { if (confirmed) this.counts.stage2Confirmations++; else this.counts.stage2Rejections++; }
  decision(latencyMs: number) { this.latencies.push(Math.max(0, latencyMs)); }
  /** Explicit no-command interval: includes background talk, noise and false hits. */
  setIdle(active: boolean, now = performance.now()) {
    if (active && !this.idle) this.idle = { started: now, busy: { ...this.busy } };
    else if (!active && this.idle) {
      this.idleWallMs += now - this.idle.started;
      for (const stage of ["stage1", "stage2"] as const) this.idleBusy[stage] += this.busy[stage] - this.idle.busy[stage];
      this.idle = undefined;
    }
  }
  snapshot(now = performance.now()) {
    const wallMs = this.started === undefined ? 0 : Math.max(0, (this.stopped ?? now) - this.started);
    const idleWallMs = this.idleWallMs + (this.idle ? now - this.idle.started : 0);
    const stage = (key: Stage) => ({ busyMs: this.busy[key], cpu: cpuShare(this.busy[key], wallMs), load: this.loads[key] ?? null, idleBusyMs: this.idleBusy[key] + (this.idle ? this.busy[key] - this.idle.busy[key] : 0),
      idleCpu: cpuShare(this.idleBusy[key] + (this.idle ? this.busy[key] - this.idle.busy[key] : 0), idleWallMs) });
    return { wallMs, idleWallMs, idleActive: !!this.idle, stage1: stage("stage1"), stage2: stage("stage2"), ...this.counts, latency: latencySummary(this.latencies) };
  }
}
export type MetricsSnapshot = ReturnType<VoiceMetrics["snapshot"]>;
