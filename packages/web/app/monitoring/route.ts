import { suppressTracing } from "@sentry/nextjs";

const maximumBytes = 1024 * 1024;

function parseDsn(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const dsn = new URL(value);
    return ["https:", "http:"].includes(dsn.protocol) && dsn.username && !dsn.password && !dsn.search && !dsn.hash && /\/\d+$/.test(dsn.pathname) ? dsn : null;
  } catch { return null; }
}

export async function POST(request: Request): Promise<Response> {
  const configured = parseDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);
  if (!configured) return new Response(null, { status: 404 });
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  let body: Buffer<ArrayBuffer>;
  let supplied: URL | null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        return new Response(null, { status: 413 });
      }
      chunks.push(value);
    }
    body = Buffer.concat(chunks, size);
    const newline = body.indexOf(10);
    const header = JSON.parse(body.subarray(0, newline < 0 ? body.length : newline).toString("utf8"));
    supplied = parseDsn(header?.dsn);
  } catch { return new Response(null, { status: 400 }); }
  finally { reader.releaseLock(); }
  if (!supplied) return new Response(null, { status: 400 });
  if (supplied.origin !== configured.origin || supplied.pathname !== configured.pathname || supplied.username !== configured.username) {
    return new Response(null, { status: 403 });
  }
  const separator = configured.pathname.lastIndexOf("/");
  const endpoint = new URL(`${configured.pathname.slice(0, separator)}/api/${configured.pathname.slice(separator + 1)}/envelope/`, configured.origin);
  endpoint.searchParams.set("sentry_key", configured.username);
  endpoint.searchParams.set("sentry_version", "7");
  try {
    const response = await suppressTracing(() => fetch(endpoint, {
      method: "POST", body, headers: { "content-type": "application/x-sentry-envelope" },
      credentials: "omit", redirect: "error",
    }));
    return new Response(null, { status: response.status });
  } catch { return new Response(null, { status: 502 }); }
}
