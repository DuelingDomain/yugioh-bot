import { DuelRoomView } from "@/components/duel/room";

export default async function DuelRoomPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ invite?: string | string[]; window?: string | string[]; stage?: string | string[]; spectate?: string | string[] }>;
}) {
  const [{ slug }, { invite, window: windowFlag, stage, spectate }] = await Promise.all([params, searchParams]);
  return <DuelRoomView slug={slug} inviteCode={typeof invite === "string" ? invite : undefined}
      windowed={windowFlag === "1"} legacyStage={stage === "legacy"} spectate={spectate === "1"} />;
}
