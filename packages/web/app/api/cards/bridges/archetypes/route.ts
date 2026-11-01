import { bridgeErrorResponse, bridgeJson, listBridgeArchetypes, requireBridgeActor } from "@/lib/bridges-server-api";
import { bridgesEnabled, bridgesOffResponse } from "@/lib/bridges-enabled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!bridgesEnabled()) return bridgesOffResponse();
  try {
    const actor = await requireBridgeActor();
    if (!actor.ok) return actor.response;
    return bridgeJson({ archetypes: listBridgeArchetypes() });
  } catch (error) { return bridgeErrorResponse(error); }
}
