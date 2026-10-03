import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { SheetRoot, StationTrack } from "@/components/sheet";
import { CreateDraftForm } from "@/components/draft/create-draft-form";

const STATIONS = [
  { code: "NW", name: "Create" },
  { code: "LB", name: "Lobby" },
  { code: "DR", name: "Draft" },
  { code: "DK", name: "Decks" },
];

export default function NewCubeDraftPage() {
  return (
    <SheetRoot>
      <Link className="crumb" href="/drafts/new">
        <ChevronLeft className="ic sm" aria-hidden="true" />
        New draft
      </Link>
      <header className="t-head sheet-head">
        <div>
          <h1 className="t-title">New cube draft</h1>
          <p className="page-sub">You get a lobby and an invite link. Nothing is dealt until you press Start.</p>
        </div>
        <StationTrack
          stations={STATIONS}
          current={0}
          tone="mine"
          label="Where creating leads"
          caption={
            <>
              <span className="at">Create</span>
              <span className="sep">·</span>then a lobby with an invite link
            </>
          }
        />
      </header>
      <CreateDraftForm />
    </SheetRoot>
  );
}
