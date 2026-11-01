import { notFound } from "next/navigation";
import { remoteDuelsEnabled } from "@/lib/remote-duels";
import { RemoteTableRoom } from "@/components/remote/remote-workbench";
export const dynamic = "force-dynamic";
export default async function RemoteDuelPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!remoteDuelsEnabled()) notFound();
  const { slug } = await params;
  return <RemoteTableRoom slug={slug} />;
}
