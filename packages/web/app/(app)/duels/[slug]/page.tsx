import { DuelRoomView } from "@/components/duel/room";
import { requireDuelActor } from "@/lib/duel-host";

export default async function DuelRoomPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ invite?: string | string[]; window?: string | string[]; stage?: string | string[]; spectate?: string | string[]; join?: string | string[] }>;
}) {
  const [{ slug }, { invite, window: windowFlag, stage, spectate, join }, actor] = await Promise.all([params, searchParams, requireDuelActor()]);
  return (
    <>
      {join === "failed" ? (
        <p role="status" className="mb-3 rounded-lg border border-border-subtle p-3 text-sm text-text-secondary">
          Could not confirm the seat claim. Check the seats to join or watch.
        </p>
      ) : null}
      <DuelRoomView slug={slug} inviteCode={typeof invite === "string" ? invite : undefined}
        windowed={windowFlag === "1"} legacyStage={stage === "legacy"} spectate={spectate === "1"}
        actorPlayerId={actor.ok ? actor.playerId : null} />
    </>
  );
}
