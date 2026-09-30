import { DuelLobby } from "@/components/duel/lobby";

export default async function DuelsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const { view } = await searchParams;
  return <DuelLobby initialView={view === "history" ? "history" : "live"} />;
}
