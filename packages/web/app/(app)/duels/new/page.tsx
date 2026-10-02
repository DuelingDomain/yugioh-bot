import { DuelCreator } from "@/components/duel/creator";
import { duelCreatorCapabilities } from "@/lib/duel-table-capabilities";

// The deployment flag and the installed host bundle can change after the web build.
export const dynamic = "force-dynamic";

export default async function NewDuelPage() {
  return <DuelCreator {...await duelCreatorCapabilities()} />;
}
