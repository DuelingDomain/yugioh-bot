import { createHmac, timingSafeEqual } from "node:crypto";
import { deriveKey, type Purpose } from "./keys.js";

export type SignedPostResult = { ok: boolean; status: number; text: string };

export type SignedPostTransport = {
  post(path: string, body: string): Promise<SignedPostResult>;
};

export function signedTransport(cfg: { url: string; secret: string; purpose: Purpose; timeoutMs?: number }): SignedPostTransport {
  return {
    async post(path, body) {
      if (!cfg.url || !cfg.secret) return { ok: false, status: 0, text: "not configured" };
      const controller = cfg.timeoutMs ? new AbortController() : undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const url = new URL(`${cfg.url}${path}`);
        const timestamp = Math.floor(Date.now() / 1000);
        const digest = requestDigest(cfg.secret, cfg.purpose, "POST", url, timestamp, Buffer.from(body));
        const sig = `t=${timestamp},v2=${digest.toString("hex")}`;
        const request = (async () => {
          const res = await fetch(url.toString(), {
            method: "POST",
            headers: { "content-type": "application/json", "x-internal-signature": sig },
            body, ...(controller ? { signal: controller.signal } : {}),
          });
          const text = await res.text();
          return { ok: res.ok, status: res.status, text };
        })();
        if (!controller) return await request;
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error("Internal request timed out")); }, cfg.timeoutMs);
        });
        return await Promise.race([request, deadline]);
      } catch (err) {
        return { ok: false, status: 0, text: err instanceof Error ? err.message : "Network error" };
      } finally {
        clearTimeout(timer);
        controller?.abort();
      }
    },
  };
}

export function recordingTransport(): {
  calls: Array<{ path: string; body: string }>;
  transport: SignedPostTransport;
} {
  const calls: Array<{ path: string; body: string }> = [];
  return {
    calls,
    transport: {
      async post(path, body) {
        calls.push({ path, body });
        return { ok: true, status: 204, text: "" };
      },
    },
  };
}

function requestDigest(secret: string, purpose: Purpose, method: string, url: URL, timestamp: number, body: Buffer): Buffer {
  return createHmac("sha256", deriveKey(secret, purpose))
    .update(`v2\n${method}\n${url.pathname}${url.search}\n${timestamp}\n`).update(body).digest();
}

export async function readSignedRequest(req: Request, cfg: {
  secret: string; purpose: Purpose; maxBytes?: number; now?: () => number;
}): Promise<{ ok: true; body: unknown } | { ok: false; status: 400 | 401 | 413 }> {
  const path = new URL(req.url).pathname;
  const rejected = (status: 400 | 401 | 413, reason: string) => {
    console.warn("internal request rejected", { purpose: cfg.purpose, path, reason });
    return { ok: false as const, status };
  };
  const maxBytes = cfg.maxBytes ?? 65536;
  const contentLength = req.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > maxBytes) return rejected(413, "body too large");
  const header = req.headers.get("x-internal-signature") ?? "";
  const match = /^t=(0|[1-9]\d*),v2=([a-f0-9]{64})$/.exec(header);
  if (!cfg.secret || !match) return rejected(401, "invalid signature header");
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Math.floor((cfg.now?.() ?? Date.now()) / 1000) - timestamp) > 60) {
    return rejected(401, "timestamp outside window");
  }
  const chunks: Buffer[] = [];
  const reader = req.body?.getReader();
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          return rejected(413, "body too large");
        }
        chunks.push(Buffer.from(value));
      }
    } catch {
      return rejected(400, "body read failed");
    } finally {
      reader.releaseLock();
    }
  }
  const body = Buffer.concat(chunks, size);
  const digest = requestDigest(cfg.secret, cfg.purpose, req.method, new URL(req.url), timestamp, body);
  const received = Buffer.from(match[2], "hex");
  if (!timingSafeEqual(received, digest)) return rejected(401, "signature mismatch");
  try {
    return { ok: true, body: JSON.parse(body.toString("utf8")) };
  } catch {
    return rejected(400, "invalid JSON");
  }
}
