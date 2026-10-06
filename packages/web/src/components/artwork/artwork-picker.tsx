"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ImageOff, RotateCw } from "lucide-react";
import { ArtworksRequestError, fetchCardArtworks, peekCardArtworks, type CardArtworksResponse, type SelectableCardArtwork } from "@/lib/card-artworks-client";
import { cn } from "@/lib/utils";
import styles from "./artwork-picker.module.css";

/** "8 arts" for the badge on a card tile: every art the card has, the main one included. */
export function artCountLabel(altArtCount: number): string {
  const total = altArtCount + 1;
  return `${total} arts`;
}

function describe(art: SelectableCardArtwork, index: number, total: number, broken: boolean, reason?: string): string {
  const noImage = !art.smallUrl || broken;
  return `Art ${index + 1} of ${total}, passcode ${art.passcode}${art.isMain ? ", main art" : ""}${noImage ? ", no image available" : ""}${reason ? `, ${reason}` : ""}`;
}

/**
 * The arts of one card as a strip of thumbnails; the current art has a ring. It loads the family
 * itself and shows nothing for a card with one art. The parent decides what a pick means: a deck
 * copy swaps, a card in the list changes the art that Add uses.
 */
export function ArtworkPicker({
  code,
  knownCount,
  disabled = false,
  busy = false,
  error = null,
  label = "Card art",
  autoFocus = false,
  unavailable,
  onFamily,
  onPick,
}: {
  /** The passcode of the art in use. */
  code: number;
  /** Arts in the family when the card list already said so; 1 skips the request. */
  knownCount?: number;
  disabled?: boolean;
  /** A swap is in flight. */
  busy?: boolean;
  /** Why the last pick failed. */
  error?: string | null;
  label?: string;
  /** Moves focus to the art in use once the strip shows, for a picker that opens from a key or a click. */
  autoFocus?: boolean;
  /** Arts that cannot be chosen, and why (for example, already in the cube). */
  unavailable?: ReadonlyMap<number, string>;
  /** Called once with the family, so the parent can load the details of every member. */
  onFamily?: (family: CardArtworksResponse) => void;
  onPick: (art: SelectableCardArtwork, family: CardArtworksResponse) => void;
}) {
  const [loaded, setLoaded] = useState<CardArtworksResponse | null>(() => peekCardArtworks(code));
  const [failed, setFailed] = useState<{ code: number; error: Error } | null>(null);
  // The code whose request has been running for a moment; another card never inherits it.
  const [slowCode, setSlowCode] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const [broken, setBroken] = useState<ReadonlySet<number>>(() => new Set());
  const [look, setLook] = useState<number | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  // The strip of another card is never shown: a family counts only when it holds this card's art.
  const family = (loaded?.artworks.some((art) => art.passcode === code) ? loaded : null) ?? peekCardArtworks(code);
  const failure = failed?.code === code ? failed.error : null;
  const familyRef = useRef(family);
  familyRef.current = family;
  const onFamilyRef = useRef(onFamily);
  onFamilyRef.current = onFamily;
  const skip = knownCount === 1;
  // "Art changed" shows briefly once a change ends on another card.
  const [changed, setChanged] = useState(false);
  const wasBusy = useRef(false);
  const codeAtStart = useRef(code);
  const changedTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (busy) {
      if (!wasBusy.current) codeAtStart.current = code;
      wasBusy.current = true;
      return;
    }
    if (!wasBusy.current) return;
    wasBusy.current = false;
    if (codeAtStart.current === code) return;
    setChanged(true);
    window.clearTimeout(changedTimer.current);
    changedTimer.current = window.setTimeout(() => setChanged(false), 2000);
  }, [busy, code]);
  useEffect(() => () => window.clearTimeout(changedTimer.current), []);

  useEffect(() => {
    if (skip) return;
    // The strip stays while the card changes inside its own family.
    if (familyRef.current?.artworks.some((art) => art.passcode === code)) return;
    let cancelled = false;
    setFailed(null);
    setSlowCode(null);
    // A card that has one art answers fast; its placeholder would only flash.
    const timer = window.setTimeout(() => setSlowCode(code), 200);
    void fetchCardArtworks(code).then(
      (result) => {
        if (cancelled) return;
        setLoaded(result);
        onFamilyRef.current?.(result);
      },
      (reason: unknown) => {
        if (cancelled) return;
        setLoaded(null);
        setFailed({ code, error: reason instanceof Error ? reason : new Error("Could not load the art list.") });
      },
    );
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [code, skip, retry]);

  const focused = useRef(false);
  const stripShown = (family?.artworks.length ?? 0) > 1;
  useEffect(() => {
    if (!autoFocus || focused.current || !stripShown) return;
    focused.current = true;
    strip.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
  }, [autoFocus, stripShown]);

  if (skip) return null;
  // A card the engine does not know has no family; there is nothing to choose.
  if (failure instanceof ArtworksRequestError && failure.status === 404) return null;
  if (failure) {
    return (
      <section className={styles.picker} aria-label={label}>
        <p className={styles.failed} role="alert">
          Art choices did not load.
          <button type="button" className={styles.retry} onClick={() => setRetry((value) => value + 1)}>
            <RotateCw size={13} aria-hidden />Try again
          </button>
        </p>
      </section>
    );
  }
  if (!family) {
    if (knownCount == null && slowCode !== code) return null;
    return (
      <section className={styles.picker} aria-label={label} aria-busy="true">
        <header className={styles.head}>
          <span className={styles.title}>Art</span>
          <span className={cn("num", styles.count)}>{knownCount != null ? `${knownCount} arts` : "Loading…"}</span>
        </header>
        <div className={styles.skeleton} aria-hidden="true"><span /><span /><span /></div>
      </section>
    );
  }
  if (family.artworks.length < 2) return null;

  const { artworks } = family;
  const current = artworks.findIndex((art) => art.passcode === code);
  const shownIndex = Math.min(look ?? (current >= 0 ? current : 0), artworks.length - 1);
  const shown = artworks[shownIndex] ?? artworks[0]!;
  const tabStop = current >= 0 ? current : 0;
  const locked = disabled || busy;
  const shownReason = shownIndex === current ? undefined : unavailable?.get(shown.passcode);

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const buttons = [...(strip.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = buttons.findIndex((button) => button === document.activeElement);
    if (at < 0) return;
    let next = at;
    if (event.key in keys) next = (at + keys[event.key]! + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else return;
    event.preventDefault();
    buttons[next]?.focus();
  }

  return (
    <section className={styles.picker} aria-label={label} aria-busy={busy || undefined}>
      <header className={styles.head}>
        <span className={styles.title}>Art</span>
        <span className={cn("num", styles.count)}>{artworks.length} arts</span>
      </header>
      <div ref={strip} className={styles.strip} role="group" aria-label="Choose an art" onKeyDown={onKey}>
        {artworks.map((art, index) => {
          const missing = !art.smallUrl || broken.has(art.passcode);
          const isCurrent = index === current;
          const reason = isCurrent ? undefined : unavailable?.get(art.passcode);
          // aria-disabled, not disabled: the button keeps its place in the tab order, so arrow keys and
          // focus survive a swap and a keyboard user can still read why an art is unavailable.
          const blocked = (locked || reason != null) && !isCurrent;
          return (
            <button
              key={art.passcode}
              type="button"
              className={styles.thumb}
              aria-pressed={isCurrent}
              aria-label={describe(art, index, artworks.length, missing, reason)}
              title={describe(art, index, artworks.length, missing, reason)}
              data-current={isCurrent ? "true" : undefined}
              data-missing={missing ? "true" : undefined}
              tabIndex={index === tabStop ? 0 : -1}
              aria-disabled={blocked || undefined}
              onClick={() => { if (!isCurrent && !blocked) onPick(art, family); }}
              onPointerEnter={(event) => { if (event.pointerType !== "touch") setLook(index); }}
              onPointerLeave={() => setLook(null)}
              onFocus={() => setLook(index)}
              onBlur={() => setLook(null)}
            >
              {missing ? (
                <span className={styles.none}><ImageOff size={15} aria-hidden /><span>No image</span></span>
              ) : (
                <img
                  src={art.smallUrl!}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  onError={() => setBroken((prev) => new Set(prev).add(art.passcode))}
                />
              )}
            </button>
          );
        })}
      </div>
      {/* Only the change of state is announced; moving focus along the strip already reads each art. */}
      <p className="sr" role="status">{busy ? "Changing art…" : changed ? "Art changed" : ""}</p>
      <p className={styles.caption} aria-hidden={busy || undefined}>
        {busy ? "Changing art…" : (
          <>
            <span className="num">Art {shownIndex + 1} of {artworks.length}</span>
            {" · "}<span className="num">{shown.passcode}</span>
            {shown.isMain ? " · Main art" : ""}
            {!shown.smallUrl || broken.has(shown.passcode) ? " · No image yet" : ""}
            {shownIndex === current ? " · In use" : ""}
            {shownReason ? ` · ${shownReason}` : ""}
          </>
        )}
      </p>
      {error ? <p className={styles.failed} role="alert">{error}</p> : null}
    </section>
  );
}
