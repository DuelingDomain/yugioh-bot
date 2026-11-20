"use client";
import { useSyncExternalStore } from "react";
import type { FieldTiming } from "@yugidraft/vision";

/**
 * Owner debug profile: per placement, where the time went from first motion to the rendered table.
 * Local only. Reads the `remote-field-latency` marks (field-timing.ts) and the watcher's FieldTiming.
 * Segments are consecutive, so they add up to the total (each in ms):
 *   detect   = first motion → first detector outline (scan-interval wait + detector pass)
 *   gate     = outline → identity read starts (sharpness / face-up check / tracker)
 *   read     = read start → search done (worker queue + transfer + warp + embedder + search)
 *   decide   = search done → placement commit (face-state hysteresis, stability frames, re-reads)
 *   queue    = commit → server write starts (room mutation queue)
 *   write    = write start → HTTP reply (server round trip)
 *   render   = HTTP reply → room state rendered
 */
export interface FieldProfileRow { id: string; type: string; at: number; segments: Record<string, number>; detail: Record<string, number>; totalMs: number;
  /** Per action, ms since the watcher emitted the event: each stage the action reached. Keys: handled (the watcher's holds: departure, facts, pile waits), queued, dequeued (chain wait), mutation (waits inside the work: facts reload, stale occupant), writeStart (write gate), sent (reply), rendered. */
  stages?: Record<string, number>;
  /** Emit to reply (the write is saved) in ms; 1 = over SLOW_ACTION_MS, 2 = over HARD_SLOW_ACTION_MS. `worst` is the step that took the most of it, as `from→to` (for example dequeued→mutation = the wait inside the work). */
  emitToSavedMs?: number; slow?: 0 | 1 | 2; worst?: string;
  /** The card's own trace: ms from card down to stable, read start, read end and publish, plus search source and tier. */ trace?: { stable?: number; readStart: number; readEnd: number; publish: number; source?: string; tier?: string } }
export const PROFILE_SEGMENTS = ["detect", "gate", "read", "decide", "queue", "write", "render"] as const;
/** The owner's targets for one automatic board action, from the watcher's emit to the saved reply. */
export const SLOW_ACTION_MS = 1000, HARD_SLOW_ACTION_MS = 2000;
/**
 * The per-action latency log for every action type (not only placements). OFF unless the watcher turns it on, which it does only when
 * the diagnostics switch is on (`diagnosticsAllowed`: admin with collection enabled). Off, a mark of any other type costs one flag test.
 */
let latencyUsers = 0;
/** Turns the log on for one watcher; the returned function turns that watcher's hold off. The log stays on while any watcher holds it. */
export const holdFieldLatencyLog = () => { latencyUsers++; let held = true; return () => { if (held) { held = false; latencyUsers--; } }; };

const open = new Map<string, { timing: FieldTiming; type: string; marks: Record<string, number> }>();
const rows: FieldProfileRow[] = [];
let snapshot: { last?: FieldProfileRow; rows: readonly FieldProfileRow[] } = { rows };
const listeners = new Set<() => void>();
const publish = () => { snapshot = { last: rows.at(-1), rows: [...rows] }; for (const listener of listeners) listener(); };

function build(entry: { timing: FieldTiming; type: string; marks: Record<string, number> }, final: boolean): FieldProfileRow {
  const st = entry.timing.stagesMs, d = entry.timing.durationsMs, m = entry.marks;
  const outline = st.detectorDone ?? st.firstOutline ?? 0, readStart = st.embedStartLast ?? st.embedStart ?? outline;
  const searchDone = st.searchDoneLast ?? st.searchDone ?? readStart, commit = st.commit ?? st.commitLast ?? searchDone;
  const writeStart = m.mutation ?? m.httpStart ?? commit, reply = m.httpResponse ?? m.httpState ?? writeStart, rendered = m.render ?? reply;
  const segments: Record<string, number> = {
    detect: outline, gate: Math.max(0, readStart - outline), read: Math.max(0, searchDone - readStart), decide: Math.max(0, commit - searchDone),
    queue: Math.max(0, writeStart - commit), write: Math.max(0, reply - writeStart), render: Math.max(0, rendered - reply),
  };
  const detail: Record<string, number> = {};
  for (const [key, value] of Object.entries(d)) if (Number.isFinite(value)) detail[key] = value;
  // Stage times since the event's own emit (`commit` is set per emitted event), not since the track's first sighting.
  const emit = st.commit ?? st.commitLast, stages: Record<string, number> = {};
  if (emit !== undefined) for (const [name, mark] of [["handled", m.watcher], ["queued", m.queued], ["dequeued", m.dequeued], ["mutation", m.mutation], ["writeStart", m.writeDequeued ?? m.httpStart], ["sent", m.httpResponse ?? m.httpState], ["rendered", m.render]] as const) {
    if (mark !== undefined) stages[name] = Math.max(0, Math.round(mark - emit));
  }
  const emitToSavedMs = stages.sent, slow = emitToSavedMs === undefined ? undefined : emitToSavedMs > HARD_SLOW_ACTION_MS ? 2 : emitToSavedMs > SLOW_ACTION_MS ? 1 : 0;
  let worst: string | undefined, previous = 0, before = "emit", longest = -1;
  for (const [name, at] of Object.entries(stages)) { if (name === "rendered") break; if (at - previous > longest) { longest = at - previous; worst = `${before}→${name}`; } previous = at; before = name; }
  const trace = { stable: st.stable, readStart, readEnd: searchDone, publish: commit, source: entry.timing.notes?.source, tier: entry.timing.notes?.tier };
  return { id: entry.timing.id, type: entry.type, at: Date.now(), segments, detail, totalMs: final ? rendered : commit, trace, stages, ...(emitToSavedMs === undefined ? {} : { emitToSavedMs, slow, worst }) };
}

if (typeof window !== "undefined") window.addEventListener("remote-field-latency", (raw: Event) => {
  const event = (raw as CustomEvent<FieldTiming & { stage: string; elapsedMs: number; type?: string }>).detail;
  if (!event?.id) return;
  let entry = open.get(event.id);
  if (event.stage === "watcher") {
    const always = event.type === "placed" || event.type === "prompt";
    if (!always && (latencyUsers === 0 || !event.type || event.type === "reading")) return;
    entry = { timing: { id: event.id, originAt: event.originAt, stagesMs: event.stagesMs, durationsMs: event.durationsMs, notes: event.notes }, type: event.type!, marks: { watcher: event.elapsedMs } };
    open.set(event.id, entry);
    while (open.size > 32) open.delete(open.keys().next().value!);
    rows.push(build(entry, false)); while (rows.length > 50) rows.shift(); publish(); return;
  }
  if (!entry) return;
  entry.marks[event.stage] ??= event.elapsedMs;
  const index = rows.findIndex(r => r.id === event.id);
  if (index >= 0) {
    const before = rows[index].slow;
    rows[index] = build(entry, event.stage === "render"); publish();
    const row = rows[index];
    // One line per slow action, once, when its write is saved. Stage names say where the time went.
    if (latencyUsers > 0 && row.slow && row.slow > (before ?? 0))
      console.warn(`[remote latency] ${row.type} ${row.emitToSavedMs} ms (${row.slow === 2 ? ">2 s" : ">1 s"}) longest step: ${row.worst}`, row.stages);
  }
  if (event.stage === "render") open.delete(event.id);
});

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useFieldProfile = () => useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
export function percentile(values: number[], p: number): number | undefined {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : undefined;
}
