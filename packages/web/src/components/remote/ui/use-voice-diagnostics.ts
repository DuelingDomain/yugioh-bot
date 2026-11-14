"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RemoteEvent } from "@yugidraft/shared/remote";
import { VoiceDiagnosticsBatcher, type VoiceRecord, type VoiceMark } from "@/lib/remote/voice-diagnostics";

export function useVoiceDiagnostics(enabled: boolean, slug: string, events: RemoteEvent[]) {
  const batch = useRef<VoiceDiagnosticsBatcher | null>(null);
  const [last, setLast] = useState<Extract<VoiceRecord, { kind: "utterance" }> | null>(null);
  const recent = useRef<string[]>([]);
  const actions = useRef(new Map<string, { utteranceId: string; method: VoiceRecord["method"]; at: number }>());
  useEffect(() => {
    if (!enabled) { setLast(null); recent.current = []; actions.current.clear(); return; }
    const queue = new VoiceDiagnosticsBatcher((body, hiding) => {
      const url = `/api/remote/${encodeURIComponent(slug)}/voice-diagnostics`;
      if (hiding && navigator.sendBeacon?.(url, new Blob([body], { type: "application/json" }))) return;
      void fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: hiding }).catch(() => {});
    });
    batch.current = queue;
    const timer = setInterval(() => queue.flush(), 5000);
    const hide = () => { if (document.visibilityState === "hidden") queue.flush(true); };
    const leave = () => queue.flush(true);
    document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", leave);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", leave); queue.flush(true); batch.current = null; };
  }, [enabled, slug]);
  const record = useCallback((value: VoiceRecord) => {
    if (!enabled || !batch.current) return;
    batch.current.add(value);
    if (value.kind === "utterance") { setLast(value); recent.current = [...recent.current, value.utteranceId].slice(-5); }
    if ((value.kind === "utterance" || value.kind === "decision") && value.decision.actionId) {
      actions.current.set(value.decision.actionId, { utteranceId: value.utteranceId, method: value.method, at: value.at });
      while (actions.current.size > 100) actions.current.delete(actions.current.keys().next().value!);
    }
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    for (const event of events) {
      if (event.action.type !== "undo") continue;
      const target = actions.current.get(event.action.targetActionId);
      if (!target) continue;
      record({ kind: "undo", at: Date.now(), method: target.method, utteranceId: target.utteranceId, actionId: event.action.targetActionId, msSinceAction: Math.max(0, Date.now() - target.at) });
      actions.current.delete(event.action.targetActionId);
    }
  }, [enabled, events, record]);
  const mark = (input: Omit<VoiceMark, "kind" | "at">) => record({ ...input, kind: "mark", at: Date.now() });
  return { record, last, recentIds: recent.current, mark };
}
