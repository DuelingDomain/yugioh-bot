"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ImageOff, RotateCw } from "lucide-react";
import { ArtworksRequestError, fetchCardArtworks, type CardArtworksResponse, type SelectableCardArtwork } from "@/lib/card-artworks-client";
import { cn } from "@/lib/utils";
import styles from "./artwork-picker.module.css";

/** "8 arts" for the badge on a card tile: every art the card has, the main one included. */
export function artCountLabel(altArtCount: number): string {
  const total = altArtCount + 1;
  return `${total} arts`;
}

function describe(art: SelectableCardArtwork, index: number, total: number, broken: boolean): string {
  const noImage = !art.smallUrl || broken;
  return `Art ${index + 1} of ${total}, passcode ${art.passcode}${art.isMain ? ", main art" : ""}${noImage ? ", no image available" : ""}`;
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
  /** Called once with the family, so the parent can load the details of every member. */
  onFamily?: (family: CardArtworksResponse) => void;
  onPick: (art: SelectableCardArtwork, family: CardArtworksResponse) => void;
}) {
  const [family, setFamily] = useState<CardArtworksResponse | null>(null);
  const [failure, setFailure] = useState<ArtworksRequestError | Error | null>(null);
  const [retry, setRetry] = useState(0);
  const [broken, setBroken] = useState<ReadonlySet<number>>(() => new Set());
  const [look, setLook] = useState<number | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const familyRef = useRef(family);
  familyRef.current = family;
  const onFamilyRef = useRef(onFamily);
  onFamilyRef.current = onFamily;
  const skip = knownCount === 1;

  useEffect(() => {
    if (skip) return;
    // The strip stays while the card changes inside its own family.
    if (familyRef.current?.artworks.some((art) => art.passcode === code) && retry === 0) return;
    let cancelled = false;
    setFailure(null);
    void fetchCardArtworks(code).then(
      (result) => {
        if (cancelled) return;
        setFamily(result);
        onFamilyRef.current?.(result);
      },
      (reason: unknown) => {
        if (cancelled) return;
        setFamily(null);
        setFailure(reason instanceof Error ? reason : new Error("Could not load the art list."));
      },
    );
    return () => { cancelled = true; };
  }, [code, skip, retry]);

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
    return (
      <section className={styles.picker} aria-label={label} aria-busy="true">
        <header className={styles.head}><h3>Art</h3><span className={styles.count}>Loading…</span></header>
        <div className={styles.skeleton} aria-hidden="true"><span /><span /><span /></div>
      </section>
    );
  }
  if (family.artworks.length < 2) return null;

  const { artworks } = family;
  const current = artworks.findIndex((art) => art.passcode === code);
  const shownIndex = look ?? (current >= 0 ? current : 0);
  const shown = artworks[shownIndex]!;
  const tabStop = current >= 0 ? current : 0;
  const locked = disabled || busy;

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
        <h3>Art</h3>
        <span className={cn("num", styles.count)}>{artworks.length} arts</span>
      </header>
      <div ref={strip} className={styles.strip} role="group" aria-label="Choose an art" onKeyDown={onKey}>
        {artworks.map((art, index) => {
          const missing = !art.smallUrl || broken.has(art.passcode);
          const isCurrent = index === current;
          return (
            <button
              key={art.passcode}
              type="button"
              className={styles.thumb}
              aria-pressed={isCurrent}
              aria-label={describe(art, index, artworks.length, missing)}
              title={describe(art, index, artworks.length, missing)}
              data-current={isCurrent ? "true" : undefined}
              data-missing={missing ? "true" : undefined}
              tabIndex={index === tabStop ? 0 : -1}
              disabled={locked && !isCurrent}
              onClick={() => { if (!isCurrent && !locked) onPick(art, family); }}
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
      <p className={styles.caption} aria-live="polite">
        {busy ? "Changing art…" : (
          <>
            <span className="num">Art {shownIndex + 1} of {artworks.length}</span>
            {" · "}<span className="num">{shown.passcode}</span>
            {shown.isMain ? " · Main art" : ""}
            {!shown.smallUrl || broken.has(shown.passcode) ? " · No image yet" : ""}
            {shownIndex === current ? " · In use" : ""}
          </>
        )}
      </p>
      {error ? <p className={styles.failed} role="alert">{error}</p> : null}
    </section>
  );
}
