import { SheetRoot } from "@/components/sheet";
import { CardDataStatusPanel } from "@/components/card-data/card-data-status-panel";

export const metadata = { title: "Card data status" };

export default function CardDataStatusPage() {
  return (
    <SheetRoot>
      <header className="page-h sheet-head">
        <div>
          <h1 className="t-title">Card data status</h1>
          <p className="page-sub">How current the Duelists Kingdom card pools are: engine data, card catalog and the gap between them</p>
        </div>
      </header>
      <CardDataStatusPanel />
    </SheetRoot>
  );
}
