import { notFound, redirect } from "next/navigation";
import { requireAdminSpectate } from "@/lib/admin-spectate";
import { AdminDuelWatch } from "@/components/admin-console/live-watch";
export const dynamic = "force-dynamic";
export const metadata = { title: "Admin live watch" };
export default async function WatchPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const actor = await requireAdminSpectate("duel", slug);
  if (!actor.ok) { if (actor.response.status === 401) redirect("/sign-in"); notFound(); }
  return <AdminDuelWatch slug={slug} />;
}
