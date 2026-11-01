import { notFound } from "next/navigation";
import { remoteDuelsEnabled } from "@/lib/remote-duels";
import { RemoteTableScreen } from "@/components/remote/ui/table";
export const dynamic = "force-dynamic";
export default async function RemoteDuelPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!remoteDuelsEnabled()) notFound();
  const { slug } = await params;
  return <RemoteTableScreen slug={slug} />;
}
