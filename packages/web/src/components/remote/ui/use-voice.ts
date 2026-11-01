"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SttClient, type SttFinal } from "./stt-client";

export type MicState = "listen" | "idle" | "muted" | "off";
export type VoiceTranscript = { requestId: string; text: string; normalizedText: string; gate: MicState; live: boolean; result?: string; ignored?: boolean };

const WORKLET = `class T extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor('pcm-tap',T)`;
const FRAME = 320; // 20 ms at 16 kHz
const PREROLL = 15; const START_FRAMES = 3; const END_FRAMES = 28; const MIN_SPEECH = 8; const MAX_FRAMES = 700;

type Options = {
  /** The table is live and this browser may use a mic. */
  enabled: boolean;
  /** "listen" streams everything, "idle" streams too but the caller only accepts wake words, "muted" stops the mic. */
  state: MicState;
  ptt: boolean;
  held: boolean;
  hotwords: string[];
  onFinal: (final: SttFinal, gate: MicState) => void;
  onCorrection: (final: SttFinal) => void;
};

/** Local mic -> 16 kHz PCM -> local speech service. Only your own mic is captured. */
export function useVoice(options: Options) {
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [partial, setPartial] = useState("");
  const [service, setService] = useState<"connecting" | "ready" | "closed" | "unused">("unused");
  const [micError, setMicError] = useState("");
  const opt = useRef(options); opt.current = options;
  const clientRef = useRef<SttClient | null>(null);
  const gates = useRef(new Map<string, MicState>());

  const wantMic = options.enabled && options.state !== "muted" && options.state !== "off";
  useEffect(() => {
    if (!wantMic) { setLevel(0); setSpeaking(false); return; }
    let disposed = false; let stream: MediaStream | undefined; let context: AudioContext | undefined;
    const client = new SttClient({
      onPartial: (_id, text) => setPartial(text),
      onFinal: result => { setPartial(""); const gate = gates.current.get(result.requestId) ?? opt.current.state; gates.current.delete(result.requestId); opt.current.onFinal(result, gate); },
      onCorrection: result => opt.current.onCorrection(result),
      onError: message => setMicError(message),
      onState: state => setService(state),
    });
    clientRef.current = client;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (disposed) { stream.getTracks().forEach(t => t.stop()); return; }
        context = new AudioContext();
        const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
        await context.audioWorklet.addModule(url); URL.revokeObjectURL(url);
        const source = context.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(context, "pcm-tap");
        const mute = context.createGain(); mute.gain.value = 0; source.connect(node); node.connect(mute).connect(context.destination);
        const ratio = context.sampleRate / 16000;
        let position = 0; let last = 0; const samples: number[] = [];
        let noise = 0.01; let loud = 0; let quiet = 0; let inSpeech = false; let spoken = 0; let total = 0; let pending = false;
        const preroll: ArrayBuffer[] = []; let lastLevelAt = 0; let wasHeld = false;
        const finish = (cancel: boolean) => {
          inSpeech = false; spoken = 0; total = 0; quiet = 0; loud = 0; setSpeaking(false);
          if (cancel) client.cancel(); else client.end();
        };
        const frame = (pcm: Float32Array) => {
          let sum = 0; for (const value of pcm) sum += value * value;
          const rms = Math.sqrt(sum / pcm.length);
          const buffer = new ArrayBuffer(pcm.length * 2); const view = new DataView(buffer);
          pcm.forEach((value, index) => view.setInt16(index * 2, Math.max(-1, Math.min(1, value)) * 0x7fff, true));
          const now = performance.now();
          if (now - lastLevelAt > 60) { lastLevelAt = now; setLevel(Math.min(1, rms * 8)); }
          const o = opt.current;
          const ptt = o.ptt;
          if (ptt) {
            if (o.held && !wasHeld && !client.busy && !pending) { pending = true; gates.current.clear(); void client.start(o.hotwords).then(id => { pending = false; if (id) { gates.current.set(id, o.state); inSpeech = true; setSpeaking(true); for (const old of preroll) client.push(old); } }); }
            if (inSpeech && o.held) client.push(buffer);
            if (!o.held && wasHeld && inSpeech) finish(false);
            wasHeld = o.held; if (!o.held) { preroll.push(buffer); if (preroll.length > PREROLL) preroll.shift(); }
            return;
          }
          wasHeld = false;
          if (!inSpeech) {
            noise = Math.min(0.05, noise * 0.995 + rms * 0.005);
            const threshold = Math.max(0.018, noise * 3.2);
            loud = rms > threshold ? loud + 1 : 0;
            preroll.push(buffer); if (preroll.length > PREROLL) preroll.shift();
            if (loud >= START_FRAMES && !client.busy && !pending) {
              pending = true; loud = 0; const snapshot = preroll.splice(0);
              void client.start(o.hotwords).then(id => {
                pending = false; if (!id) return;
                gates.current.set(id, o.state); inSpeech = true; spoken = START_FRAMES; total = snapshot.length; quiet = 0; setSpeaking(true);
                for (const old of snapshot) client.push(old);
              });
            }
            return;
          }
          client.push(buffer); total++;
          const threshold = Math.max(0.018, noise * 2.4);
          if (rms > threshold) { spoken++; quiet = 0; } else quiet++;
          if (quiet >= END_FRAMES || total >= MAX_FRAMES) finish(spoken < MIN_SPEECH);
        };
        node.port.onmessage = event => {
          const input = event.data as Float32Array;
          for (const value of input) {
            // linear resample to 16 kHz
            while (position < 1) {
              samples.push(last + (value - last) * position); position += ratio;
            }
            position -= 1; last = value;
          }
          while (samples.length >= FRAME) frame(Float32Array.from(samples.splice(0, FRAME)));
        };
      } catch (error) { if (!disposed) setMicError((error as Error).message || "Microphone unavailable"); }
    })();
    return () => {
      disposed = true; client.cancel(); client.close(); clientRef.current = null;
      stream?.getTracks().forEach(t => t.stop()); void context?.close(); setLevel(0); setSpeaking(false);
    };
  }, [wantMic]);

  const reset = useCallback(() => setPartial(""), []);
  return { level, speaking, partial, service, micError, reset };
}
