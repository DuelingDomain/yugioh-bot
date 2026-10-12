"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { encodeYdke } from "@yugidraft/shared/decks";
import type { DuelDeck } from "@yugidraft/shared/duels";
import { SheetPortal, SvButton } from "@/components/sheet";
import { useFocusTrap } from "@/hooks/useFocusTrap";
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

const MASTER_NOTE = "The Deck Master is not part of YDKE.";

/** What the person sees when the browser cannot copy: the code, ready to select. */
type Manual = { code: string; reason: "unavailable" | "failed"; master: boolean };

function ManualCopy({ manual, onClose }: { manual: Manual; onClose: () => void }) {
  // The portal mounts its children one render late, so the box lives in its own component: its effects run
  // when the text box really exists.
  return (
    <SheetPortal>
      <ManualDialog manual={manual} onClose={onClose} />
    </SheetPortal>
  );
}

function ManualDialog({ manual, onClose }: { manual: Manual; onClose: () => void }) {
  const titleId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // The code is selected when the box opens. Tab stays inside, and Escape closes from anywhere.
  useFocusTrap(panel, true);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className={styles.backdrop} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <div ref={panel} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <h2 id={titleId} className={styles.dialogTitle}>Copy the YDKE code</h2>
          <p className={styles.dialogText}>
            {manual.reason === "unavailable"
              ? "This page cannot use the clipboard here. Select the code below and copy it by hand."
              : "The browser did not allow the copy. Select the code below and copy it by hand."}
            {manual.master ? ` ${MASTER_NOTE}` : ""}
          </p>
          <textarea
            ref={field}
            className={`input ${styles.code}`}
            readOnly
            rows={3}
            spellCheck={false}
            aria-label="YDKE code"
            value={manual.code}
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className={styles.dialogActs}>
            <SvButton variant="primary" onClick={onClose}>Close</SvButton>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Copies a deck as a ydke:// code. `toast` must be rendered once by the caller.
 * The result is true when the browser took the text. When the clipboard is missing (a page on a plain HTTP
 * address) or refuses, a box with the code opens instead, so the person can copy it by hand.
 */
export function useCopyYdke(): { copyYdke: (deck: DuelDeck) => Promise<boolean>; toast: ReactNode } {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [manual, setManual] = useState<Manual | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(0);
  /** What had focus when the copy started, so the box can hand focus back when it closes. */
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const closeManual = useCallback(() => {
    setManual(null);
    const back = opener.current;
    opener.current = null;
    if (back?.isConnected) back.focus();
  }, []);

  const copyYdke = useCallback(async (deck: DuelDeck) => {
    opener.current = typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null);
    const code = deckYdke(deck);
    const master = deck.deckMaster != null;
    let reason: Manual["reason"] | null = null;
    if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") {
      reason = "unavailable";
    } else {
      try {
        await navigator.clipboard.writeText(code);
      } catch {
        reason = "failed";
      }
    }
    if (reason) {
      setNotice(null);
      setManual({ code, reason, master });
      return false;
    }
    setNotice({ id: ++counter.current, text: master ? `YDKE code copied. ${MASTER_NOTE}` : "YDKE code copied.", ok: true });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), master ? 5000 : 3000);
    return true;
  }, []);

  return {
    copyYdke,
    toast: (
      <>
        <CopyToast notice={notice} />
        {manual ? <ManualCopy manual={manual} onClose={closeManual} /> : null}
      </>
    ),
  };
}
