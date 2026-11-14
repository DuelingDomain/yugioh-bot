import type { MetricsSnapshot } from "@/components/remote/ui/voice/metrics";

export const METRICS_NOTE = "Worker busy ms are performance.now() elapsed time around KWS accept/decode or ASR transcription (including awaited runtime work). Busy ms / wall second estimates a share of one core; it is not OS CPU usage. It excludes capture, worklet, gate, messaging, UI, model initialization and vision. Load bytes count uncompressed model files, excluding worker/runtime/WASM and cache transfer effects.";
const ms = (value: number | null) => value === null ? "—" : value.toFixed(1);
export function VoiceMeasurements({ value }: { value: MetricsSnapshot | null }) {
  if (!value) return <div>Measurements start when the listener is ready.</div>;
  return <div data-testid="measurements" style={{ display: "grid", gap: 4 }}>
    {(["stage1", "stage2"] as const).map((stage, index) => {
      const s = value[stage];
      return <div key={stage}>Stage {index + 1} ({index ? "speech model" : "keywords"}): {s.cpu ? `${s.cpu.msPerSecond.toFixed(1)} busy ms/wall s ≈ ${s.cpu.percent.toFixed(2)}% of one core` : "—"}.
        {" "}Idle listening: {s.idleCpu ? `${s.idleCpu.msPerSecond.toFixed(1)} ms/s ≈ ${s.idleCpu.percent.toFixed(2)}%` : "no idle interval measured"}.
        {" "}Load: {s.load ? `${s.load.totalMs.toFixed(0)} ms (fetch ${s.load.fetchMs.toFixed(0)}, init ${s.load.initMs.toFixed(0)}), ${(s.load.bytes / 1e6).toFixed(1)} MB model bytes` : "not loaded"}.</div>;
    })}
    <div>Stage-1 hits {value.stage1Hits}; stage-2 runs {value.stage2Runs}, confirmations {value.stage2Confirmations}, rejections {value.stage2Rejections}; queue drops {value.stage2QueueDrops}. End of speech (energy estimate) → decision: mean {ms(value.latency.meanMs)} / p95 {ms(value.latency.p95Ms)} ms ({value.latency.count} decisions; includes silence gate, queue and first-hit load).</div>
    <div>Listening wall time {(value.wallMs / 1000).toFixed(1)} s; no-command idle interval {(value.idleWallMs / 1000).toFixed(1)} s{value.idleActive ? " (measuring)" : ""}.</div>
  </div>;
}
