/**
 * Reads a request body as text and stops at `maxBytes`, so a large or never-ending body cannot fill memory.
 * Throws Error("body_too_large") when the body (or its declared content-length) is over the cap.
 */
export async function readSmallBody(request: Request, maxBytes: number): Promise<string> {
  if (Number(request.headers.get("content-length")) > maxBytes) throw new Error("body_too_large");
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return body + decoder.decode();
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("body_too_large");
      }
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

/** JSON object body under the cap, or null for an empty, malformed, oversized or non-object body. */
export async function readSmallJsonObject(request: Request, maxBytes: number): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readSmallBody(request, maxBytes));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
