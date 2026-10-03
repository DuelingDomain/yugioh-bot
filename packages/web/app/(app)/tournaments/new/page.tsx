import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { SheetRoot, StationTrack } from "@/components/sheet";
import { CreateTournamentForm } from "@/components/tournament/create-tournament-form";

const CREATE_STATIONS = [
  { code: "NW", name: "Create" },
  { code: "LB", name: "Lobby" },
  { code: "PL", name: "Play" },
  { code: "FN", name: "Final" },
];

export default function NewTournamentPage() {
  return (
    <SheetRoot>
      <Link className="crumb" href="/tournaments">
        <ChevronLeft className="ic sm" aria-hidden="true" />
        All tournaments
      </Link>
      <header className="t-head sheet-head">
        <div>
          <h1 className="t-title">New tournament</h1>
          <p className="page-sub">You get a lobby and an invite link. Nothing starts until you press Start.</p>
        </div>
        <StationTrack
          stations={CREATE_STATIONS}
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
      <CreateTournamentForm />
    </SheetRoot>
  );
}
