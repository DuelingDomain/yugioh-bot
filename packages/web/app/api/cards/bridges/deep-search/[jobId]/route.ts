import { answerBridgeRequest, bridgeErrorResponse, invalidBridgeRequest, readBridgeJob, requireBridgeActor } from "@/lib/bridges-server-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const actor = await requireBridgeActor();
    if (!actor.ok) return actor.response;
    const input = readBridgeJob(request, (await params).jobId);
    return input ? await answerBridgeRequest(actor, input) : invalidBridgeRequest();
  } catch (error) { return bridgeErrorResponse(error); }
}
