import { useId } from "react";
import sheet from "@/components/sheet/sheet.module.css";
import { MyDeckPanel } from "../my-deck-panel";
import { SECTION_IDS } from "../sheet-contracts";
import type { TournamentDetail } from "../types";
import styles from "./tournament-sheet.module.css";

export function DeckPanel({ tournament, tournamentSlug, onChanged }: { tournament: TournamentDetail; tournamentSlug: string; onChanged: () => void }) {
  const titleId = useId();
  const ownEntry = tournament.participants.find((player) => player.playerId === tournament.currentUserPlayerId);
  if (!tournament.isParticipant || tournament.status !== "active" || !ownEntry || ownEntry.deckLocked) return null;
  return <section id={SECTION_IDS.myDeck} className={`${sheet.panel} ${sheet["panel-pad"]} ${styles.deck}`} aria-labelledby={titleId}>
    <h2 id={titleId} className={sheet["panel-t"]}>Your deck</h2>
    <MyDeckPanel tournament={tournament} tournamentSlug={tournamentSlug} onChanged={onChanged} />
  </section>;
}
