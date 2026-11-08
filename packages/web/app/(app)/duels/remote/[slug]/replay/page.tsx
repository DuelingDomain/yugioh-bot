import { notFound } from "next/navigation";
import { remoteDuelsForViewer } from "@/lib/remote-duels";
import { RemoteReplayScreen } from "@/components/remote/ui/replay";
export const dynamic = "force-dynamic";
export default async function RemoteReplayPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!await remoteDuelsForViewer()) notFound();
  const { slug } = await params;
  return <RemoteReplayScreen slug={slug} />;
}
