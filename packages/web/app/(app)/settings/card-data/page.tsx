import { notFound, redirect } from "next/navigation";
import { SheetRoot } from "@/components/sheet";
import { CardDataStatusPanel } from "@/components/card-data/card-data-status-panel";
import { auth } from "@/lib/auth";
import { checkDiscordWebAccess } from "@/lib/discord-web-access";

export const metadata = { title: "Card data status" };
export const dynamic = "force-dynamic";

export default async function CardDataStatusPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // Members who are not admins get the normal not-found page. When Discord cannot be asked (503),
  // the panel still renders and shows its own unavailable state; the API stays guarded.
  const decision = await checkDiscordWebAccess(session.user.id, "admin");
  if (!decision.ok && decision.status === 403) notFound();

  return (
    <SheetRoot>
      <header className="page-h sheet-head">
        <div>
          <h1 className="t-title">Card data status</h1>
          <p className="page-sub">How current the Dueling Domain card pools are: engine data, card catalog and the gap between them</p>
        </div>
      </header>
      <CardDataStatusPanel />
    </SheetRoot>
  );
}
