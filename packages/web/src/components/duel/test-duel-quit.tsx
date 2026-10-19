"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { useNavigationLeaveGuard, type LeaveIntercept } from "@/lib/hooks/navigation-leave-guard";
import { cancelDuel } from "./api";
import { SheetButton } from "./sheet-ui";
import ui from "./sheet-ui.module.css";
import styles from "./room-lobby.module.css";

const TAB_CLOSE_MESSAGE = "Quit the test duel? The duel ends when you leave.";

/**
 * A test duel from the deck editor. Back and in-app links ask "Would you like to quit the duel?" in a styled dialog:
 * Stay keeps the duel, Quit ends it (a cancel, so nothing is ranked or counted) and then continues the navigation.
 * `quit` is the Quit button: it ends the duel at once and calls `onQuit`, which goes back to the editor.
 */
export function useTestDuelQuit({ slug, active, onQuit }: { slug: string; active: boolean; onQuit: () => void }): { quit: () => void; busy: boolean; dialog: ReactNode } {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set before a navigation the quit itself starts: the guard must not stop the trip it is making.
  const [released, setReleased] = useState(false);
  const proceedRef = useRef<(() => void) | null>(null);
  const inFlight = useRef(false);

  const request = useCallback((proceed: () => void) => {
    // A second Back while the dialog is up keeps the first request; Stay drops it.
    proceedRef.current ??= proceed;
    setError(null);
    setOpen(true);
  }, []);
  const navigate = useCallback((href: string) => router.push(href), [router]);
  const intercept = useMemo<LeaveIntercept>(() => ({ request, navigate }), [request, navigate]);

  useNavigationLeaveGuard(active && !released, TAB_CLOSE_MESSAGE, `test-duel:${slug}`, intercept);

  const stay = useCallback(() => {
    if (inFlight.current) return;
    proceedRef.current = null;
    setError(null);
    setOpen(false);
  }, []);

  /** Ends the duel, then runs `then`. A duel that is already over needs no cancel; the cancel route accepts it either way. */
  const end = useCallback(async (then: (() => void) | null) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await cancelDuel(slug);
      setOpen(false);
      proceedRef.current = null;
      flushSync(() => setReleased(true));
      then?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not quit the duel.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [slug]);

  const quit = useCallback(() => { void end(onQuit); }, [end, onQuit]);

  const dialog = (
    <Modal open={open && active} onClose={stay} title="Would you like to quit the duel?" className="max-w-[min(32rem,calc(100vw-2rem))]">
      <p className="text-sm text-text-secondary">The test duel ends. It is not ranked and nothing is kept.</p>
      {error ? <p role="alert" className={`${ui.alert} mt-3`}>{error}</p> : null}
      <div className={`${styles.headActions} mt-5`}>
        <SheetButton kind="danger" loading={busy} disabled={busy} data-testid="test-duel-quit-confirm" onClick={() => { const proceed = proceedRef.current; void end(proceed); }}>Quit</SheetButton>
        <SheetButton kind="quiet" disabled={busy} data-testid="test-duel-quit-stay" onClick={stay}>Stay</SheetButton>
      </div>
    </Modal>
  );
  return { quit, busy, dialog };
}
