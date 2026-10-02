import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { SheetRoot, StationTrack } from "@/components/sheet";
import { CreateThemeDraftForm } from "@/components/draft/create-theme-draft-form";

const STATIONS = [
  { code: "NW", name: "Create" },
  { code: "LB", name: "Lobby" },
  { code: "DR", name: "Draft" },
  { code: "DK", name: "Decks" },
];

export default function NewThemeDraftPage() {
  return (
    <SheetRoot>
      <Link className="crumb" href="/drafts/new">
        <ChevronLeft className="ic sm" aria-hidden="true" />
        New draft
      </Link>
      <header className="t-head sheet-head">
        <div>
          <h1 className="t-title">New theme draft</h1>
          <p className="page-sub">You add the themes in the lobby, one cube per archetype.</p>
        </div>
        <StationTrack
          stations={STATIONS}
          current={0}
          tone="mine"
          label="Where creating leads"
          caption={
            <>
              <span className="at">Create</span>
              <span className="sep">·</span>then add themes in the lobby
            </>
          }
        />
      </header>
      <CreateThemeDraftForm />
    </SheetRoot>
  );
}
