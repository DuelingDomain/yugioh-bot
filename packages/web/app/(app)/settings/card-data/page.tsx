import { notFound, redirect } from "next/navigation";
import { SheetRoot } from "@/components/sheet";
import { CardDataStatusPanel } from "@/components/card-data/card-data-status-panel";
import { isOwnerUser } from "@/lib/owner-access";
import { resolveSessionIdentity } from "@/lib/session-identity";

export const metadata = { title: "Card data status" };
export const dynamic = "force-dynamic";

export default async function CardDataStatusPage() {
  const result = await resolveSessionIdentity();
  if (!result.ok && result.status === 401) redirect("/sign-in");
  // Anyone not listed in OWNER_USER_IDS gets the normal not-found page. When the session can't be read (503),
  // the panel still renders and shows its own unavailable state; the API stays guarded.
  if (result.ok && !isOwnerUser(result.identity.userId)) notFound();

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
