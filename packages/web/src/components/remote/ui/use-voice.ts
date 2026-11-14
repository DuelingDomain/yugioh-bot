"use client";

import { useEffect, useRef, useState } from "react";
import type { GrammarContext } from "./grammar";
import type { VoiceFinal, createLiveVoiceClient } from "./voice/live-client";
import { voiceMethods, type VoiceMethod } from "@/lib/remote/voice-diagnostics";
import type { VoiceRecord } from "@/lib/remote/voice-diagnostics";

export type MicState = "listen" | "idle" | "muted" | "off";
const METHOD_KEY = "dd-remote-voice-method";
type Options = {
  enabled: boolean; state: MicState; ptt: boolean; held: boolean;
  context(): GrammarContext;
  onFinal(final: VoiceFinal, gate: MicState): void;
  onPerf?(record: Extract<VoiceRecord, { kind: "perf" }>): void;
};

export function useVoice(options: Options) {
  const [method, setMethod] = useState<VoiceMethod>("two-stage");
  const [level, setLevel] = useState(0), [speaking, setSpeaking] = useState(false);
  const [service, setService] = useState<"connecting" | "ready" | "closed" | "unused">("unused");
  const [micError, setMicError] = useState("");
  const opt = useRef(options); opt.current = options;
  useEffect(() => {
    if (!options.enabled) return;
    try { const stored = localStorage.getItem(METHOD_KEY); const found = voiceMethods.find(value => value === stored); if (found) setMethod(found); } catch { /* storage may be disabled */ }
  }, [options.enabled]);
  const pickMethod = (next: VoiceMethod) => { setMethod(next); try { localStorage.setItem(METHOD_KEY, next); } catch { /* choice still works */ } };
  const wantMic = options.enabled && options.state !== "muted" && options.state !== "off";
  useEffect(() => {
    if (!wantMic) { setLevel(0); setSpeaking(false); setService("unused"); return; }
    let disposed = false;
    let client: ReturnType<typeof createLiveVoiceClient> | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    setMicError(""); setService("connecting");
    // No voice worker, WASM, model, worklet, or microphone is requested before this branch.
    void import("./voice/live-client").then(({ createLiveVoiceClient }) => {
      if (disposed) return;
      let idle = true, last = performance.now(), busy1 = 0, busy2 = 0;
      const perf = () => {
        if (!client) return;
        const now = performance.now(), snapshot = client.metrics.snapshot(now);
        opt.current.onPerf?.({ kind: "perf", at: Date.now(), method, windowMs: now - last, stage1BusyMs: snapshot.stage1.busyMs - busy1, stage2BusyMs: snapshot.stage2.busyMs - busy2, idle });
        last = now; busy1 = snapshot.stage1.busyMs; busy2 = snapshot.stage2.busyMs; idle = true;
      };
      client = createLiveVoiceClient({ method, context: () => opt.current.context(), accepting: () => opt.current.enabled && opt.current.state !== "muted" && opt.current.state !== "off" && (!opt.current.ptt || opt.current.held),
        onFinal: final => { if (!disposed) { idle = false; opt.current.onFinal(final, opt.current.state); } },
        onLevel: (value, talking) => { if (!disposed) { if (talking) idle = false; setLevel(value); setSpeaking(talking); } },
        onReady: () => { if (!disposed) { setService("ready"); last = performance.now(); if (opt.current.onPerf) timer = setInterval(perf, 5000); } },
        onError: message => { if (!disposed) { setMicError(message); setService("closed"); client?.stop(); clearInterval(timer); } },
      });
      return client.start();
    }).catch(error => { if (!disposed) { setMicError(error instanceof Error ? error.message : "Microphone unavailable"); setService("closed"); client?.stop(); } });
    return () => { disposed = true; clearInterval(timer); client?.stop(); setLevel(0); setSpeaking(false); };
  }, [wantMic, method]);
  return { level, speaking, service, micError, method, pickMethod };
}
