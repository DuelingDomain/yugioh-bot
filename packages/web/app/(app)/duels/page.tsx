import { DuelLobby } from "@/components/duel/lobby";

// The lobby reads its view, scope and filters from the page URL (useSearchParams), so Back from a replay restores them.
export const dynamic = "force-dynamic";

export default function DuelsPage() {
  return <DuelLobby />;
}
