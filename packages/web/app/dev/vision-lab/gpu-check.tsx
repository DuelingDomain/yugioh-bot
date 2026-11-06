"use client";
import { useState } from 'react';
import type { BackendStatus } from '@yugidraft/vision';

/** Uses the same worker, device selection, models and run watchdogs as Remote Duels. */
export function GPUCheck() {
  const [result, setResult] = useState('Not checked'), [busy, setBusy] = useState(false);
  async function check() {
    setBusy(true);
    let reader: import('@yugidraft/vision').Recognizer | undefined;
    let status: BackendStatus | undefined;
    try {
      const { createRecognizer } = await import('@yugidraft/vision');
      reader = createRecognizer({ backend: 'auto', onBackendChange: value => { status = value; } });
      const checked = await reader.checkWebGpu();
      setResult(JSON.stringify({
        result: checked.backend === 'webgpu' ? 'WebGPU inference passed' : `CPU (GPU unavailable: ${checked.fallbackReason})`,
        ...checked,
      }, null, 2));
    } catch (error) {
      setResult(JSON.stringify({ failure: error instanceof Error ? error.message : String(error), ...status }, null, 2));
    } finally { reader?.dispose(); setBusy(false); }
  }
  return <div>
    <button type="button" disabled={busy} onClick={() => void check()}>Check WebGPU</button>
    <pre aria-live="polite" aria-label="WebGPU result" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{busy ? 'Loading and running both models in the recognition worker…' : result}</pre>
    <p>This check runs the detector and embedder on this computer. Adapter details, features, limits and fallback errors are included. Software adapters are identified in the adapter details.</p>
  </div>;
}
