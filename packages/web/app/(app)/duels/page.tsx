import { DuelLobby } from "@/components/duel/lobby";
import { remoteDuelsEnabled } from "@/lib/remote-duels";
import { requireWebAccess } from "@/lib/web-access";

// The lobby reads its view, scope and filters from the page URL (useSearchParams), so Back from a replay restores them.
export const dynamic = "force-dynamic";

export default async function DuelsPage() {
  // Only a label for the saved history search; the API routes check access themselves.
  const access = await requireWebAccess();
  return <DuelLobby viewerId={access.ok ? access.userId : undefined} remoteDuels={remoteDuelsEnabled()} />;
}
