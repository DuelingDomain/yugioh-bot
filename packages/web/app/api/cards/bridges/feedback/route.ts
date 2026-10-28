import { answerBridgeRequest, bridgeErrorResponse, readBridgeBody, requireBridgeActor } from "@/lib/bridges-api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const actor = await requireBridgeActor();
    if (!actor.ok) return actor.response;
    const input = await readBridgeBody(request, "feedback");
    return input.ok ? await answerBridgeRequest(actor, input.value) : input.response;
  } catch (error) { return bridgeErrorResponse(error); }
}
