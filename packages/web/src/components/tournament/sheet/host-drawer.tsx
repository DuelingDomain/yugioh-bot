"use client";

import { useCallback, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { SheetPortal } from "@/components/sheet";
import { MatchRow } from "../matches/match-row";
import type { PlayerRatings } from "../sheet-contracts";
import type { TournamentDetail } from "../types";
import { isByeMatch } from "../floor/floor-model";
import { EndingEarly, PlayersPanel } from "./rail-panels";
import styles from "./rail.module.css";

/**
 * Host tools, in a drawer from the right (a bottom sheet on a phone): the organizer's controls for every
 * match (Set result, Reopen), the deck list, and ending the tournament early. It is a modal dialog: the
 * scrim blocks the page, Tab stays inside, Escape and the close button close it, and focus returns to the
 * Host tools button.
 */
export function HostDrawer({ tournament, tournamentSlug, ratings, onChanged, onClose }: {
  tournament: TournamentDetail;
  tournamentSlug: string;
  ratings: PlayerRatings;
  onChanged: () => void;
  onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement | null>(null);
  // SheetPortal renders after mount, so the panel appears one tick after this component's effect. Focus
  // the close button when the panel attaches (children attach first, so the button ref is set).
  const attach = useCallback((node: HTMLElement | null) => {
    const first = panel.current === null && node !== null;
    panel.current = node;
    if (first) close.current?.focus();
  }, []);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onCloseRef.current(); return; }
      if (event.key !== "Tab" || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((el) => el.getAttribute("aria-hidden") !== "true");
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!panel.current.contains(active)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const matches = tournament.matches.filter((match) => !isByeMatch(match)).sort((a, b) => a.roundNumber - b.roundNumber || a.id - b.id);
  const props = { tournament, tournamentSlug, currentUserPlayerId: tournament.currentUserPlayerId, ratings, isHost: true, onChanged };
  return (
    <SheetPortal>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <aside ref={attach} id="host-tools" className={styles.drawer} role="dialog" aria-modal="true" aria-label="Host tools">
        <div className={styles.dHead}>
          <h2 className={styles.dTitle}>Host tools</h2>
          <button ref={close} type="button" className={styles.close} aria-label="Close host tools" onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </div>
        <div className={styles.dBody}>
          <section className={styles.dSec} aria-label="Matches">
            <h3 className={styles.dSecH}>Matches</h3>
            <div className={styles.matchList}>
              {matches.length === 0 ? <p className={styles.none}>No matches yet.</p> : matches.map((match) => <MatchRow key={match.id} match={match} {...props} />)}
            </div>
          </section>
          <section className={styles.dSec} aria-label="Decks">
            <h3 className={styles.dSecH}>Decks</h3>
            <PlayersPanel tournament={tournament} ratings={ratings} />
          </section>
          <section className={styles.dSec} aria-label="Ending early">
            <EndingEarly tournament={tournament} tournamentSlug={tournamentSlug} onChanged={onChanged} />
          </section>
        </div>
      </aside>
    </SheetPortal>
  );
}
