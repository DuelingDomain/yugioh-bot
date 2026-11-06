import { notFound } from "next/navigation";
import { remoteDuelsForViewer, remoteVoiceRecognitionEnabled } from "@/lib/remote-duels";
import { RemoteTableScreen } from "@/components/remote/ui/table";
export const dynamic = "force-dynamic";
export default async function RemoteDuelPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!await remoteDuelsForViewer()) notFound();
  const { slug } = await params;
  return <RemoteTableScreen slug={slug} voiceRecognition={remoteVoiceRecognitionEnabled()} />;
}
