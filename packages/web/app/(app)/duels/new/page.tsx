import { DuelCreator } from "@/components/duel/creator";
import { remoteDuelsEnabled } from "@/lib/remote-duels";
import { duelCreatorCapabilities } from "@/lib/duel-table-capabilities";

// The deployment flag and the installed host bundle can change after the web build.
export const dynamic = "force-dynamic";

export default async function NewDuelPage({ searchParams }: { searchParams: Promise<{ challenge?: string | string[]; type?: string | string[] }> }) {
  const { challenge, type } = await searchParams;
  const remoteDuels = remoteDuelsEnabled();
  return <DuelCreator focusOpponent={challenge != null} remoteDuels={remoteDuels} initialRemote={remoteDuels && type === "remote"} {...await duelCreatorCapabilities()} />;
}
