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

/** Which element the viewer's last action asked to focus; null once focus moved or when nothing is wanted. */
type FocusWant = "initial" | "format" | "primary" | null;

/** Focuses a freshly mounted element when the pending request names its kind, then clears the request. */
function takeFocus(want: { current: FocusWant }, el: HTMLElement | null, ...kinds: Array<Exclude<FocusWant, null>>) {
  if (!el || !want.current || !kinds.includes(want.current)) return;
  want.current = null;
  el.focus();
}

/** Focus moved to another control: a later live update must not pull it back. */
function leaveFocus(want: { current: FocusWant }, event: React.FocusEvent<HTMLElement>) {
  const next = event.relatedTarget as Node | null;
  if (next && !event.currentTarget.contains(next)) want.current = null;
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
  // Focus moves to a new element only when the viewer asked for it: on first show, after opening or
  // leaving the form, and after creating the tournament. A live update that swaps an action (another
  // person made the tournament) never takes focus, so it is announced through the status line instead.
  const want = useRef<FocusWant>("initial");
  const focusInitial = useCallback((el: HTMLAnchorElement | null) => takeFocus(want, el, "initial"), []);
  const focusPrimary = useCallback((el: HTMLAnchorElement | HTMLButtonElement | null) => takeFocus(want, el, "initial", "primary"), []);
  const focusFormat = useCallback((el: HTMLSelectElement | null) => takeFocus(want, el, "format"), []);
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
          <p className="fin-status" aria-live="polite">
            {status}
          </p>
          {showForm && (
            <form
              className="fin-tour"
              aria-label="Create tournament"
              // The viewer is working in the form: when it gives way to Go to tournament, focus follows.
              onFocus={() => {
                want.current = "primary";
              }}
              onBlur={(event) => leaveFocus(want, event)}
              onSubmit={(event) => {
                event.preventDefault();
                // The controls stay enabled while creating (aria-disabled) so focus is not lost: ignore a repeat.
                if (tournament.creating) return;
                void tournament.create();
              }}
            >
              <label>
                <span>Format</span>
                <select
                  value={tournament.format}
                  onChange={(e) => {
                    if (!tournament.creating) tournament.setFormat(e.target.value === "single_elim" ? "single_elim" : "round_robin");
                  }}
                  aria-disabled={tournament.creating || undefined}
                  ref={focusFormat}
                >
                  <option value="round_robin">Round robin</option>
                  <option value="single_elim">Single elimination</option>
                </select>
              </label>
              <label>
                <span>Match length</span>
                <select
                  value={tournament.bestOf}
                  onChange={(e) => {
                    if (!tournament.creating) tournament.setBestOf(e.target.value === "1" ? 1 : 3);
                  }}
                  aria-disabled={tournament.creating || undefined}
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
                <button
                  className="pick-btn"
                  type="submit"
                  aria-disabled={tournament.creating || undefined}
                  aria-busy={tournament.creating || undefined}
                >
                  <span>{tournament.creating ? "Creating…" : "Create tournament"}</span>
                </button>
                <button
                  className="btn-2"
                  type="button"
                  onClick={() => {
                    if (tournament.creating) return;
                    want.current = "primary";
                    setFormOpen(false);
                  }}
                  aria-disabled={tournament.creating || undefined}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          <div className="fin-actions">
            {linked ? (
              <Link className="pick-btn" href={tournamentHref} ref={focusPrimary}>
                <span>Go to tournament</span>
              </Link>
            ) : p.canCreateTournament && !formOpen ? (
              <button
                className="pick-btn"
                type="button"
                // The viewer is on this button: if a live update replaces it, focus follows to Go to tournament.
                onFocus={() => {
                  want.current = "primary";
                }}
                onBlur={(event) => leaveFocus(want, event)}
                onClick={() => {
                  want.current = "format";
                  setFormOpen(true);
                }}
                ref={focusPrimary}
              >
                <span>Create tournament</span>
              </button>
            ) : null}
            <Link className="btn-2" href={`/decks/draft/${p.slug}`} ref={p.canCreateTournament || linked ? undefined : focusInitial}>
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
