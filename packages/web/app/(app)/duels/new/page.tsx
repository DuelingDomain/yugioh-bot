import { DuelCreator } from "@/components/duel/creator";

export default async function NewDuelPage({ searchParams }: { searchParams: Promise<{ challenge?: string | string[] }> }) {
  const { challenge } = await searchParams;
  return <DuelCreator focusOpponent={challenge != null} />;
}
