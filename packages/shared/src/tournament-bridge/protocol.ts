// Tournament bridge: this protocol is shared with the separately hosted tournament tool.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { TournamentUser } from "./users.js";

const MAX_BODY_BYTES = 64 * 1024;
const nowSeconds = () => Math.floor(Date.now() / 1000);

export function validTournamentReturn(path: string): boolean {
  return path.length <= 512 && path.startsWith("/") && !path.startsWith("//")
    && !/[\\\u0000-\u001f\u007f]/.test(path);
}

export function signTournamentAssertion(input: { secret: string; return: string; user: TournamentUser }): string {
  if (input.secret.length < 32) throw new Error("Tournament bridge secret must have at least 32 characters");
  if (!validTournamentReturn(input.return)) throw new Error("Invalid tournament return path");
  const iat = nowSeconds();
  const payload = Buffer.from(JSON.stringify({ v: 1, nonce: randomBytes(16).toString("base64url"),
    iat, exp: iat + 60, return: input.return, user: input.user })).toString("base64url");
  const signature = createHmac("sha256", input.secret).update(`dd-tournament-assertion.v1.${payload}`).digest("hex");
  return `${payload}.${signature}`;
}

function apiDigest(input: { secret: string; method: string; pathWithQuery: string; timestamp: number; rawBody: Uint8Array | string }): Buffer {
  return createHmac("sha256", input.secret)
    .update(`dd-tournament-api.v1\n${input.method}\n${input.pathWithQuery}\n${input.timestamp}\n`)
    .update(input.rawBody).digest();
}

/** Sign exact wire bytes; do not reserialize JSON or reorder the query afterwards. */
export function signTournamentRequest(input: { secret: string; method: string; pathWithQuery: string; rawBody: Uint8Array | string }): string {
  if (input.secret.length < 32) throw new Error("Tournament bridge secret must have at least 32 characters");
  const timestamp = nowSeconds();
  return `t=${timestamp},v1=${apiDigest({ ...input, timestamp }).toString("hex")}`;
}

/** Authenticate bounded raw bytes before any JSON parsing, session or database access. */
export async function readTournamentRequest(request: Request, secret: string): Promise<
  { ok: true; rawBody: string } | { ok: false }
> {
  const match = /^t=(0|[1-9]\d*),v1=([a-f0-9]{64})$/.exec(request.headers.get("x-bridge-signature") ?? "");
  if (secret.length < 32 || !match) return { ok: false };
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds() - timestamp) > 60) return { ok: false };
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return { ok: false };
  const reader = request.body?.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
          await reader.cancel();
          return { ok: false };
        }
        chunks.push(Buffer.from(value));
      }
    } catch { return { ok: false }; }
    finally { reader.releaseLock(); }
  }
  const rawBody = Buffer.concat(chunks, size);
  const url = new URL(request.url);
  const digest = apiDigest({ secret, method: request.method, pathWithQuery: url.pathname + url.search, timestamp, rawBody });
  if (!timingSafeEqual(Buffer.from(match[2]!, "hex"), digest)) return { ok: false };
  return { ok: true, rawBody: rawBody.toString("utf8") };
}
