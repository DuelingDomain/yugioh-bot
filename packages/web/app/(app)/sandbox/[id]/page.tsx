import { notFound } from "next/navigation";
import { SandboxScenarioServiceError } from "@yugidraft/shared/services";
import { duelCreatorCapabilities } from "@/lib/duel-table-capabilities";
import { parseSandboxId, requireSandboxActor, SandboxRequestError } from "@/lib/sandbox-access";
import { PlayNow } from "../_components/play-now";
import { ScenarioEditor } from "../_components/scenario-editor";
import { toScenarioData, type ScenarioData } from "../_lib/load";

export const dynamic = "force-dynamic";

export default async function SandboxScenarioPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ play?: string | string[] }>;
}) {
  const [{ id: rawId }, { play }, actor] = await Promise.all([params, searchParams, requireSandboxActor()]);
  if (!actor.ok) notFound();
  let scenario: ScenarioData;
  try {
    scenario = toScenarioData(actor.guildId, actor.playerId, actor.scenarios.get(parseSandboxId(rawId), actor.guildId));
  } catch (error) {
    if (error instanceof SandboxRequestError || (error instanceof SandboxScenarioServiceError && error.status === 404)) notFound();
    throw error;
  }
  // The share link: start at once, then the client goes to the duel room.
  if ((Array.isArray(play) ? play[0] : play) === "1") return <PlayNow scenario={scenario} />;
  return <ScenarioEditor scenario={scenario} capabilities={await duelCreatorCapabilities()} />;
}
