"use client";

import { SheetRoot } from "@/components/sheet";
import { duelFontClasses } from "@/components/duel/fonts";
import rail from "@/components/tournament/sheet/rail.module.css";
import { RemoteDisputes } from "@/components/tournament/remote/remote-disputes";
import { FIXTURE_EVIDENCE_ROW, FIXTURE_PLAYERS, FIXTURE_RESULT } from "@/components/tournament/remote/remote-result-fixtures";
import type { TournamentDetail } from "@/components/tournament/types";
import { DeclareConfirm, DeclarePending } from "@/components/remote/ui/match-ui";
import { DetectionBadge } from "@/components/remote/ui/seat-panel";
import { TournamentCheck } from "@/components/remote/ui/lobby-camera-preview";
import type { Match } from "@/components/remote/ui/match-model";
import remoteUi from "@/components/remote/ui/remote-ui.module.css";

// The dispute view reads two routes. Here they answer with fixtures, and the organizer actions answer 200.
if (typeof window !== "undefined" && !(window as { __remotePreviewFetch?: boolean }).__remotePreviewFetch) {
  (window as { __remotePreviewFetch?: boolean }).__remotePreviewFetch = true;
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/remote-result") && (!init?.method || init.method === "GET")) return Response.json({ remoteResult: FIXTURE_RESULT });
    if (url.endsWith("/remote-evidence")) return Response.json({ evidence: FIXTURE_EVIDENCE_ROW });
    if (url.endsWith("/result") || url.endsWith("/remote-result/void")) return Response.json({ success: true });
    return real(input, init);
  };
}

const MATCH = { id: 45, matchId: null, roundNumber: 2, playerOneId: FIXTURE_PLAYERS.one.id, playerTwoId: FIXTURE_PLAYERS.two.id, playerOneName: FIXTURE_PLAYERS.one.name, playerTwoName: FIXTURE_PLAYERS.two.name, status: "open", winnerId: null, reporterId: null, resolvedAt: null, metadata: {} };
const TOURNAMENT = { matches: [MATCH] } as unknown as TournamentDetail;

const lpMatch = (confirmed: number[]) => ({ phase: "playing", pendingResult: { id: "d1", winnerSeat: 0, confirmed, lpSeat: 1 } }) as unknown as Match;
const name = (seat: number) => (seat === 0 ? "Alice" : "Bob");

export function RemoteTournamentPreview({ view }: { view: "dispute" | "table" }) {
  if (view === "dispute") {
    return <SheetRoot as="main" className="set-page" style={{ minHeight: "100vh", display: "flex", justifyContent: "flex-end" }}>
      <div style={{ width: "min(560px, 100vw)", minHeight: "100vh", background: "var(--panel)", borderLeft: "1px solid var(--rule)" }}>
        <div className={rail.dHead}><h2 className={rail.dTitle}>Host tools</h2></div>
        <div className={rail.dBody}>
          <section className={rail.dSec} aria-label="Remote disputes">
            <h3 className={rail.dSecH}>Remote disputes</h3>
            <RemoteDisputes tournament={TOURNAMENT} tournamentSlug="cup" onChanged={() => undefined} />
          </section>
        </div>
      </div>
    </SheetRoot>;
  }
  return <div className={`${duelFontClasses} ${remoteUi.app}`} style={{ minHeight: "100vh", padding: 24, display: "grid", gap: 24, alignContent: "start" }}>
    <section aria-label="Nameplate badges" style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <b>Bob</b><DetectionBadge seat={1} name="Bob" mode="auto" /><b>Alice</b><DetectionBadge seat={0} name="Alice" mode="tap" /><DetectionBadge seat={2} name="Cy" mode="manual" /><DetectionBadge seat={3} name="Dee" />
    </section>
    <section aria-label="Pre-match check" style={{ maxWidth: 520 }}>
      <TournamentCheck camera zones={false} />
    </section>
    <DeclareConfirm match={lpMatch([0])} mySeat={1} name={name} busy={false} onAnswer={() => undefined} />
    <DeclarePending match={lpMatch([0])} mySeat={0} seats={[0, 1]} name={name} />
  </div>;
}
