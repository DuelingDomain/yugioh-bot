"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { encodeYdke } from "@yugidraft/shared/decks";
import type { DuelDeck } from "@yugidraft/shared/duels";
import { SheetPortal } from "@/components/sheet";
import { DURATION, usePresence } from "@/lib/motion";
import styles from "./copy-ydke.module.css";

type Notice = { id: number; text: string; ok: boolean };

/** The ydke:// code for a deck. A Deck Master is not part of YDKE, so it is left out. */
export function deckYdke(deck: DuelDeck): string {
  return encodeYdke(deck);
}

/** A short line that confirms the copy, or says it failed. It leaves by itself after a few seconds. */
function CopyToast({ notice }: { notice: Notice | null }) {
  const shown = useRef<Notice | null>(null);
  if (notice) shown.current = notice;
  const { mounted, state } = usePresence(notice != null, DURATION.toastOut);
  if (!mounted || !shown.current) return null;
  return (
    <SheetPortal>
      <div className={styles.wrap}>
        <div className={styles.toast} data-mo="slide" data-state={state} data-ok={shown.current.ok ? "" : undefined} role="status">
          {shown.current.text}
        </div>
      </div>
    </SheetPortal>
  );
}

/**
 * Copies a deck as a ydke:// code. `toast` must be rendered once by the caller.
 * The result is true when the browser took the text.
 */
export function useCopyYdke(): { copyYdke: (deck: DuelDeck) => Promise<boolean>; toast: ReactNode } {
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(0);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copyYdke = useCallback(async (deck: DuelDeck) => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(deckYdke(deck));
      ok = true;
    } catch {
      ok = false;
    }
    setNotice({ id: ++counter.current, text: ok ? "YDKE code copied." : "Could not copy. Allow clipboard access and try again.", ok });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 3000);
    return ok;
  }, []);

  return { copyYdke, toast: <CopyToast notice={notice} /> };
}
