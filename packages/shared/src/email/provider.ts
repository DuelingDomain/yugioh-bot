export class EmailProviderError extends Error {
  constructor(readonly code: "transport" | "rate_limited" | "rejected" | "idempotency_conflict", readonly permanent = false, readonly retryAfterMs = 0) {
    super(code); this.name = "EmailProviderError";
  }
}
export interface EmailProvider { send(body: string, idempotencyKey: string): Promise<{ id: string; retryAfterMs?: number }> }
function retryAfter(response: Response): number {
  const raw = response.headers.get("retry-after");
  const seconds = raw === null ? NaN : Number(raw);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : raw ? Math.max(0, Date.parse(raw) - Date.now()) || 0 : 0;
}
/** Accepts the frozen serialized request body, so every retry has identical bytes and key. */
export function createResendProvider(options: { apiKey: string; fetch?: typeof fetch; timeoutMs?: number }): EmailProvider {
  return { async send(body, idempotencyKey) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
    try {
      const response = await (options.fetch ?? globalThis.fetch)("https://api.resend.com/emails", {
        method: "POST", signal: controller.signal,
        headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json", "idempotency-key": idempotencyKey }, body,
      });
      if (!response.ok) {
        if (response.status === 409) throw new EmailProviderError("idempotency_conflict", true);
        throw new EmailProviderError(response.status === 429 ? "rate_limited" : "rejected", response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status), retryAfter(response));
      }
      const data = await response.json() as { id?: unknown };
      if (typeof data?.id !== "string" || !data.id || data.id.length > 200) throw new EmailProviderError("transport");
      const remaining = Number(response.headers.get("ratelimit-remaining"));
      const reset = Number(response.headers.get("ratelimit-reset"));
      return { id: data.id, retryAfterMs: response.headers.has("ratelimit-remaining") && remaining === 0 && Number.isFinite(reset) ? Math.max(1000, reset * 1000) : 0 };
    } catch (error) {
      if (error instanceof EmailProviderError) throw error;
      // Fetch errors can contain private headers or bodies. Retain a fixed code only.
      throw new EmailProviderError("transport");
    } finally { clearTimeout(timer); }
  } };
}
