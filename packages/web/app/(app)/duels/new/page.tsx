import { multiplayerTablesEnabled } from "@yugidraft/shared/duels";
import { DuelCreator } from "@/components/duel/creator";

// The MULTIPLAYER_TABLES flag is read from the server environment on each request, not at build time.
export const dynamic = "force-dynamic";

export default async function NewDuelPage({ searchParams }: { searchParams: Promise<{ challenge?: string | string[] }> }) {
  const { challenge } = await searchParams;
  return <DuelCreator focusOpponent={challenge != null} multiplayerTables={multiplayerTablesEnabled()} />;
}
