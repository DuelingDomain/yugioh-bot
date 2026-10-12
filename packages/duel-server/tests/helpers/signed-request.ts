import { signedTransport, type Purpose } from "@yugidraft/shared/internal-auth";

export async function signedHeaders(body: string, secret: string, target: string, purpose: Purpose): Promise<Record<string, string>> {
  const url = new URL(target);
  let headers!: Record<string, string>;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    headers = init!.headers as Record<string, string>;
    return new Response(null, { status: 204 });
  };
  try {
    await signedTransport({ url: url.origin, secret, purpose }).post(url.pathname + url.search, body);
    return headers;
  } finally {
    globalThis.fetch = previousFetch;
  }
}
