"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { CardArtworksResponse, SelectableCardArtwork } from "@yugidraft/shared/duels";
import { ArtworkPicker } from "@/components/artwork/artwork-picker";
import { SheetPortal } from "@/components/sheet";
import type { DeckSection } from "./model";
import styles from "./editor.module.css";

/** The deck copy whose art the menu changes. `anchor` is the card tile the menu opens beside. */
export type ArtMenuTarget = {
  section: DeckSection | "deckMaster";
  index: number;
  code: number;
  name: string;
  anchor: HTMLElement;
};

const GAP = 8;
const MARGIN = 12;
/** Where the menu grows from, so it opens out of the card it sits beside. */
type Placement = { top: number; left: number; origin: string };
const FOCUSABLE = 'button:not(:disabled):not([tabindex="-1"]), a[href]';

/**
 * The press that closes the menu is followed by a click on whatever was under the pointer, and on a deck
 * tile that click would remove a card. The next click is stopped before it reaches the page; the next
 * pointerdown starts a new gesture and drops the guard, and so does a second of waiting.
 */
function swallowNextClick() {
  // A press with no click after it (a drag, a scroll) ends the guard too, and so does a long wait.
  const timer = window.setTimeout(() => drop(), 1000);
  const drop = () => {
    window.clearTimeout(timer);
    document.removeEventListener("click", stop, true);
    document.removeEventListener("pointerdown", drop, true);
  };
  function stop(event: Event) {
    event.stopPropagation();
    event.preventDefault();
    drop();
  }
  document.addEventListener("click", stop, true);
  document.addEventListener("pointerdown", drop, true);
}

/**
 * The art choices of one deck card in a small popover beside the card. A pick, Escape, a press outside
 * the menu and a scroll all close it, and focus goes back to the card.
 */
export function DeckArtMenu({ target, knownCount, busy, disabled, onClose, onFamily, onPick }: {
  target: ArtMenuTarget;
  knownCount?: number;
  busy: boolean;
  disabled: boolean;
  onClose: () => void;
  onFamily: (family: CardArtworksResponse) => void;
  onPick: (art: SelectableCardArtwork, family: CardArtworksResponse) => void;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  // The portal mounts after the first render, so the placement waits for the panel itself.
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const panelRef = useCallback((node: HTMLDivElement | null) => { panel.current = node; setBox(node); }, []);
  const close = useRef(onClose);
  close.current = onClose;
  const [position, setPosition] = useState<Placement | null>(null);
  const { anchor } = target;

  // Beside the card: to its right, else to its left, else below or above it on a narrow screen.
  useLayoutEffect(() => {
    if (!box) return;
    function place() {
      const from = anchor.getBoundingClientRect();
      const width = box!.offsetWidth || 292;
      const height = box!.offsetHeight || 140;
      const room = { w: window.innerWidth, h: window.innerHeight };
      const clamp = (value: number, max: number) => Math.max(MARGIN, Math.min(value, max));
      let left: number;
      let origin = "top left";
      let top = clamp(from.top, room.h - height - MARGIN);
      if (from.right + GAP + width <= room.w - MARGIN) left = from.right + GAP;
      else if (from.left - GAP - width >= MARGIN) { left = from.left - GAP - width; origin = "top right"; }
      else {
        left = clamp(from.left + from.width / 2 - width / 2, room.w - width - MARGIN);
        const below = from.bottom + GAP + height <= room.h - MARGIN;
        top = below ? from.bottom + GAP : clamp(from.top - GAP - height, room.h - height - MARGIN);
        origin = below ? "top center" : "bottom center";
      }
      setPosition((current) => (current && current.top === top && current.left === left && current.origin === origin ? current : { top, left, origin }));
    }
    place();
    window.addEventListener("resize", place);
    // The strip arrives after the family loads, so the menu grows once.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(box);
    return () => {
      window.removeEventListener("resize", place);
      observer?.disconnect();
    };
  }, [anchor, box]);

  useEffect(() => {
    function onPointer(event: PointerEvent) {
      if (!panel.current || panel.current.contains(event.target as Node)) return;
      close.current();
      swallowNextClick();
    }
    function onScroll(event: Event) {
      if (panel.current && !panel.current.contains(event.target as Node)) close.current();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      // Tab stays inside the menu; the strip is one stop, so this wraps between that and the retry button.
      const items = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (items.length === 0) { event.preventDefault(); return; }
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = (at + (event.shiftKey ? -1 : 1) + items.length) % items.length;
      event.preventDefault();
      items[next]?.focus();
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor]);

  return (
    <SheetPortal>
      <div
        ref={panelRef}
        role="dialog"
        aria-label={`Change art of ${target.name}`}
        className={`${styles["de-pop"]} ${styles["de-artmenu"]}`}
        data-mo="pop"
        data-state="open"
        style={{ top: position?.top ?? 0, left: position?.left ?? 0, visibility: position ? undefined : "hidden", "--mo-origin": position?.origin ?? "top left" } as CSSProperties}
      >
        <ArtworkPicker
          code={target.code}
          knownCount={knownCount}
          busy={busy}
          disabled={disabled}
          label="Change art"
          autoFocus
          onFamily={onFamily}
          onPick={onPick}
        />
      </div>
    </SheetPortal>
  );
}
