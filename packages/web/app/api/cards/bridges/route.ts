import { answerBridgeRequest, bridgeErrorResponse, invalidBridgeRequest, readBridgeQuery, requireBridgeActor } from "@/lib/bridges-api";

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
