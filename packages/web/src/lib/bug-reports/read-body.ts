import { NextResponse } from "next/server";

/** The most a bug report request may send. The longest valid report (two 8000 character texts and a log) is far below it. */
export const BUG_REPORT_BODY_MAX_BYTES = 128 * 1024;

export type JsonBodyResult = { ok: true; value: unknown } | { ok: false; response: NextResponse };

const tooLarge = () => NextResponse.json({ error: "The report is too large" }, { status: 413 });

/**
 * Reads a JSON body without trusting the client's size. A `content-length` over the cap is refused (413) before one byte
 * is read. The body is then read in pieces and stopped (413) once it passes the cap, because the header can be missing
 * (chunked) or false. A body that is not JSON gives 400.
 */
export async function readJsonBody(request: Request, maxBytes = BUG_REPORT_BODY_MAX_BYTES): Promise<JsonBodyResult> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBytes) {
      await request.body?.cancel().catch(() => undefined);
      return { ok: false, response: tooLarge() };
    }
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  if (request.body) {
    const reader = request.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return { ok: false, response: tooLarge() };
        }
        chunks.push(value);
      }
    } catch {
      return { ok: false, response: NextResponse.json({ error: "Body must be JSON" }, { status: 400 }) };
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Body must be JSON" }, { status: 400 }) };
  }
}
