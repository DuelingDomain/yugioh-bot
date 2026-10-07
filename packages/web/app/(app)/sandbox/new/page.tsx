import { notFound } from "next/navigation";
import { DUEL_FORMATS, type DuelFormat } from "@yugidraft/shared/duels";
import { callDuelHost } from "@/lib/duel-host";
import { duelCreatorCapabilities } from "@/lib/duel-table-capabilities";
import { requireSandboxActor } from "@/lib/sandbox-access";
import { ScenarioEditor, type EditorDraft } from "../_components/scenario-editor";

export const dynamic = "force-dynamic";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The board of a running sandbox duel ("Back to builder" from the duel bar). Any failure gives an empty board. */
async function draftFromDuel(slug: string, guildId: string, playerId: number): Promise<EditorDraft | null> {
  try {
    const result = await callDuelHost({ op: "sandbox-info", slug, guildId, playerId });
    if (!result.ok) return null;
    const data = result.data as { board?: unknown; run?: unknown } | null;
    return data && data.board ? { board: data.board, run: data.run } : null;
  } catch {
    return null;
  }
}

export default async function NewSandboxPage({ searchParams }: { searchParams: Promise<{ format?: string | string[]; from?: string | string[] }> }) {
  const actor = await requireSandboxActor();
  if (!actor.ok) notFound();
  const query = await searchParams;
  const format = first(query.format);
  const from = first(query.from);
  const [capabilities, draft] = await Promise.all([
    duelCreatorCapabilities(),
    from ? draftFromDuel(from, actor.guildId, actor.playerId) : Promise.resolve(null),
  ]);
  return (
    <ScenarioEditor
      capabilities={capabilities}
      draft={draft ?? undefined}
      format={DUEL_FORMATS.includes(format as DuelFormat) ? (format as DuelFormat) : undefined}
    />
  );
}
