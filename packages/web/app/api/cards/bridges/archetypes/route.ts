import { bridgeErrorResponse, bridgeJson, listBridgeArchetypes, requireBridgeActor } from "@/lib/bridges-server-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireBridgeActor();
    if (!actor.ok) return actor.response;
    return bridgeJson({ archetypes: listBridgeArchetypes() });
  } catch (error) { return bridgeErrorResponse(error); }
}
