// Browser cache for the vision models: one SHA-256-checked copy per url and hash. No onnxruntime import, so the lobby can load it cheaply.
import type { GameProfile } from './types';
/** Models are 25 MB or more; the browser keeps one verified copy per url and hash, so a later visit reads from disk, not the network. */
const MODEL_CACHE = 'vision-models-v1';
const hexSha256 = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
const openModelCache = async () => { try { return typeof caches === 'undefined' ? undefined : await caches.open(MODEL_CACHE); } catch { return undefined; } };
/** The model's bytes, from the cache or the network. Both routes check the pinned SHA-256; a cached copy that fails it is dropped and fetched again. */
export async function fetchModelChecked(input: RequestInfo | URL, expected: string, init?: RequestInit): Promise<Response> {
  const cache = await openModelCache(), key = `${String(input)}#${expected}`;
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) {
        const bytes = await hit.arrayBuffer();
        if (await hexSha256(bytes) === expected) return new Response(bytes);
        await cache.delete(key);
      }
    } catch { /* a broken cache falls back to the network */ }
  }
  const response = await fetch(input, init);
  if (!response.ok) return response;
  const bytes = await response.arrayBuffer();
  if (await hexSha256(bytes) !== expected) throw new Error(`Model checksum mismatch: ${String(input)}`);
  // Stored only after the check, and never allowed to fail the load.
  if (cache) cache.put(key, new Response(bytes.slice(0))).catch(() => {});
  return new Response(bytes);
}
/** Lobby warm-up: download and verify the models the reader will need, so the first card read does not wait for them. Errors are ignored. */
export async function warmModelCache(profile: GameProfile, gpu = typeof navigator !== 'undefined' && 'gpu' in navigator): Promise<void> {
  const models = [profile.detector, profile.embedding].flatMap(m => [{ url: m.url, sha256: m.sha256 }, ...(gpu && m.webgpu ? [{ url: m.webgpu.url, sha256: m.webgpu.sha256 }] : [])]);
  for (const model of models) {
    try { await fetchModelChecked(new URL(model.url, globalThis.location.href).href, model.sha256); } catch { /* the reader fetches it again when needed */ }
  }
}
