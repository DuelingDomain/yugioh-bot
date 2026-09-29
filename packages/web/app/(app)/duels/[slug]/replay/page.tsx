import { DuelReplayView } from "@/components/duel/replay";

export default async function DuelReplayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <DuelReplayView slug={slug} />;
}
