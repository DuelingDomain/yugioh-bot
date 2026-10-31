import { answerBridgeRequest, bridgeErrorResponse, invalidBridgeRequest, readBridgeBody, readBridgeQuery, requireBridgeActor } from "@/lib/bridges-server-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireBridgeActor();
    if (!actor.ok) return actor.response;
    const input = readBridgeQuery(request);
    return input ? await answerBridgeRequest(actor, input) : invalidBridgeRequest();
  } catch (error) { return bridgeErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await requireBridgeActor();
    if (!actor.ok) return actor.response;
    const input = await readBridgeBody(request, "list");
    return input.ok ? await answerBridgeRequest(actor, input.value, request.signal) : input.response;
  } catch (error) { return bridgeErrorResponse(error); }
}
