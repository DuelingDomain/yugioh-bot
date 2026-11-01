"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Drawers, popovers and the tray. One is open at a time. */
export type LayerId = "log" | "insp" | "health" | "hist" | "tray" | "card" | "flag" | "effect";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const FIRST = '[data-autofocus],li[role=option],input[type=text]';

/**
 * Focus goes into the layer when it opens, Tab stays inside, Esc closes, a press outside closes
 * (a press on a camera feed keeps a card popup open, because that click starts the next read), and focus returns to whatever opened it.
 */
export function useLayers() {
  const [layer, setLayer] = useState<LayerId | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const layerRef = useRef<LayerId | null>(null); layerRef.current = layer;

  const open = useCallback((id: LayerId, from?: HTMLElement | null) => {
    const active = document.activeElement as HTMLElement | null;
    // Keep the first opener when one layer replaces another, so focus returns to the real origin.
    if (!layerRef.current || from) opener.current = from ?? (active && active !== document.body ? active : null);
    setLayer(id);
  }, []);
  const close = useCallback((id?: LayerId) => {
    if (id && layerRef.current !== id) return;
    const inside = document.activeElement?.closest("[data-layer]");
    setLayer(null);
    const target = opener.current; opener.current = null;
    if (target && (inside || document.activeElement === document.body)) requestAnimationFrame(() => { if (target.isConnected) target.focus({ preventScroll: true }); });
  }, []);
  const toggle = useCallback((id: LayerId, from?: HTMLElement | null) => { if (layerRef.current === id) close(id); else open(id, from); }, [open, close]);

  useEffect(() => {
    if (!layer) return;
    const frame = requestAnimationFrame(() => {
      const root = document.querySelector<HTMLElement>(`[data-layer="${layer}"]`); if (!root) return;
      (root.querySelector<HTMLElement>(FIRST) ?? root.querySelector<HTMLElement>(FOCUSABLE) ?? root).focus({ preventScroll: true });
    });
    function key(event: KeyboardEvent) {
      const root = document.querySelector<HTMLElement>(`[data-layer="${layerRef.current}"]`); if (!root) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key !== "Tab") return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0]; const last = items[items.length - 1]; const active = document.activeElement as HTMLElement | null;
      if (!root.contains(active)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    }
    function down(event: PointerEvent) {
      const target = event.target as HTMLElement | null; if (!target) return;
      const id = layerRef.current;
      // A press on a camera feed starts a new read, which replaces the popup. Anywhere else outside closes it.
      if ((id === "tray" || id === "card") && target.closest("[data-remote-seat]")) return;
      if (target.closest(`[data-layer="${id}"]`) || (opener.current && opener.current.contains(target)) || target.closest("[data-layer-opener]")) return;
      setLayer(null); opener.current = null;
    }
    document.addEventListener("keydown", key, true); document.addEventListener("pointerdown", down, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", down, true); };
  }, [layer, close]);

  return { layer, open, close, toggle };
}
