import { SAMPLE_RATE } from "./model";

const WORKLET = `class R extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice());return true}}registerProcessor('test-set-recorder',R)`;

export type Recording = { done: Promise<Float32Array>; finish(): void; cancel(): void };

export async function recordMicrophone(targetMs: number, onProgress: (ms: number, level: number) => void, signal: AbortSignal): Promise<Recording> {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  let stream: MediaStream | undefined; let moduleUrl: string | undefined;
  const cleanup = () => { stream?.getTracks().forEach(track => track.stop()); void context.close(); if (moduleUrl) URL.revokeObjectURL(moduleUrl); };
  try {
    await Promise.race([context.resume(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("AudioContext did not start; click Record again")), 2000))]);
    if (context.sampleRate !== SAMPLE_RATE) throw new Error("This browser cannot record at 16 kHz; use a browser with 16 kHz AudioContext support");
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: SAMPLE_RATE, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (signal.aborted) throw new DOMException("Recording cancelled", "AbortError");
    moduleUrl = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    await context.audioWorklet.addModule(moduleUrl);
    if (signal.aborted) throw new DOMException("Recording cancelled", "AbortError");
    URL.revokeObjectURL(moduleUrl); moduleUrl = undefined;
    const node = new AudioWorkletNode(context, "test-set-recorder", { channelCount: 1, channelCountMode: "explicit", outputChannelCount: [1] });
    const mute = context.createGain(); mute.gain.value = 0;
    const source = context.createMediaStreamSource(stream); source.connect(node); node.connect(mute).connect(context.destination);
    let resolveDone: (pcm: Float32Array) => void; let rejectDone: (error: Error) => void;
    const done = new Promise<Float32Array>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
    const chunks: Float32Array[] = []; let count = 0; let ended = false; let lastProgress = 0; let lastFrame = performance.now();
    const limit = Math.round(targetMs * SAMPLE_RATE / 1000);
    const finish = (error?: Error) => {
      if (ended) return; ended = true; clearInterval(watchdog); signal.removeEventListener("abort", cancel); cleanup();
      if (error) { rejectDone(error); return; }
      if (!count) { rejectDone(new Error("No microphone audio received")); return; }
      const pcm = new Float32Array(count); let offset = 0;
      for (const chunk of chunks) { pcm.set(chunk, offset); offset += chunk.length; }
      resolveDone(pcm);
    };
    const cancel = () => finish(new DOMException("Recording cancelled", "AbortError"));
    const watchdog = setInterval(() => { if (performance.now() - lastFrame > 5000) finish(new Error("Microphone sent no audio for five seconds")); }, 1000);
    signal.addEventListener("abort", cancel, { once: true });
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (ended) return;
      lastFrame = performance.now();
      const chunk = event.data.slice(0, limit - count); chunks.push(chunk); count += chunk.length;
      if (lastFrame - lastProgress > 100) {
        lastProgress = lastFrame;
        onProgress(count / 16, Math.sqrt(chunk.reduce((sum, n) => sum + n * n, 0) / Math.max(1, chunk.length)));
      }
      if (count >= limit) finish();
    };
    stream.getAudioTracks().forEach(track => track.addEventListener("ended", () => finish(new Error("Microphone disconnected")), { once: true }));
    return { done, finish: () => finish(), cancel };
  } catch (error) { cleanup(); throw error; }
}
