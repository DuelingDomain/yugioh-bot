import { answerBridgeRequest, bridgeErrorResponse, readBridgeBody, requireBridgeActor } from "@/lib/bridges-server-api";
import { bridgesEnabled, bridgesOffResponse } from "@/lib/bridges-enabled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!bridgesEnabled()) return bridgesOffResponse();
  try {
    const actor = await requireBridgeActor();
    if (!actor.ok) return actor.response;
    const input = await readBridgeBody(request, "list");
    return input.ok ? await answerBridgeRequest(actor, input.value, request.signal) : input.response;
  } catch (error) { return bridgeErrorResponse(error); }
}
