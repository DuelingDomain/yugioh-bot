import { createHash } from "node:crypto";

export const webhookHash = (url: string) => createHash("sha256").update(url).digest("hex");
export const discordText = (text: string, limit = 80) => text
  .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").slice(0, limit)
  .replace(/[\\`*_{}\[\]()<>#+\-.!|~:/]/g, "\\$&");

/** Never throw a fetch error containing the credential URL. Bound the response read too. */
export async function discordWebhook(url: string, method: "POST" | "PATCH", body: unknown, messageId?: string): Promise<{
  ok: boolean; status: number; messageId?: string; retryAfterMs?: number; unknownMessage?: boolean;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const target = new URL(url);
    if (messageId) {
      if (!/^\d{1,25}$/.test(messageId)) return { ok: false, status: 0 };
      target.pathname = target.pathname.replace(/\/$/, "") + `/messages/${messageId}`;
      target.searchParams.delete("wait");
    } else target.searchParams.set("wait", "true");
    const response = await fetch(target.href, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
    const payload = await response.json().catch(() => null) as { id?: unknown; retry_after?: unknown; code?: unknown } | null;
    if (response.status === 429) {
      const seconds = Number(payload?.retry_after ?? response.headers.get("retry-after"));
      return { ok: false, status: 429, retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : 60_000 };
    }
    return { ok: response.ok, status: response.status, unknownMessage: response.status === 404 && payload?.code === 10008,
      ...(typeof payload?.id === "string" && /^\d{1,25}$/.test(payload.id) ? { messageId: payload.id } : {}) };
  } catch { return { ok: false, status: 0 }; }
  finally { clearTimeout(timer); }
}
