import { createHmac } from "node:crypto";

export type SignedPostResult = { ok: boolean; status: number; text: string };

export type SignedPostTransport = {
  post(path: string, body: string): Promise<SignedPostResult>;
};

export function httpTransport(cfg: { url: string; secret: string; timeoutMs?: number }): SignedPostTransport {
  return {
    async post(path, body) {
      if (!cfg.url || !cfg.secret) return { ok: false, status: 0, text: "not configured" };
      const sig = "sha256=" + createHmac("sha256", cfg.secret).update(body).digest("hex");
      const controller = cfg.timeoutMs ? new AbortController() : undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const request = (async () => {
          const res = await fetch(`${cfg.url}${path}`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-announce-signature": sig },
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
