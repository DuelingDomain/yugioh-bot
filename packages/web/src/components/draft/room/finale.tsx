"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DraftTournament } from "../use-draft-tournament";
import { FullscreenLayer } from "./layer";
import { animate } from "./motion";
import { KINDS, KIND_LABEL, countKinds, kindOf, type RoomCard } from "./room-model";

export interface FinaleProps {
  slug: string;
  pool: RoomCard[];
  theme: boolean;
  /** How many of the picks are Extra deck cards (theme drafts). */
  extraCount: number;
  /** The server says the viewer may create the tournament (the draft host or a server admin). */
  canCreateTournament: boolean;
  /** Tournament made from this draft, plus the state to create one. */
  tournament: DraftTournament;
  exporting: boolean;
  exportError: string | null;
  onExport: () => void;
  onClose: () => void;
}

/** "Draft complete": shown over the page when the draft finishes while you are in the room. */
export function DraftFinale(p: FinaleProps) {
  const counts = useMemo(() => countKinds(p.pool), [p.pool]);
  const fan = useMemo(() => p.pool.slice(-7), [p.pool]);
  const monsters = p.pool.filter((c) => kindOf(c) === "monster");
  const noTribute = monsters.filter((c) => (c.level ?? 0) <= 4).length;
  const mainCount = p.pool.length - p.extraCount;
  const sub = p.theme
    ? `${mainCount} main deck cards and ${p.extraCount} for the Extra Deck.`
    : `${p.pool.length} cards drafted. Your deck is saved.`;
  const { tournament } = p;
  const [formOpen, setFormOpen] = useState(false);
  // Focus goes to the first action on each variant. Opening the form, closing it, or making the
  // tournament swaps that action for another element, which takes focus the same way.
  const focused = useRef<Element | null>(null);
  const focusFirst = useCallback((el: HTMLAnchorElement | HTMLButtonElement | HTMLSelectElement | null) => {
    if (!el || focused.current === el) return;
    focused.current = el;
    el.focus();
  }, []);
  const linked = tournament.linked;
  const tournamentHref = linked?.webSlug ? `/tournament/${linked.webSlug}` : "/tournaments";
  const showForm = p.canCreateTournament && !linked && formOpen;
  const status = linked
    ? "The tournament is ready. Saved draft decks are registered for it."
    : p.canCreateTournament
      ? "Create the tournament when you are ready. Saved draft decks are registered for it."
      : "The host or a server admin will start the tournament.";
  const word = useRef<HTMLHeadingElement>(null);
  const fanRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    animate(word.current, [{ opacity: 0, transform: "scale(1.75)" }, { opacity: 1, transform: "scale(1)" }], {
      duration: 420,
      easing: "cubic-bezier(0.2,0.9,0.3,1)",
      fill: "backwards",
    });
    const imgs = Array.from(fanRef.current?.children ?? []);
    imgs.forEach((img, i) => {
      const a = (i - (imgs.length - 1) / 2) * 9;
      animate(img, [{ transform: "rotate(0deg) translateY(30px)", opacity: 0 }, { transform: `rotate(${a}deg)`, opacity: 1 }], {
        duration: 520,
        delay: 300 + i * 60,
        easing: "cubic-bezier(0.16,1,0.3,1)",
        fill: "backwards",
      });
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      p.onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [p.onClose]);

  return (
    <FullscreenLayer label="Draft complete">
      <div className="finale">
        <div className="frame">
          <i className="pip" />
          <i className="pip" />
          <i className="pip" />
          <i className="pip" />
          <h2 className="fin-word" ref={word}>
            Draft complete
          </h2>
          <p className="fin-sub">{sub}</p>
          <div className="fin-fan" ref={fanRef}>
            {fan.map((c, i) => {
              const n = fan.length;
              const a = (i - (n - 1) / 2) * 9;
              return (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={`${c.id}-${i}`} src={c.imageUrlSmall || c.imageUrl} alt="" style={{ transform: `rotate(${a}deg)` }} />
              );
            })}
          </div>
          <div className="fin-mix">
            <div className="mix-bar">
              {KINDS.map((k) => (
                <i key={k} data-kind={k} style={{ "--n": counts[k] } as React.CSSProperties} />
              ))}
            </div>
            <div className="fin-counts">
              {KINDS.map((k) => (
                <div key={k} data-kind={k}>
                  <b>{counts[k]}</b>
                  <span>
                    <i />
                    {KIND_LABEL[k]}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p className="fin-note">{`${noTribute} of your ${monsters.length} main deck monsters need no tribute.`}</p>
          <p className="fin-status">{status}</p>
          {showForm && (
            <form
              className="fin-tour"
              aria-label="Create tournament"
              onSubmit={(event) => {
                event.preventDefault();
                void tournament.create();
              }}
            >
              <label>
                <span>Format</span>
                <select
                  value={tournament.format}
                  onChange={(e) => tournament.setFormat(e.target.value === "single_elim" ? "single_elim" : "round_robin")}
                  disabled={tournament.creating}
                  ref={focusFirst}
                >
                  <option value="round_robin">Round robin</option>
                  <option value="single_elim">Single elimination</option>
                </select>
              </label>
              <label>
                <span>Match length</span>
                <select
                  value={tournament.bestOf}
                  onChange={(e) => tournament.setBestOf(e.target.value === "1" ? 1 : 3)}
                  disabled={tournament.creating}
                >
                  <option value={3}>Best of 3</option>
                  <option value={1}>Best of 1</option>
                </select>
              </label>
              {tournament.error && (
                <p className="fin-error" role="alert">
                  {tournament.error}
                </p>
              )}
              <div className="fin-tour-actions">
                <button className="pick-btn" type="submit" disabled={tournament.creating} aria-busy={tournament.creating || undefined}>
                  <span>{tournament.creating ? "Creating…" : "Create tournament"}</span>
                </button>
                <button className="btn-2" type="button" onClick={() => setFormOpen(false)} disabled={tournament.creating}>
                  Cancel
                </button>
              </div>
            </form>
          )}
          <div className="fin-actions">
            {linked ? (
              <Link className="pick-btn" href={tournamentHref} ref={focusFirst}>
                <span>Go to tournament</span>
              </Link>
            ) : p.canCreateTournament && !formOpen ? (
              <button className="pick-btn" type="button" onClick={() => setFormOpen(true)} ref={focusFirst}>
                <span>Create tournament</span>
              </button>
            ) : null}
            <Link className="btn-2" href={`/decks/draft/${p.slug}`} ref={p.canCreateTournament || linked ? undefined : focusFirst}>
              View your deck
            </Link>
            <button className="btn-2" type="button" onClick={p.onExport} disabled={p.exporting}>
              {p.exporting ? "Exporting…" : "Export YDK"}
            </button>
            <Link className="btn-2" href="/drafts">
              Back to drafts
            </Link>
            <button className="btn-2" type="button" onClick={p.onClose}>
              Close
            </button>
          </div>
          {p.exportError && <p className="fin-error" role="alert">{p.exportError}</p>}
        </div>
      </div>
    </FullscreenLayer>
  );
}
