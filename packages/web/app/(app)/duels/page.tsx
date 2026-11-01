import { DuelLobby } from "@/components/duel/lobby";
import { duelCreatorCapabilities } from "@/lib/duel-table-capabilities";
import { remoteDuelsEnabled } from "@/lib/remote-duels";
import { requireWebAccess } from "@/lib/web-access";

// The lobby reads its view, scope and filters from the page URL (useSearchParams), so Back from a replay restores them.
export const dynamic = "force-dynamic";

export default async function DuelsPage() {
  // Only a label for the saved history search; the API routes check access themselves.
  const access = await requireWebAccess();
  // The lede lists the table sizes the creator offers: Tag and free-for-all need the flag and a ready multi core.
  const { multiplayerTables, multiCoreReady } = await duelCreatorCapabilities();
  return <DuelLobby viewerId={access.ok ? access.userId : undefined} remoteDuels={remoteDuelsEnabled()} multiplayerTables={multiplayerTables && multiCoreReady} />;
}
