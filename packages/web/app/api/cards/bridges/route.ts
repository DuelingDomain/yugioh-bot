import { answerBridgeRequest, bridgeErrorResponse, readBridgeBody, requireBridgeActor } from "@/lib/bridges-server-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Temporary transport shim for the component-local client, pending its owner's import migration. */
export function GET(request: Request) {
  const url = new URL(request.url);
  const query: Record<string, unknown> = Object.fromEntries(url.searchParams);
  for (const key of url.searchParams.keys()) {
    if (url.searchParams.getAll(key).length > 1) query[key] = url.searchParams.getAll(key);
  }
  if (typeof query.genesysRemaining === "string" && /^(0|[1-9]\d*)$/.test(query.genesysRemaining)) query.genesysRemaining = Number(query.genesysRemaining);
  url.search = "";
  return POST(new Request(url, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query), signal: request.signal }));
}

export async function POST(request: Request) {
  try {
    const actor = await requireBridgeActor();
    if (!actor.ok) return actor.response;
    const input = await readBridgeBody(request, "list");
    return input.ok ? await answerBridgeRequest(actor, input.value, request.signal) : input.response;
  } catch (error) { return bridgeErrorResponse(error); }
}
