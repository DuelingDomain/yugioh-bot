import { DuelLobby } from "@/components/duel/lobby";
import { parseHistoryParams } from "@/components/duel/history-filters";

export default async function DuelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { scope, filters } = parseHistoryParams(params);
  const view = Array.isArray(params.view) ? params.view[0] : params.view;
  return <DuelLobby initialView={view === "history" ? "history" : "live"} initialScope={scope} initialFilters={filters} />;
}
