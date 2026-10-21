import { notFound, redirect } from "next/navigation";
import { requireAdminSpectate } from "@/lib/admin-spectate";
import { AdminDuelWatch } from "@/components/admin-console/live-watch";
export const dynamic = "force-dynamic";
export const metadata = { title: "Admin live watch" };
export default async function WatchPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ seat?: string | string[] }> }) {
  const [{ slug }, { seat }] = await Promise.all([params, searchParams]);
  const actor = await requireAdminSpectate("duel", slug);
  if (!actor.ok) { if (actor.response.status === 401) redirect("/sign-in"); notFound(); }
  const initial = typeof seat === "string" && /^(0|[1-9]\d?)$/.test(seat) ? Number(seat) : null;
  return <AdminDuelWatch slug={slug} initialSeat={initial} />;
}
